import { Activity, Download, Loader2, Mic2, Pause, Play, RotateCcw, Square, Trash2, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadTranscript } from "../lib/download";
import { getCurrentSession } from "../lib/storage";
import { formatDuration } from "../lib/time";
import type { RuntimeMessage } from "../shared/messages";
import type { RecorderStatus, RuntimeMetrics, TranscriptSession } from "../shared/transcript-types";

const statusLabels: Record<RecorderStatus, string> = {
  idle: "Idle",
  model_loading: "Loading local model",
  ready: "Ready",
  recording: "Recording",
  paused: "Paused",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Needs attention"
};

export function App() {
  const [session, setSession] = useState<TranscriptSession | null>(null);
  const [metrics, setMetrics] = useState<RuntimeMetrics>({ queueLength: 0 });
  const [error, setError] = useState<string | null>(null);
  const status = session?.status ?? "idle";

  const refreshSession = useCallback(async () => {
    const next = await getCurrentSession();
    setSession(next);
    setError(next?.error?.message ?? null);
  }, []);

  useEffect(() => {
    void refreshSession();

    const listener = (message: RuntimeMessage) => {
      if (message.type === "SESSION_CHANGED" || message.type === "STATUS_CHANGED") {
        void refreshSession();
      }
      if (message.type === "METRICS_CHANGED") {
        setMetrics(message.metrics);
      }
      if (message.type === "ERROR") {
        setError(message.message);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshSession]);

  async function send(type: RuntimeMessage["type"]) {
    setError(null);
    const response = await chrome.runtime.sendMessage({ type });
    if (response && !response.ok) {
      setError(response.error ?? "The extension could not complete that action.");
    }
    await refreshSession();
  }

  const transcriptText = useMemo(() => {
    if (!session?.segments.length) return "";
    return session.segments.map((segment) => segment.text).join(" ");
  }, [session]);

  const canStart = status === "idle" || status === "stopped" || status === "error";
  const canPause = status === "recording";
  const canResume = status === "paused";
  const canStop = status === "recording" || status === "paused" || status === "model_loading";
  const canDownload = Boolean(session?.segments.length);
  const isBusy = status === "model_loading" || status === "stopping";

  return (
    <main className="panel-shell">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Local tab audio</p>
          <h1>Snow</h1>
        </div>
      </section>

      <section className={`status-slab status-${status}`}>
        <div>
          <p className="label">Status</p>
          <strong>{statusLabels[status]}</strong>
        </div>
        <div className="status-orb" aria-hidden="true">
          {isBusy ? <Loader2 className="spin" size={22} /> : <Activity size={22} />}
        </div>
      </section>

      {error && (
        <section className="error-band" role="alert">
          {error}
        </section>
      )}

      <section className="controls-grid" aria-label="Transcription controls">
        <button className="primary" disabled={!canStart} onClick={() => void send("START_TRANSCRIPTION")} title="Start transcription">
          <Play size={18} />
          Start
        </button>
        <button disabled={!canPause} onClick={() => void send("PAUSE_TRANSCRIPTION")} title="Pause capture">
          <Pause size={18} />
          Pause
        </button>
        <button disabled={!canResume} onClick={() => void send("RESUME_TRANSCRIPTION")} title="Resume capture">
          <RotateCcw size={18} />
          Resume
        </button>
        <button disabled={!canStop} onClick={() => void send("STOP_TRANSCRIPTION")} title="Stop capture">
          <Square size={18} />
          Stop
        </button>
      </section>

      <section className="utility-row">
        <button disabled={!canDownload || !session} onClick={() => session && downloadTranscript(session)} title="Download TXT">
          <Download size={17} />
          TXT
        </button>
        <button disabled={!session} onClick={() => void send("CLEAR_TRANSCRIPT")} title="Clear local transcript">
          <Trash2 size={17} />
          Clear
        </button>
      </section>

      <section className="glass-panel">
        <div className="section-heading">
          <div>
            <p className="label">Transcript</p>
            <h2>{session?.tabTitle ?? "No active session"}</h2>
          </div>
          <Mic2 size={20} />
        </div>

        <div className="transcript-scroll">
          {session?.segments.length ? (
            session.segments.map((segment) => (
              <article className="segment" key={segment.id}>
                <time>
                  {formatDuration(segment.startMs)} - {formatDuration(segment.endMs)}
                </time>
                <p>{segment.text}</p>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Waves size={38} />
              <p>Start transcription on a tab with speech. The first local model load can take a little while.</p>
            </div>
          )}
        </div>
      </section>

      <section className="metrics-strip" aria-label="Performance diagnostics">
        <Metric label="Queue" value={String(metrics.queueLength)} />
        <Metric label="Chunk" value={metrics.lastChunkMs ? `${Math.round(metrics.lastChunkMs / 1000)}s` : "-"} />
        <Metric label="STT" value={metrics.lastTranscriptionMs ? `${Math.round(metrics.lastTranscriptionMs / 1000)}s` : "-"} />
        <Metric label="Load" value={metrics.modelLoadMs ? `${Math.round(metrics.modelLoadMs / 1000)}s` : "-"} />
      </section>

      {transcriptText && <div className="word-count">{transcriptText.split(/\s+/).length} words transcribed locally</div>}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
