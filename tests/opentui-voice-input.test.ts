import { describe, expect, it } from "bun:test";

import {
  appendVoiceText,
  classifyVoiceTranscript,
  cleanVoiceTranscript,
  formatVoiceHint,
  getVoiceUndoText,
  isVoiceDraftEdit,
  isVoiceHotkey,
  isVoiceNoiseTranscript,
  resolveVoiceConfirmAction,
} from "../opentui-src/voice/voice-input.js";

describe("opentui voice input", () => {
  it("only treats short confirmation phrases as commands", () => {
    expect(classifyVoiceTranscript("确认")).toBe("confirm");
    expect(classifyVoiceTranscript("确定吧")).toBe("confirm");
    expect(classifyVoiceTranscript("写进去")).toBe("confirm");
    expect(classifyVoiceTranscript("寫進去")).toBe("confirm");
    expect(classifyVoiceTranscript("確認")).toBe("confirm");
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

  it("waits for in-flight transcription before confirming", () => {
    expect(resolveVoiceConfirmAction(false, true)).toBe("rewrite");
    expect(resolveVoiceConfirmAction(true, false)).toBe("wait");
    expect(resolveVoiceConfirmAction(false, false)).toBe("empty");
  });

  it("shows recent transcript text in the voice hint without growing unbounded", () => {
    expect(formatVoiceHint([], null)).toBe("语音转录开启，说“写进去”或按 Enter 放入输入框");
    expect(formatVoiceHint(["第一句", "第二句"], null)).toBe("语音: 第一句 第二句 (2 段)，说“写进去”或按 Enter 放入输入框");

    const longText = "帮我看看前端为什么打不开，先看依赖安装状态，再看启动日志，然后找出根因并给出修复方案";
    const hint = formatVoiceHint([longText], null, 24);
    expect(hint.startsWith("语音: ...")).toBe(true);
    expect(hint).toContain("1 段");
    expect(hint).toContain("按 Enter");
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

  it("ignores short transcripts that are only noise markers", () => {
    expect(isVoiceNoiseTranscript("clicking")).toBe(true);
    expect(isVoiceNoiseTranscript("[keyboard clicking]")).toBe(true);
    expect(isVoiceNoiseTranscript("(keyboard clacking)")).toBe(true);
    expect(isVoiceNoiseTranscript("(background chatter)")).toBe(true);
    expect(isVoiceNoiseTranscript("wind noise")).toBe(true);
    expect(isVoiceNoiseTranscript("[BLANK_AUDIO]")).toBe(true);
    expect(isVoiceNoiseTranscript("键盘声")).toBe(true);
    expect(isVoiceNoiseTranscript("ლლლლლლლლ")).toBe(true);
  });

  it("keeps normal requests that mention noise words", () => {
    expect(isVoiceNoiseTranscript("帮我修 clicking 这个测试")).toBe(false);
    expect(isVoiceNoiseTranscript("分析 wind noise 变量")).toBe(false);
  });

  it("removes repeated hallucinated prefix glyphs before normal speech", () => {
    expect(cleanVoiceTranscript("ლლლლლლლლ 你好 现在可以听见我说话吗")).toBe("你好 现在可以听见我说话吗");
    expect(cleanVoiceTranscript("你好 ლლლლ")).toBe("你好 ლლლლ");
  });

  it("removes leading parenthesized noise labels before normal speech", () => {
    expect(cleanVoiceTranscript("(keyboard clacking) 你好")).toBe("你好");
    expect(cleanVoiceTranscript("(keyboard clacking) (wind blowing) 继续看日志")).toBe("继续看日志");
  });
});
