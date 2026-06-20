import { spawn, type ChildProcess } from "node:child_process";

export interface VoiceRecorder {
  stop(): void;
}

export function startVoiceRecorder(opts: {
  command: string;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}): VoiceRecorder {
  let child: ChildProcess;
  try {
    child = spawn(opts.command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    opts.onError(`语音录制启动失败: ${err instanceof Error ? err.message : String(err)}`);
    return { stop() {} };
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
    stop() {
      try { child.kill("SIGTERM"); } catch {}
    },
  };
}
