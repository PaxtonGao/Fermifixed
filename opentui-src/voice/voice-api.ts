import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export interface VoiceApiConfig {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  workspaceId?: string;
  localCommand?: string;
}

export interface VoiceRewriteContext {
  cwd: string;
  projectName: string;
  markers: readonly string[];
}

export type VoiceRewriteMode = "append" | "edit";

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type WebSocketLike = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  onclose: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
};
type WebSocketFactory = (url: string, init?: { headers?: Record<string, string> }) => WebSocketLike;

const DASHSCOPE_FUN_ASR_BASE_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const DASHSCOPE_FUN_ASR_MODEL = "fun-asr-realtime";

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey?.trim()) throw new Error("Voice API key is missing");
  return apiKey;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function transcribeWithLocalCommand(filePath: string, commandTemplate: string): Promise<string> {
  const command = commandTemplate.includes("{file}")
    ? commandTemplate.replaceAll("{file}", shellQuote(filePath))
    : `${commandTemplate} ${shellQuote(filePath)}`;
  const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const errorTail = Array.from(stderr.trim()).slice(-400).join("");
  if (code) throw new Error(`Local transcription failed: ${code}${errorTail ? ` ${errorTail}` : ""}`);
  return stdout.trim();
}

function defaultWebSocketFactory(url: string, init?: { headers?: Record<string, string> }): WebSocketLike {
  const WebSocketCtor = globalThis.WebSocket as unknown as new (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => WebSocketLike;
  return new WebSocketCtor(url, init);
}

function dashScopeMessageText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return "";
}

async function transcribeWithDashScopeFunAsr(opts: {
  filePath: string;
  config: VoiceApiConfig;
  webSocketFactory?: WebSocketFactory;
}): Promise<string> {
  const apiKey = requireApiKey(opts.config.apiKey);
  const taskId = randomUUID();
  const audio = await Bun.file(opts.filePath).arrayBuffer();
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (opts.config.workspaceId?.trim()) headers["X-DashScope-WorkSpace"] = opts.config.workspaceId.trim();
  const ws = (opts.webSocketFactory ?? defaultWebSocketFactory)(
    opts.config.baseUrl ?? DASHSCOPE_FUN_ASR_BASE_URL,
    { headers },
  );

  return new Promise((resolve, reject) => {
    const texts: string[] = [];
    let settled = false;
    const timer = setTimeout(() => finish(new Error("DashScope transcription timed out")), 30000);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(texts.join("\n").trim());
    };

    const sendJson = (value: unknown) => ws.send(JSON.stringify(value));

    ws.onopen = () => {
      sendJson({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: opts.config.model ?? DASHSCOPE_FUN_ASR_MODEL,
          parameters: { sample_rate: 16000, format: "wav" },
          input: {},
        },
      });
    };
    ws.onerror = (event) => finish(new Error(`DashScope transcription failed: ${String(event.error ?? "websocket error")}`));
    ws.onclose = () => finish(new Error("DashScope transcription closed before task finished"));
    ws.onmessage = (event) => {
      const raw = dashScopeMessageText(event.data);
      if (!raw) return;
      const message = JSON.parse(raw) as {
        header?: { event?: string; error_code?: string; error_message?: string };
        payload?: { output?: { sentence?: { text?: unknown; sentence_end?: boolean; heartbeat?: boolean } } };
      };
      const eventName = message.header?.event;
      if (eventName === "task-started") {
        ws.send(audio);
        sendJson({
          header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
          payload: { input: {} },
        });
      } else if (eventName === "result-generated") {
        const sentence = message.payload?.output?.sentence;
        if (sentence?.heartbeat) return;
        if (sentence?.sentence_end && typeof sentence.text === "string" && sentence.text.trim()) {
          texts.push(sentence.text.trim());
        }
      } else if (eventName === "task-finished") {
        finish();
      } else if (eventName === "task-failed") {
        const code = message.header?.error_code ?? "unknown";
        const detail = message.header?.error_message ?? "task failed";
        finish(new Error(`DashScope transcription failed: ${code} ${detail}`));
      }
    };
  });
}

export async function transcribeVoiceFile(opts: {
  filePath: string;
  config: VoiceApiConfig;
  fetchFn?: FetchLike;
  webSocketFactory?: WebSocketFactory;
}): Promise<string> {
  if (opts.config.localCommand?.trim()) {
    return transcribeWithLocalCommand(opts.filePath, opts.config.localCommand);
  }
  if (opts.config.provider === "dashscope-fun-asr") {
    return transcribeWithDashScopeFunAsr({
      filePath: opts.filePath,
      config: opts.config,
      webSocketFactory: opts.webSocketFactory,
    });
  }
  const apiKey = requireApiKey(opts.config.apiKey);
  const fetchFn = opts.fetchFn ?? fetch;
  const file = Bun.file(opts.filePath);
  const form = new FormData();
  form.set("model", opts.config.model ?? "whisper-1");
  form.set("file", file, basename(opts.filePath));

  const response = await fetchFn(endpoint(opts.config.baseUrl ?? "https://api.openai.com/v1", "/audio/transcriptions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Voice transcription failed: ${response.status}`);
  const json = await response.json() as { text?: unknown };
  return typeof json.text === "string" ? json.text.trim() : "";
}

export async function rewriteVoicePrompt(opts: {
  transcript: string;
  currentDraft: string;
  mode: VoiceRewriteMode;
  context: VoiceRewriteContext;
  config: VoiceApiConfig;
  fetchFn?: FetchLike;
}): Promise<string> {
  const apiKey = requireApiKey(opts.config.apiKey);
  const fetchFn = opts.fetchFn ?? fetch;
  const system = opts.mode === "edit"
    ? "You rewrite the complete composer draft from the user's spoken edit instruction for a terminal coding agent. Do not answer the user. Output only the full replacement draft. Preserve facts. Do not explain."
    : "You rewrite speech into a concise prompt for a terminal coding agent. Do not answer the user, even when the transcript is a question like 'what do you think'. Convert it into an instruction for the terminal coding agent. Remove filler words and politeness, correct obvious ASR mistakes, lightly expand generic debugging requests, and output only the final prompt.";
  const user = JSON.stringify({
    transcript: opts.transcript,
    currentDraft: opts.currentDraft,
    context: opts.context,
  });

  const response = await fetchFn(endpoint(opts.config.baseUrl ?? "https://api.deepseek.com", "/chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Voice rewrite failed: ${response.status}`);
  const json = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const text = json.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}
