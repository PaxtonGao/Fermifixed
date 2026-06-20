import { spawn } from "node:child_process";
import { basename } from "node:path";

export interface VoiceApiConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  localCommand?: string;
}

export interface VoiceRewriteContext {
  cwd: string;
  projectName: string;
  markers: readonly string[];
}

export type VoiceRewriteMode = "append" | "edit";

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

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

export async function transcribeVoiceFile(opts: {
  filePath: string;
  config: VoiceApiConfig;
  fetchFn?: FetchLike;
}): Promise<string> {
  if (opts.config.localCommand?.trim()) {
    return transcribeWithLocalCommand(opts.filePath, opts.config.localCommand);
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
    ? "You rewrite the complete composer draft from the user's spoken edit instruction. Output only the full replacement draft. Preserve facts. Do not explain."
    : "You rewrite speech into a concise coding-agent prompt. Remove filler words and politeness, correct obvious ASR mistakes, lightly expand generic debugging requests, and output only the final prompt.";
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
