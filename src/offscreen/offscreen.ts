import { resampleFloat32Mono } from "../lib/audio/resample";
import { createId } from "../lib/ids";
import { CHUNK_MS, MAX_PENDING_CHUNKS, MODEL_ID } from "../shared/constants";
import type { RuntimeMetrics, TranscriptSegment } from "../shared/transcript-types";
import type { RuntimeMessage, ServiceToOffscreenMessage, WorkerInput, WorkerOutput } from "../shared/messages";

type AudioJob = {
  id: string;
  audio: Float32Array;
  startMs: number;
  endMs: number;
};

let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let worker: Worker | null = null;
let capturePaused = false;
let samplesPerChunk = 0;
let sampleRate = 48_000;
let sampleBuffer: Float32Array[] = [];
let bufferedSampleCount = 0;
let currentChunkStartMs = 0;
let processing = false;
let queue: AudioJob[] = [];
let lastText = "";
let metrics: RuntimeMetrics = { queueLength: 0 };

function post(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function sendStatus(status: "model_loading" | "ready" | "recording" | "paused" | "stopping" | "stopped" | "error") {
  post({ target: "service-worker", type: "STATUS_CHANGED", status });
}

function sendError(code: string, message: string) {
  sendStatus("error");
  post({ target: "service-worker", type: "TRANSCRIPTION_ERROR", code, message });
}

function sendMetrics(update: Partial<RuntimeMetrics>) {
  metrics = { ...metrics, ...update, queueLength: queue.length };
  post({ target: "service-worker", type: "METRICS_CHANGED", metrics });
}

function ensureWorker() {
  if (worker) return worker;

  worker = new Worker(new URL("../workers/transcriber.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
    const message = event.data;

    if (message.type === "MODEL_LOADING") {
      sendStatus("model_loading");
    }

    if (message.type === "MODEL_READY") {
      sendMetrics({ modelLoadMs: message.modelLoadMs });
      if (stream && !capturePaused) sendStatus("recording");
    }

    if (message.type === "TRANSCRIPTION_RESULT") {
      handleTranscriptionResult(message);
    }

    if (message.type === "TRANSCRIPTION_ERROR") {
      processing = false;
      sendError("transcription_error", message.error);
      processNextJob();
    }
  };
  worker.onerror = (event) => {
    processing = false;
    sendError("worker_error", event.message || "The transcription worker crashed.");
  };

  const loadMessage: WorkerInput = { type: "LOAD_MODEL", modelId: MODEL_ID };
  worker.postMessage(loadMessage);
  return worker;
}

async function startCapture(message: Extract<ServiceToOffscreenMessage, { type: "START_CAPTURE" }>) {
  await stopCapture(false);
  sendStatus("model_loading");
  ensureWorker();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.streamId
      }
    } as MediaTrackConstraints,
    video: false
  });

  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(stream);
  sourceNode.connect(audioContext.destination);

  capturePaused = false;
  lastText = "";
  queue = [];
  sampleBuffer = [];
  bufferedSampleCount = 0;
  currentChunkStartMs = 0;
  processing = false;
  sampleRate = audioContext.sampleRate;
  samplesPerChunk = Math.round((CHUNK_MS / 1000) * sampleRate);

  await attachPcmCaptureNode();
  sendStatus("recording");
}

async function attachPcmCaptureNode() {
  if (!audioContext || !sourceNode) return;

  try {
    await audioContext.audioWorklet.addModule(chrome.runtime.getURL("worklets/pcm-processor.js"));
    workletNode = new AudioWorkletNode(audioContext, "snow-pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => handlePcmSamples(event.data);
    sourceNode.connect(workletNode);
    workletNode.connect(audioContext.destination);
  } catch {
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      handlePcmSamples(event.inputBuffer.getChannelData(0));
    };
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
  }
}

function handlePcmSamples(input: Float32Array) {
  if (capturePaused) return;

  const copy = new Float32Array(input.length);
  copy.set(input);
  sampleBuffer.push(copy);
  bufferedSampleCount += copy.length;

  if (bufferedSampleCount >= samplesPerChunk) {
    enqueuePcmChunk();
  }
}

function enqueuePcmChunk() {
  if (queue.length >= MAX_PENDING_CHUNKS) {
    sendError("device_too_slow", "Your device is transcribing slower than playback. Stop or pause the video, then try again.");
    return;
  }

  const rawChunk = drainBufferedSamples(samplesPerChunk);
  const startMs = currentChunkStartMs;
  const durationMs = Math.round((rawChunk.length / sampleRate) * 1000);
  const endMs = startMs + durationMs;
  currentChunkStartMs = endMs;

  const audio = resampleFloat32Mono(rawChunk, sampleRate);
  queue.push({ id: createId("chunk"), audio, startMs, endMs });
  sendMetrics({ lastChunkMs: endMs - startMs });
  processNextJob();
}

function drainBufferedSamples(targetCount: number) {
  const takeCount = Math.min(targetCount, bufferedSampleCount);
  const output = new Float32Array(takeCount);
  let offset = 0;

  while (offset < takeCount && sampleBuffer.length > 0) {
    const first = sampleBuffer[0];
    const remaining = takeCount - offset;
    if (first.length <= remaining) {
      output.set(first, offset);
      offset += first.length;
      sampleBuffer.shift();
    } else {
      output.set(first.subarray(0, remaining), offset);
      sampleBuffer[0] = first.subarray(remaining);
      offset += remaining;
    }
  }

  bufferedSampleCount -= takeCount;
  return output;
}

function flushPcmChunk() {
  if (bufferedSampleCount > sampleRate * 2) {
    const rawChunk = drainBufferedSamples(bufferedSampleCount);
    const startMs = currentChunkStartMs;
    const durationMs = Math.round((rawChunk.length / sampleRate) * 1000);
    const endMs = startMs + durationMs;
    currentChunkStartMs = endMs;
    const audio = resampleFloat32Mono(rawChunk, sampleRate);
    queue.push({ id: createId("chunk"), audio, startMs, endMs });
    sendMetrics({ lastChunkMs: endMs - startMs });
    processNextJob();
  }
}

// Keep inference serialized. Whisper can consume enough CPU/RAM that parallel
// chunks make slower machines less stable instead of faster.
function processNextJob() {
  if (processing || queue.length === 0 || !worker) {
    sendMetrics({});
    return;
  }

  const job = queue.shift();
  if (!job) return;
  processing = true;
  sendMetrics({});

  const input: WorkerInput = {
    type: "TRANSCRIBE",
    chunkId: job.id,
    audio: job.audio,
    startMs: job.startMs,
    endMs: job.endMs
  };
  worker.postMessage(input, [job.audio.buffer]);
}

function handleTranscriptionResult(message: Extract<WorkerOutput, { type: "TRANSCRIPTION_RESULT" }>) {
  processing = false;
  sendMetrics({ lastTranscriptionMs: message.transcriptionMs });

  const text = dedupeBoundary(lastText, message.text.trim());
  if (text) {
    lastText = `${lastText} ${text}`.trim();
    const segment: TranscriptSegment = {
      id: createId("segment"),
      text,
      startMs: message.startMs,
      endMs: message.endMs,
      createdAt: new Date().toISOString()
    };
    post({ target: "service-worker", type: "TRANSCRIPT_SEGMENT", segment });
  }

  processNextJob();
}

function dedupeBoundary(previous: string, next: string) {
  if (!previous || !next) return next;
  const previousWords = previous.split(/\s+/).slice(-12);
  const nextWords = next.split(/\s+/);

  for (let size = Math.min(previousWords.length, nextWords.length); size > 2; size -= 1) {
    const prevTail = previousWords.slice(-size).join(" ").toLowerCase();
    const nextHead = nextWords.slice(0, size).join(" ").toLowerCase();
    if (prevTail === nextHead) {
      return nextWords.slice(size).join(" ");
    }
  }

  return next;
}

function pauseCapture() {
  if (stream && !capturePaused) {
    flushPcmChunk();
    capturePaused = true;
    sendStatus("paused");
  }
}

function resumeCapture() {
  if (stream && capturePaused) {
    capturePaused = false;
    sendStatus("recording");
  }
}

async function stopCapture(notify = true) {
  if (notify) sendStatus("stopping");

  flushPcmChunk();

  workletNode?.port.close();
  workletNode?.disconnect();
  workletNode = null;
  processorNode?.disconnect();
  processorNode = null;
  sourceNode?.disconnect();
  sourceNode = null;

  stream?.getTracks().forEach((track) => track.stop());
  stream = null;

  if (audioContext?.state !== "closed") {
    await audioContext?.close();
  }
  audioContext = null;
  capturePaused = false;
  sampleBuffer = [];
  bufferedSampleCount = 0;

  // Keep the queue intact so a just-flushed final recorder chunk can finish.
  sendMetrics({});
  if (notify) sendStatus("stopped");
}

chrome.runtime.onMessage.addListener((message: ServiceToOffscreenMessage) => {
  if (!("target" in message) || message.target !== "offscreen") return;

  if (message.type === "START_CAPTURE") {
    startCapture(message).catch((error) => {
      sendError("capture_error", error instanceof Error ? error.message : "Could not capture audio from this tab.");
    });
  }
  if (message.type === "PAUSE_CAPTURE") pauseCapture();
  if (message.type === "RESUME_CAPTURE") resumeCapture();
  if (message.type === "STOP_CAPTURE") {
    stopCapture().catch((error) => {
      sendError("stop_error", error instanceof Error ? error.message : "Could not stop the recording cleanly.");
    });
  }
});

post({ target: "service-worker", type: "OFFSCREEN_READY" });
