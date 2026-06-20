import { describe, expect, it } from "bun:test";

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
