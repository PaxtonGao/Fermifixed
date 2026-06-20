import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDefaultVoiceRecorderCommand, startVoiceRecorder } from "../opentui-src/voice/voice-runtime.js";

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

  it("creates a built-in macOS recorder when no recorder command is configured", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fermi-voice-test-"));
    const command = createDefaultVoiceRecorderCommand({
      platform: "darwin",
      swiftPath: "/usr/bin/swift",
      tempDir,
    });

    expect(command?.executable).toBe("/usr/bin/swift");
    expect(command?.args[0]?.endsWith(".swift")).toBe(true);
    expect(command?.args[0] && existsSync(command.args[0])).toBe(true);
    const script = readFileSync(command!.args[0]!, "utf8");
    expect(script).toContain("AVAudioRecorder");
    expect(script).toContain("let chunkSeconds = 8.0");
    expect(script).toContain("kAudioFormatLinearPCM");
    expect(script).toContain(".wav");
    expect(script).not.toContain("kAudioFormatMPEG4AAC");
  });

  it("does not pretend to have a built-in recorder on non-macOS platforms", () => {
    expect(createDefaultVoiceRecorderCommand({
      platform: "linux",
      swiftPath: "/usr/bin/swift",
      tempDir: tmpdir(),
    })).toBeNull();
  });
});
