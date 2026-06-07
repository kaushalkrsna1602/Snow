import React from "react";
import { createRoot } from "react-dom/client";
import { Download, PanelRightOpen, Pause, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { downloadTranscript } from "../lib/download";
import { getCurrentSession } from "../lib/storage";
import type { RuntimeMessage } from "../shared/messages";
import type { TranscriptSession } from "../shared/transcript-types";
import "../sidepanel/styles.css";
import "./popup.css";

function Popup() {
  const [session, setSession] = useState<TranscriptSession | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const status = session?.status ?? "idle";

  const refreshSession = useCallback(async () => {
    setSession(await getCurrentSession());
  }, []);

  useEffect(() => {
    void refreshSession();

    const listener = (message: RuntimeMessage) => {
      if (message.type === "SESSION_CHANGED" || message.type === "STATUS_CHANGED") {
        void refreshSession();
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshSession]);

  async function openPanel() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
    window.close();
  }

  async function send(type: RuntimeMessage["type"], close = false) {
    await chrome.runtime.sendMessage({ type });
    await refreshSession();
    if (close) {
      window.close();
    }
  }

  async function download() {
    if (session) {
      downloadTranscript(session);
      setDownloaded(true);
    }
  }

  const canStart = status === "idle" || status === "stopped" || status === "error";
  const canPause = status === "recording";
  const canResume = status === "paused";
  const canStop = status === "recording" || status === "paused" || status === "model_loading";
  const canDownload = Boolean(session?.segments.length);

  return (
    <main className="popup-shell">
      <h1>Snow</h1>
      <p>
        {downloaded
          ? "Transcript download started."
          : status === "recording"
            ? "Recording this tab locally."
            : "Capture this Chrome tab and transcribe speech locally."}
      </p>
      <button className="primary" disabled={!canStart} onClick={() => void send("START_TRANSCRIPTION", true)}>
        <Play size={18} />
        Start
      </button>
      <div className="popup-controls">
        <button disabled={!canPause} onClick={() => void send("PAUSE_TRANSCRIPTION")}>
          <Pause size={17} />
          Pause
        </button>
        <button disabled={!canResume} onClick={() => void send("RESUME_TRANSCRIPTION")}>
          <RotateCcw size={17} />
          Resume
        </button>
      </div>
      <button disabled={!canStop} onClick={() => void send("STOP_TRANSCRIPTION")}>
        <Square size={18} />
        End
      </button>
      <button disabled={!canDownload} onClick={() => void download()}>
        <Download size={18} />
        Download TXT
      </button>
      <button onClick={() => void openPanel()}>
        <PanelRightOpen size={18} />
        View transcript
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
