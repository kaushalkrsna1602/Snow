export type RecorderStatus =
  | "idle"
  | "model_loading"
  | "ready"
  | "recording"
  | "paused"
  | "stopping"
  | "stopped"
  | "error";

export type TranscriptSegment = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  createdAt: string;
};

export type TranscriptSession = {
  id: string;
  status: RecorderStatus;
  tabId?: number;
  tabTitle?: string;
  tabUrl?: string;
  model: "Xenova/whisper-tiny.en";
  language: "en";
  startedAt?: string;
  stoppedAt?: string;
  segments: TranscriptSegment[];
  error?: {
    code: string;
    message: string;
  };
};

export type RuntimeMetrics = {
  queueLength: number;
  lastChunkMs?: number;
  lastTranscriptionMs?: number;
  modelLoadMs?: number;
};
