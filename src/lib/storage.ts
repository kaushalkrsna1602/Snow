import { CURRENT_SESSION_KEY, MODEL_ID } from "../shared/constants";
import type { RecorderStatus, TranscriptSegment, TranscriptSession } from "../shared/transcript-types";
import { createId } from "./ids";
import { formatDuration } from "./time";

export function createEmptySession(input: {
  status?: RecorderStatus;
  tabId?: number;
  tabTitle?: string;
  tabUrl?: string;
} = {}): TranscriptSession {
  return {
    id: createId("session"),
    status: input.status ?? "idle",
    tabId: input.tabId,
    tabTitle: input.tabTitle,
    tabUrl: input.tabUrl,
    model: MODEL_ID,
    language: "en",
    startedAt: input.status === "recording" || input.status === "model_loading" ? new Date().toISOString() : undefined,
    segments: []
  };
}

export async function getCurrentSession(): Promise<TranscriptSession | null> {
  const result = await chrome.storage.local.get(CURRENT_SESSION_KEY);
  return (result[CURRENT_SESSION_KEY] as TranscriptSession | undefined) ?? null;
}

export async function saveCurrentSession(session: TranscriptSession) {
  await chrome.storage.local.set({ [CURRENT_SESSION_KEY]: session });
}

export async function updateCurrentSession(
  updater: (session: TranscriptSession | null) => TranscriptSession | null
): Promise<TranscriptSession | null> {
  const current = await getCurrentSession();
  const next = updater(current);
  if (next) {
    await saveCurrentSession(next);
  } else {
    await clearCurrentSession();
  }
  return next;
}

export async function setSessionStatus(status: RecorderStatus, error?: TranscriptSession["error"]) {
  return updateCurrentSession((session) => {
    const current = session ?? createEmptySession();
    return {
      ...current,
      status,
      stoppedAt: status === "stopped" || status === "error" ? new Date().toISOString() : current.stoppedAt,
      error
    };
  });
}

export async function appendTranscriptSegment(segment: TranscriptSegment) {
  return updateCurrentSession((session) => {
    const current = session ?? createEmptySession({ status: "recording" });
    return {
      ...current,
      segments: [...current.segments, segment]
    };
  });
}

export async function clearCurrentSession() {
  await chrome.storage.local.remove(CURRENT_SESSION_KEY);
}

export function getTranscriptText(session: TranscriptSession) {
  const header = [
    `Title: ${session.tabTitle ?? "Untitled tab"}`,
    session.tabUrl ? `URL: ${session.tabUrl}` : undefined,
    session.startedAt ? `Started: ${new Date(session.startedAt).toLocaleString()}` : undefined,
    session.stoppedAt ? `Stopped: ${new Date(session.stoppedAt).toLocaleString()}` : undefined,
    `Model: ${session.model}`,
    ""
  ].filter(Boolean);

  const transcript = session.segments.length
    ? session.segments
      .map((segment) => `[${formatDuration(segment.startMs)} - ${formatDuration(segment.endMs)}]\n${segment.text.trim()}`)
      .join("\n\n")
    : "No transcript segments were created.";

  return `${header.join("\n")}\nTranscript:\n\n${transcript}\n`;
}
