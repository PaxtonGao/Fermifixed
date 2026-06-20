import { describe, expect, it } from "bun:test";

import { startVoiceRecorder } from "../opentui-src/voice/voice-runtime.js";

describe("opentui voice runtime", () => {
  it("streams recorder stdout lines as transcripts", async () => {
    const seen: string[] = [];
    const recorder = startVoiceRecorder({
      command: "printf 'hello\\n确认\\n'",
      onTranscript: (text) => seen.push(text),
      onError: (message) => { throw new Error(message); },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    recorder.stop();

    expect(seen).toEqual(["hello", "确认"]);
  });
});
