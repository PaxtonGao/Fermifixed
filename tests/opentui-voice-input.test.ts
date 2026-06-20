import { describe, expect, it } from "bun:test";

import {
  appendVoiceText,
  classifyVoiceTranscript,
  getVoiceUndoText,
  isVoiceDraftEdit,
  isVoiceHotkey,
} from "../opentui-src/voice/voice-input.js";

describe("opentui voice input", () => {
  it("only treats short confirmation phrases as commands", () => {
    expect(classifyVoiceTranscript("确认")).toBe("confirm");
    expect(classifyVoiceTranscript("ok")).toBe("confirm");
    expect(classifyVoiceTranscript("帮我实现确认按钮")).toBe("dictation");
  });

  it("supports direct-input and undo control phrases", () => {
    expect(classifyVoiceTranscript("直接输入")).toBe("direct");
    expect(classifyVoiceTranscript("撤回刚才语音")).toBe("undo");
  });

  it("requires both draft reference and edit action for draft edits", () => {
    expect(isVoiceDraftEdit("刚才那句删掉")).toBe(true);
    expect(isVoiceDraftEdit("把飞车分支改成 feature 分支")).toBe(false);
    expect(isVoiceDraftEdit("帮我看看删除按钮为什么没反应")).toBe(false);
  });

  it("appends voice text on a new line when composer already has text", () => {
    expect(appendVoiceText("分析启动失败", "查看日志")).toBe("分析启动失败\n查看日志");
    expect(appendVoiceText("", "查看日志")).toBe("查看日志");
  });

  it("only undoes when the composer still matches the last voice output", () => {
    const mutation = { beforeText: "old", afterText: "old\nvoice" };

    expect(getVoiceUndoText("old\nvoice", mutation)).toBe("old");
    expect(getVoiceUndoText("old\nvoice plus manual edit", mutation)).toBeNull();
  });

  it("recognizes the default Ctrl+R voice hotkey", () => {
    expect(isVoiceHotkey({ name: "r", ctrl: true }, undefined)).toBe(true);
    expect(isVoiceHotkey({ name: "r" }, undefined)).toBe(false);
  });
});
