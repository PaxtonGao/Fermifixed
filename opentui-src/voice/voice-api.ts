import { basename } from "node:path";

export interface VoiceApiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface VoiceRewriteContext {
  cwd: string;
  projectName: string;
  markers: readonly string[];
}

export type VoiceRewriteMode = "append" | "edit";

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function requireApiKey(apiKey: string): void {
  if (!apiKey.trim()) throw new Error("Voice API key is missing");
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export async function transcribeVoiceFile(opts: {
  filePath: string;
  config: VoiceApiConfig;
  fetchFn?: FetchLike;
}): Promise<string> {
  requireApiKey(opts.config.apiKey);
  const fetchFn = opts.fetchFn ?? fetch;
  const file = Bun.file(opts.filePath);
  const form = new FormData();
  form.set("model", opts.config.model);
  form.set("file", file, basename(opts.filePath));

  const response = await fetchFn(endpoint(opts.config.baseUrl, "/audio/transcriptions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.config.apiKey}` },
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
  requireApiKey(opts.config.apiKey);
  const fetchFn = opts.fetchFn ?? fetch;
  const system = opts.mode === "edit"
    ? "You rewrite the complete composer draft from the user's spoken edit instruction. Output only the full replacement draft. Preserve facts. Do not explain."
    : "You rewrite speech into a concise coding-agent prompt. Remove filler words and politeness, correct obvious ASR mistakes, lightly expand generic debugging requests, and output only the final prompt.";
  const user = JSON.stringify({
    transcript: opts.transcript,
    currentDraft: opts.currentDraft,
    context: opts.context,
  });

  const response = await fetchFn(endpoint(opts.config.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.config.apiKey}`,
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
