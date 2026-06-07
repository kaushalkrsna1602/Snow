import type { RecorderStatus, RuntimeMetrics, TranscriptSegment } from "./transcript-types";

export type UiCommand =
  | { type: "START_TRANSCRIPTION" }
  | { type: "PAUSE_TRANSCRIPTION" }
  | { type: "RESUME_TRANSCRIPTION" }
  | { type: "STOP_TRANSCRIPTION" }
  | { type: "CLEAR_TRANSCRIPT" }
  | { type: "OPEN_SIDE_PANEL" };

export type ServiceToOffscreenMessage =
  | {
    target: "offscreen";
    type: "START_CAPTURE";
    streamId: string;
    tabId: number;
    tabTitle?: string;
    tabUrl?: string;
  }
  | { target: "offscreen"; type: "PAUSE_CAPTURE" }
  | { target: "offscreen"; type: "RESUME_CAPTURE" }
  | { target: "offscreen"; type: "STOP_CAPTURE" };

export type OffscreenToServiceMessage =
  | { target: "service-worker"; type: "OFFSCREEN_READY" }
  | { target: "service-worker"; type: "STATUS_CHANGED"; status: RecorderStatus }
  | { target: "service-worker"; type: "TRANSCRIPT_SEGMENT"; segment: TranscriptSegment }
  | { target: "service-worker"; type: "METRICS_CHANGED"; metrics: RuntimeMetrics }
  | { target: "service-worker"; type: "TRANSCRIPTION_ERROR"; code: string; message: string };

export type BroadcastMessage =
  | { type: "SESSION_CHANGED" }
  | { type: "STATUS_CHANGED"; status: RecorderStatus }
  | { type: "METRICS_CHANGED"; metrics: RuntimeMetrics }
  | { type: "ERROR"; code: string; message: string };

export type RuntimeMessage = UiCommand | ServiceToOffscreenMessage | OffscreenToServiceMessage | BroadcastMessage;

export type WorkerInput =
  | { type: "LOAD_MODEL"; modelId: "Xenova/whisper-tiny.en" }
  | { type: "TRANSCRIBE"; chunkId: string; audio: Float32Array; startMs: number; endMs: number }
  | { type: "RESET" };

export type WorkerOutput =
  | { type: "MODEL_LOADING" }
  | { type: "MODEL_READY"; modelLoadMs: number }
  | { type: "TRANSCRIPTION_RESULT"; chunkId: string; text: string; startMs: number; endMs: number; transcriptionMs: number }
  | { type: "TRANSCRIPTION_ERROR"; chunkId?: string; error: string };
