import { describe, expect, it } from "bun:test";

import {
  formatDisplayModelName,
  formatScopedModelName,
  normalizeModelId,
  getContextLength,
  getMultimodalSupport,
  getThinkingSupport,
  getWebSearchSupport,
  getThinkingLevels,
  getModelMaxOutputTokens,
  getExtendedCacheSupport,
} from "../src/config.js";

describe("normalizeModelId", () => {
  it("strips vendor prefix from OpenRouter-style model IDs", () => {
    expect(normalizeModelId("anthropic/claude-haiku-4.5")).toBe("claude-haiku-4.5");
    expect(normalizeModelId("anthropic/claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeModelId("openai/gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(normalizeModelId("qwen/qwen3.7-flash")).toBe("qwen3.7-flash");
    expect(normalizeModelId("moonshotai/kimi-k3")).toBe("kimi-k3");
    expect(normalizeModelId("minimax/minimax-m3")).toBe("minimax-m3");
  });

  it("returns the model ID unchanged when there is no slash", () => {
    expect(normalizeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeModelId("gpt-5.6-terra")).toBe("gpt-5.6-terra");
  });

  it("handles multiple slashes by stripping at the last one", () => {
    expect(normalizeModelId("perplexity/llama-3.1-sonar-small-128k-online"))
      .toBe("llama-3.1-sonar-small-128k-online");
  });
});

describe("OpenRouter display formatting", () => {
  it("normalizes OpenRouter model names for short UI labels", () => {
    expect(formatDisplayModelName("openrouter", "moonshotai/kimi-k3")).toBe("openrouter/kimi-k3");
    expect(formatDisplayModelName("openrouter", "qwen/qwen3.7-max")).toBe("openrouter/qwen3.7-max");
    expect(formatDisplayModelName("anthropic", "claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("formats provider-scoped labels without leaking OpenRouter vendor prefixes", () => {
    expect(formatScopedModelName("openrouter", "moonshotai/kimi-k3")).toBe("openrouter/kimi-k3");
    expect(formatScopedModelName("openrouter", "qwen/qwen3.7-flash")).toBe("openrouter/qwen3.7-flash");
    expect(formatScopedModelName("openai", "gpt-5.6-terra")).toBe("openai/gpt-5.6-terra");
  });
});

describe("getContextLength with OpenRouter model IDs", () => {
  it("recognizes OpenRouter model IDs via normalization", () => {
    expect(getContextLength("anthropic/claude-haiku-4.5")).toBe(200_000);
    expect(getContextLength("anthropic/claude-sonnet-5")).toBe(1_000_000);
    expect(getContextLength("openai/gpt-5.6-sol")).toBe(1_050_000);
    expect(getContextLength("openai/gpt-5.6-terra")).toBe(1_050_000);
    expect(getContextLength("openai/gpt-5.6-luna")).toBe(1_050_000);
    expect(getContextLength("qwen/qwen3.7-flash")).toBe(1_000_000);
    expect(getContextLength("qwen/qwen3.7-max")).toBe(1_000_000);
    expect(getContextLength("moonshotai/kimi-k3")).toBe(1_048_576);
    expect(getContextLength("minimax/minimax-m3")).toBe(1_000_000);
  });

  it("still works with exact model IDs (no prefix)", () => {
    expect(getContextLength("claude-sonnet-5")).toBe(1_000_000);
    expect(getContextLength("gpt-5.6-terra")).toBe(1_050_000);
    expect(getContextLength("qwen3.7-max")).toBe(1_000_000);
  });

  it("returns 0 for unknown models", () => {
    expect(getContextLength("unknown/unknown-model")).toBe(0);
  });

  it("respects explicit context length over lookup", () => {
    expect(getContextLength("anthropic/claude-sonnet-5", 100_000)).toBe(100_000);
  });
});

describe("getMultimodalSupport with OpenRouter model IDs", () => {
  it("recognizes OpenRouter model IDs", () => {
    expect(getMultimodalSupport("anthropic/claude-haiku-4.5")).toBe(true);
    expect(getMultimodalSupport("anthropic/claude-sonnet-5")).toBe(true);
    expect(getMultimodalSupport("openai/gpt-5.6-terra")).toBe(true);
    expect(getMultimodalSupport("qwen/qwen3.7-flash")).toBe(true);
    expect(getMultimodalSupport("moonshotai/kimi-k3")).toBe(true);
  });

  it("returns false for non-multimodal models", () => {
    expect(getMultimodalSupport("qwen/qwen3.7-max")).toBe(false);
    expect(getMultimodalSupport("xiaomi/mimo-v2.5-pro")).toBe(false);
  });

  it("respects explicit override", () => {
    expect(getMultimodalSupport("xiaomi/mimo-v2.5-pro", true)).toBe(true);
    expect(getMultimodalSupport("anthropic/claude-sonnet-5", false)).toBe(false);
  });
});

describe("getThinkingSupport with OpenRouter model IDs", () => {
  it("recognizes OpenRouter model IDs", () => {
    expect(getThinkingSupport("anthropic/claude-haiku-4.5")).toBe(true);
    expect(getThinkingSupport("anthropic/claude-opus-5")).toBe(true);
    expect(getThinkingSupport("openai/gpt-5.6-terra")).toBe(true);
    expect(getThinkingSupport("qwen/qwen3.7-flash")).toBe(true);
    expect(getThinkingSupport("qwen/qwen3.7-max")).toBe(true);
    expect(getThinkingSupport("minimax/minimax-m3")).toBe(true);
    expect(getThinkingSupport("moonshotai/kimi-k3")).toBe(true);
    expect(getThinkingSupport("z-ai/glm-5.2")).toBe(true);
  });

  it("returns false for non-thinking models", () => {
    expect(getThinkingSupport("unknown/unknown-model")).toBe(false);
  });
});

describe("getWebSearchSupport with OpenRouter", () => {
  it("defaults to false for OpenRouter provider (paid add-on)", () => {
    expect(getWebSearchSupport("anthropic/claude-sonnet-5", undefined, "openrouter")).toBe(false);
  });

  it("respects explicit override for OpenRouter", () => {
    expect(getWebSearchSupport("anthropic/claude-sonnet-5", true, "openrouter")).toBe(true);
    expect(getWebSearchSupport("anthropic/claude-sonnet-5", false, "openrouter")).toBe(false);
  });

});

describe("getThinkingLevels with OpenRouter model IDs", () => {
  it("recognizes OpenRouter model IDs", () => {
    expect(getThinkingLevels("anthropic/claude-haiku-4.5")).toEqual(
      ["off", "low", "medium", "high"],
    );
    expect(getThinkingLevels("anthropic/claude-opus-5")).toEqual(
      ["off", "low", "medium", "high", "xhigh", "max"],
    );
    expect(getThinkingLevels("openai/gpt-5.6-terra")).toEqual(
      ["none", "low", "medium", "high", "xhigh", "max"],
    );
    expect(getThinkingLevels("qwen/qwen3.7-flash")).toEqual(
      ["off", "on"],
    );
    expect(getThinkingLevels("qwen/qwen3.7-max")).toEqual(
      ["off", "on"],
    );
    expect(getThinkingLevels("minimax/minimax-m3")).toEqual(
      ["off", "on"],
    );
    expect(getThinkingLevels("moonshotai/kimi-k3")).toEqual(
      ["off", "low", "high", "max"],
    );
  });

  it("returns empty array for unknown models", () => {
    expect(getThinkingLevels("unknown/unknown-model")).toEqual([]);
  });

  it("still works with exact model IDs", () => {
    expect(getThinkingLevels("claude-opus-5")).toEqual(
      ["off", "low", "medium", "high", "xhigh", "max"],
    );
  });
});

describe("getModelMaxOutputTokens", () => {
  it("returns known values for exact model IDs", () => {
    expect(getModelMaxOutputTokens("claude-opus-5")).toBe(128_000);
    expect(getModelMaxOutputTokens("claude-haiku-4-5")).toBe(64_000);
    expect(getModelMaxOutputTokens("gpt-5.6-terra")).toBe(128_000);
    expect(getModelMaxOutputTokens("qwen3.7-flash")).toBe(65_536);
    expect(getModelMaxOutputTokens("qwen3.7-max")).toBe(65_536);
    expect(getModelMaxOutputTokens("MiniMax-M3")).toBe(128_000);
    expect(getModelMaxOutputTokens("kimi-k3")).toBe(131_072);
    expect(getModelMaxOutputTokens("glm-5.2")).toBe(131_072);
  });

  it("recognizes OpenRouter model IDs via normalization", () => {
    expect(getModelMaxOutputTokens("anthropic/claude-opus-5")).toBe(128_000);
    expect(getModelMaxOutputTokens("anthropic/claude-haiku-4.5")).toBe(64_000);
    expect(getModelMaxOutputTokens("openai/gpt-5.6-terra")).toBe(128_000);
    expect(getModelMaxOutputTokens("qwen/qwen3.7-flash")).toBe(65_536);
    expect(getModelMaxOutputTokens("qwen/qwen3.7-max")).toBe(65_536);
    expect(getModelMaxOutputTokens("minimax/minimax-m3")).toBe(128_000);
    expect(getModelMaxOutputTokens("moonshotai/kimi-k3")).toBe(131_072);
  });

  it("returns undefined for unknown models", () => {
    expect(getModelMaxOutputTokens("unknown/unknown-model")).toBeUndefined();
  });
});

describe("getExtendedCacheSupport", () => {
  it("does not infer extended cache support for GPT-5.6", () => {
    expect(getExtendedCacheSupport("gpt-5.6-sol")).toBe(false);
    expect(getExtendedCacheSupport("gpt-5.6-terra")).toBe(false);
    expect(getExtendedCacheSupport("openai/gpt-5.6-terra")).toBe(false);
  });

  it("returns false for models outside the whitelist", () => {
    expect(getExtendedCacheSupport("unknown/unknown-model")).toBe(false);
  });
});
