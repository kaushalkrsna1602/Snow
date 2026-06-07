import { env, pipeline } from "@huggingface/transformers";
import type { WorkerInput, WorkerOutput } from "../shared/messages";

type AsrPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string } | Array<{ text?: string }>>;
type OnnxWasmConfig = {
  wasmPaths: { mjs: string; wasm: string };
  proxy: boolean;
  numThreads: number;
};

let transcriber: AsrPipeline | null = null;
let loading: Promise<AsrPipeline> | null = null;

function configureTransformersRuntime() {
  const extensionOrigin = self.location.origin;
  const wasm = env.backends.onnx.wasm as OnnxWasmConfig;

  wasm.wasmPaths = {
    mjs: `${extensionOrigin}/ort/ort-wasm-simd-threaded.jsep.mjs`,
    wasm: `${extensionOrigin}/ort/ort-wasm-simd-threaded.jsep.wasm`
  };
  wasm.proxy = false;
  wasm.numThreads = 1;
}

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (!loading) {
    configureTransformersRuntime();
    const started = performance.now();
    post({ type: "MODEL_LOADING" });
    loading = pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
      device: "wasm",
      dtype: "q8"
    }).then((pipe) => {
      transcriber = pipe as unknown as AsrPipeline;
      post({ type: "MODEL_READY", modelLoadMs: Math.round(performance.now() - started) });
      return transcriber;
    });
  }
  return loading;
}

function post(message: WorkerOutput) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const message = event.data;

  if (message.type === "RESET") {
    transcriber = null;
    loading = null;
    return;
  }

  try {
    if (message.type === "LOAD_MODEL") {
      await getTranscriber();
      return;
    }

    if (message.type === "TRANSCRIBE") {
      const pipe = await getTranscriber();
      const started = performance.now();
      const result = await pipe(message.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false
      });

      const text = Array.isArray(result) ? result.map((item) => item.text).join(" ") : String(result.text ?? "");
      post({
        type: "TRANSCRIPTION_RESULT",
        chunkId: message.chunkId,
        text,
        startMs: message.startMs,
        endMs: message.endMs,
        transcriptionMs: Math.round(performance.now() - started)
      });
    }
  } catch (error) {
    post({
      type: "TRANSCRIPTION_ERROR",
      chunkId: message.type === "TRANSCRIBE" ? message.chunkId : undefined,
      error: error instanceof Error ? error.message : "Local transcription failed."
    });
  }
};
