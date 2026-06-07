import type { TranscriptSession } from "../shared/transcript-types";
import { createTimestampedFilename } from "./time";
import { getTranscriptText } from "./storage";

export function downloadTranscript(session: TranscriptSession) {
  const blob = new Blob([getTranscriptText(session)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = createTimestampedFilename("transcript", "txt");
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();

  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
}
