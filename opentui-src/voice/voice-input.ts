export type VoiceCommand = "confirm" | "direct" | "undo" | "clear" | "dictation";

export interface VoiceMutation {
  beforeText: string;
  afterText: string;
}

const CONFIRM_PHRASES = new Set(["确认", "转录吧", "写进去", "ok", "okay", "就这样"]);
const DIRECT_PHRASES = new Set(["原文输入", "直接输入", "不用改写", "照原样写进去"]);
const UNDO_PHRASES = new Set(["撤回刚才语音", "恢复刚才那次修改", "取消刚才输入"]);
const CLEAR_PHRASES = new Set(["清空这段", "取消这段"]);
const DRAFT_REFS = ["刚才", "上面", "前面", "这段", "上一句", "我刚刚说的", "输入框里", "草稿里", "不对", "不是"];
const EDIT_ACTIONS = ["删掉", "去掉", "改成", "替换", "不要", "保留", "重写", "补一句", "挪到前面"];

function normalizeVoiceText(input: string): string {
  return input.trim().toLowerCase().replace(/[，。！？,.!?\s]+/g, "");
}

function isShortControlPhrase(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/^[\x00-\x7F]+$/.test(trimmed)) return trimmed.split(/\s+/).filter(Boolean).length <= 5;
  return Array.from(trimmed.replace(/\s+/g, "")).length <= 12;
}

export function classifyVoiceTranscript(input: string): VoiceCommand {
  if (!isShortControlPhrase(input)) return "dictation";
  const normalized = normalizeVoiceText(input);
  if (CONFIRM_PHRASES.has(normalized)) return "confirm";
  if (DIRECT_PHRASES.has(normalized)) return "direct";
  if (UNDO_PHRASES.has(normalized)) return "undo";
  if (CLEAR_PHRASES.has(normalized)) return "clear";
  return "dictation";
}

export function isVoiceDraftEdit(input: string): boolean {
  const text = input.trim();
  return DRAFT_REFS.some((word) => text.includes(word))
    && EDIT_ACTIONS.some((word) => text.includes(word));
}

export function appendVoiceText(current: string, incoming: string, separator = "\n"): string {
  const text = incoming.trim();
  if (!text) return current;
  const base = current.trimEnd();
  return base ? `${base}${separator}${text}` : text;
}

export function getVoiceUndoText(current: string, mutation: VoiceMutation | null): string | null {
  if (!mutation) return null;
  return current === mutation.afterText ? mutation.beforeText : null;
}

export function isVoiceHotkey(
  event: { name: string; ctrl?: boolean; meta?: boolean; option?: boolean; shift?: boolean; super?: boolean },
  hotkey: string | undefined,
): boolean {
  const parts = (hotkey ?? "ctrl+r").toLowerCase().replace(/\s+/g, "").split("+").filter(Boolean);
  const key = parts.pop();
  if (!key || event.name !== key) return false;
  const modifiers = new Set(parts);
  return Boolean(event.ctrl) === (modifiers.has("ctrl") || modifiers.has("control"))
    && Boolean(event.shift) === modifiers.has("shift")
    && Boolean(event.meta) === (modifiers.has("meta") || modifiers.has("alt") || modifiers.has("option"))
    && Boolean(event.super) === (modifiers.has("super") || modifiers.has("cmd") || modifiers.has("command"));
}
