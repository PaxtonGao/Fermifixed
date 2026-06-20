import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface VoiceRecorder {
  started: boolean;
  stop(): void;
}

export interface VoiceRecorderCommand {
  executable: string;
  args: string[];
  shell?: boolean;
}

const MACOS_RECORDER_SWIFT = String.raw`
import AVFoundation
import Foundation

let chunkSeconds = 3.0
let silenceThreshold: Float = -50.0
let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("fermi-voice-\(UUID().uuidString)")
try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

var permission = AVCaptureDevice.authorizationStatus(for: .audio)
if permission == .notDetermined {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  AVCaptureDevice.requestAccess(for: .audio) { allowed in
    granted = allowed
    semaphore.signal()
  }
  _ = semaphore.wait(timeout: .now() + 30)
  permission = AVCaptureDevice.authorizationStatus(for: .audio)
  if !granted || permission == .denied || permission == .restricted {
    fputs("Microphone permission denied for Terminal/Fermi\n", stderr)
    exit(2)
  }
}
if permission == .denied || permission == .restricted {
  fputs("Microphone permission denied for Terminal/Fermi\n", stderr)
  exit(2)
}

let settings: [String: Any] = [
  AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
  AVSampleRateKey: 44100,
  AVNumberOfChannelsKey: 1,
  AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
]

while true {
  autoreleasepool {
    let url = root.appendingPathComponent("chunk-\(Date().timeIntervalSince1970).m4a")
    do {
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.isMeteringEnabled = true
      recorder.record()
      var loudest: Float = -160.0
      let samples = max(1, Int(chunkSeconds / 0.1))
      for _ in 0..<samples {
        Thread.sleep(forTimeInterval: chunkSeconds / Double(samples))
        recorder.updateMeters()
        loudest = max(loudest, recorder.peakPower(forChannel: 0))
      }
      recorder.stop()
      if loudest > silenceThreshold {
        print("file:\(url.path)")
        fflush(stdout)
      } else {
        try? FileManager.default.removeItem(at: url)
      }
    } catch {
      fputs("Recording failed: \(error.localizedDescription)\n", stderr)
      exit(3)
    }
  }
}
`;

export function createDefaultVoiceRecorderCommand(opts: {
  platform?: NodeJS.Platform;
  swiftPath?: string;
  tempDir?: string;
} = {}): VoiceRecorderCommand | null {
  const platform = opts.platform ?? process.platform;
  const swiftPath = opts.swiftPath ?? "/usr/bin/swift";
  if (platform !== "darwin" || !existsSync(swiftPath)) return null;
  const dir = mkdtempSync(join(opts.tempDir ?? tmpdir(), "fermi-voice-recorder-"));
  const scriptPath = join(dir, "recorder.swift");
  writeFileSync(scriptPath, MACOS_RECORDER_SWIFT);
  return { executable: swiftPath, args: [scriptPath] };
}

export function startVoiceRecorder(opts: {
  command?: string;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}): VoiceRecorder {
  let child: ChildProcess;
  try {
    if (opts.command?.trim()) {
      child = spawn(opts.command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    } else {
      const command = createDefaultVoiceRecorderCommand();
      if (!command) {
        opts.onError("当前平台没有内置录音器，请配置 voice.recorder_command");
        return { started: false, stop() {} };
      }
      child = spawn(command.executable, command.args, { shell: command.shell ?? false, stdio: ["ignore", "pipe", "pipe"] });
    }
  } catch (err) {
    opts.onError(`语音录制启动失败: ${err instanceof Error ? err.message : String(err)}`);
    return { started: false, stop() {} };
  }

  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.trim();
      if (text) opts.onTranscript(text);
    }
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  });
  child.on("error", (err) => opts.onError(`语音录制失败: ${err.message}`));
  child.on("close", (code) => {
    if (code && code !== 0) opts.onError(`语音录制退出: ${code}${stderr ? ` ${stderr.trim().slice(0, 120)}` : ""}`);
  });

  return {
    started: true,
    stop() {
      try { child.kill("SIGTERM"); } catch {}
    },
  };
}
