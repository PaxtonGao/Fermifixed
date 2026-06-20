import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rewriteVoicePrompt, transcribeVoiceFile } from "../opentui-src/voice/voice-api.js";

describe("opentui voice api", () => {
  it("sends audio to an OpenAI-compatible transcription endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ text: "确认" }), { status: 200 });
    };

    const text = await transcribeVoiceFile({
      filePath: "/tmp/test.wav",
      config: { baseUrl: "https://api.example.com/v1", model: "whisper-test", apiKey: "secret" },
      fetchFn,
    });

    expect(text).toBe("确认");
    expect(calls[0]?.url).toBe("https://api.example.com/v1/audio/transcriptions");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
  });

  it("sends rewrite requests to an OpenAI-compatible chat endpoint", async () => {
    const bodies: unknown[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "- 分析启动失败" } }] }), { status: 200 });
    };

    const text = await rewriteVoicePrompt({
      transcript: "帮我看看为什么启动不了",
      currentDraft: "",
      mode: "append",
      context: { cwd: "/repo", projectName: "repo", markers: ["package.json"] },
      config: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "secret" },
      fetchFn,
    });

    expect(text).toBe("- 分析启动失败");
    expect((bodies[0] as { model: string }).model).toBe("deepseek-chat");
    expect(JSON.stringify(bodies[0])).toContain("帮我看看为什么启动不了");
    expect(JSON.stringify(bodies[0])).toContain("package.json");
  });

  it("can transcribe with a local command", async () => {
    const text = await transcribeVoiceFile({
      filePath: "/tmp/test.wav",
      config: { localCommand: "printf '本地转录 {file}\\n'" },
    });

    expect(text).toBe("本地转录 /tmp/test.wav");
  });

  it("can transcribe with DashScope Fun-ASR over WebSocket", async () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "fermi-voice-api-")), "test.wav");
    writeFileSync(filePath, Buffer.from([1, 2, 3, 4]));
    const sent: unknown[] = [];
    const sockets: Array<{ url: string; headers?: Record<string, string> }> = [];
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: { error?: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(url: string, init?: { headers?: Record<string, string> }) {
        sockets.push({ url, headers: init?.headers });
        queueMicrotask(() => this.onopen?.());
      }

      send(data: unknown) {
        sent.push(data);
        const action = typeof data === "string" ? JSON.parse(data).header?.action : null;
        if (action === "run-task") {
          queueMicrotask(() => this.onmessage?.({
            data: JSON.stringify({ header: { event: "task-started" } }),
          }));
        } else if (action === "finish-task") {
          queueMicrotask(() => {
            this.onmessage?.({
              data: JSON.stringify({
                header: { event: "result-generated" },
                payload: { output: { sentence: { text: "打开前端", sentence_end: true } } },
              }),
            });
            this.onmessage?.({ data: JSON.stringify({ header: { event: "task-finished" } }) });
          });
        }
      }

      close() {}
    }

    const text = await transcribeVoiceFile({
      filePath,
      config: { provider: "dashscope-fun-asr", apiKey: "secret" },
      webSocketFactory: (url, init) => new FakeWebSocket(url, init),
    });

    expect(text).toBe("打开前端");
    expect(sockets[0]).toEqual({
      url: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
      headers: { Authorization: "Bearer secret" },
    });
    const runTask = JSON.parse(sent[0] as string);
    expect(runTask.header.action).toBe("run-task");
    expect(runTask.payload.model).toBe("fun-asr-realtime");
    expect(runTask.payload.parameters).toEqual({ sample_rate: 16000, format: "wav" });
    expect(sent.some((item) => item instanceof ArrayBuffer)).toBe(true);
    expect(JSON.parse(sent.at(-1) as string).header.action).toBe("finish-task");
  });

  it("reports DashScope Fun-ASR task failures", async () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "fermi-voice-api-")), "test.wav");
    writeFileSync(filePath, Buffer.from([1]));
    class FakeWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: { error?: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;

      constructor() {
        queueMicrotask(() => this.onopen?.());
      }

      send(data: unknown) {
        if (typeof data !== "string") return;
        if (JSON.parse(data).header?.action === "run-task") {
          queueMicrotask(() => this.onmessage?.({
            data: JSON.stringify({
              header: {
                event: "task-failed",
                error_code: "InvalidApiKey",
                error_message: "bad key",
              },
            }),
          }));
        }
      }

      close() {}
    }

    await expect(transcribeVoiceFile({
      filePath,
      config: { provider: "dashscope-fun-asr", apiKey: "bad" },
      webSocketFactory: () => new FakeWebSocket(),
    })).rejects.toThrow("InvalidApiKey bad key");
  });

  it("keeps the useful tail of local transcription errors", async () => {
    await expect(transcribeVoiceFile({
      filePath: "/tmp/test.wav",
      config: {
        localCommand: "printf 'startup log\\nreal failure at the end\\n' >&2; exit 3",
      },
    })).rejects.toThrow("real failure at the end");
  });

  it("rejects missing api keys before network calls", async () => {
    await expect(transcribeVoiceFile({
      filePath: "/tmp/test.wav",
      config: { baseUrl: "https://api.example.com/v1", model: "whisper-test", apiKey: "" },
      fetchFn: async () => new Response("{}"),
    })).rejects.toThrow("Voice API key is missing");
  });
});
