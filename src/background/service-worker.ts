import { ensureOffscreenDocument } from "./offscreen-manager";
import type { OffscreenToServiceMessage, RuntimeMessage, ServiceToOffscreenMessage, UiCommand } from "../shared/messages";
import { appendTranscriptSegment, clearCurrentSession, createEmptySession, saveCurrentSession, setSessionStatus } from "../lib/storage";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active browser tab found.");
  }
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    throw new Error("This tab cannot be captured. Try a normal website with audio.");
  }
  return tab as chrome.tabs.Tab & { id: number };
}

async function sendToOffscreen(message: ServiceToOffscreenMessage) {
  await chrome.runtime.sendMessage(message);
}

async function broadcast(message: RuntimeMessage) {
  await chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function startTranscription() {
  const tab = await getActiveTab();
  await ensureOffscreenDocument();

  await saveCurrentSession(
    createEmptySession({
      status: "model_loading",
      tabId: tab.id,
      tabTitle: tab.title,
      tabUrl: tab.url
    })
  );
  await broadcast({ type: "SESSION_CHANGED" });

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await sendToOffscreen({
    target: "offscreen",
    type: "START_CAPTURE",
    streamId,
    tabId: tab.id,
    tabTitle: tab.title,
    tabUrl: tab.url
  });
}

async function handleUiCommand(message: UiCommand) {
  switch (message.type) {
    case "OPEN_SIDE_PANEL": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId !== undefined) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
      return;
    }
    case "START_TRANSCRIPTION":
      await startTranscription();
      return;
    case "PAUSE_TRANSCRIPTION":
      await sendToOffscreen({ target: "offscreen", type: "PAUSE_CAPTURE" });
      return;
    case "RESUME_TRANSCRIPTION":
      await sendToOffscreen({ target: "offscreen", type: "RESUME_CAPTURE" });
      return;
    case "STOP_TRANSCRIPTION":
      await sendToOffscreen({ target: "offscreen", type: "STOP_CAPTURE" });
      return;
    case "CLEAR_TRANSCRIPT":
      await clearCurrentSession();
      await broadcast({ type: "SESSION_CHANGED" });
      return;
  }
}

async function handleOffscreenMessage(message: OffscreenToServiceMessage) {
  switch (message.type) {
    case "OFFSCREEN_READY":
      return;
    case "STATUS_CHANGED":
      await setSessionStatus(message.status);
      await broadcast({ type: "STATUS_CHANGED", status: message.status });
      await broadcast({ type: "SESSION_CHANGED" });
      return;
    case "TRANSCRIPT_SEGMENT":
      await appendTranscriptSegment(message.segment);
      await broadcast({ type: "SESSION_CHANGED" });
      return;
    case "METRICS_CHANGED":
      await broadcast({ type: "METRICS_CHANGED", metrics: message.metrics });
      return;
    case "TRANSCRIPTION_ERROR":
      await setSessionStatus("error", { code: message.code, message: message.message });
      await broadcast({ type: "ERROR", code: message.code, message: message.message });
      await broadcast({ type: "SESSION_CHANGED" });
      return;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  const run = async () => {
    try {
      if ("target" in message && message.target === "service-worker") {
        await handleOffscreenMessage(message);
      } else if (
        message.type === "OPEN_SIDE_PANEL" ||
        message.type === "START_TRANSCRIPTION" ||
        message.type === "PAUSE_TRANSCRIPTION" ||
        message.type === "RESUME_TRANSCRIPTION" ||
        message.type === "STOP_TRANSCRIPTION" ||
        message.type === "CLEAR_TRANSCRIPT"
      ) {
        await handleUiCommand(message);
      }

      sendResponse({ ok: true });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unexpected extension error.";
      await setSessionStatus("error", { code: "service_worker_error", message: messageText });
      await broadcast({ type: "ERROR", code: "service_worker_error", message: messageText });
      await broadcast({ type: "SESSION_CHANGED" });
      sendResponse({ ok: false, error: messageText });
    }
  };

  run();
  return true;
});
