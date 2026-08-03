import { describe, expect, it, mock } from "bun:test";

import type { ModelConfig } from "../src/config.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { DeepSeekAnthropicProvider } from "../src/providers/deepseek-anthropic.js";
import { KimiAnthropicProvider } from "../src/providers/kimi-anthropic.js";

function anthropicConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    name: "claude-test",
    provider: "anthropic",
    model: "claude-opus-4-7",
    apiKey: "test-key",
    baseUrl: "https://api.anthropic.com",
    temperature: 0.7,
    maxTokens: 1024,
    contextLength: 1_000_000,
    supportsMultimodal: true,
    supportsThinking: true,
    thinkingBudget: 0,
    supportsWebSearch: true,
    transportProtocol: "anthropic",
    thinkingEncryption: "anthropic",
    sealedSchema: "anthropic-messages",
    extra: {},
    ...overrides,
  };
}

function deepseekConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    name: "deepseek-test",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    apiKey: "test-key",
    baseUrl: "https://api.deepseek.com/anthropic",
    temperature: 0.7,
    maxTokens: 1024,
    contextLength: 1_000_000,
    supportsMultimodal: false,
    supportsThinking: true,
    thinkingBudget: 0,
    supportsWebSearch: false,
    transportProtocol: "anthropic",
    thinkingEncryption: "none",
    sealedSchema: null,
    extra: {},
    ...overrides,
  };
}

function kimiConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    name: "kimi-test",
    provider: "kimi",
    model: "kimi-k3",
    apiKey: "test-key",
    baseUrl: "https://api.moonshot.ai/anthropic",
    temperature: 0.7,
    maxTokens: 1024,
    contextLength: 1_048_576,
    supportsMultimodal: true,
    supportsThinking: true,
    thinkingBudget: 0,
    supportsWebSearch: true,
    transportProtocol: "anthropic",
    thinkingEncryption: "none",
    sealedSchema: null,
    extra: {},
    ...overrides,
  };
}

describe("Anthropic provider request shaping", () => {
  it("uses adaptive thinking and omits sampling for Claude 5", async () => {
    const provider = new AnthropicProvider(anthropicConfig({ model: "claude-opus-5" }));
    const create = mock(async () => ({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    (provider as any)._client = { messages: { create } };

    await provider.sendMessage([{ role: "user", content: "hi" }], undefined, {
      thinkingLevel: "xhigh",
    });

    const kwargs = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(kwargs["thinking"]).toEqual({ type: "adaptive" });
    expect(kwargs["output_config"]).toEqual({ effort: "xhigh" });
    expect(kwargs["temperature"]).toBeUndefined();
  });

  it("uses adaptive thinking and omits sampling for Kimi K3", async () => {
    const provider = new KimiAnthropicProvider(kimiConfig());
    const create = mock(async () => ({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    (provider as any)._client = { messages: { create } };

    await provider.sendMessage([{ role: "user", content: "hi" }], undefined, {
      thinkingLevel: "max",
    });

    const kwargs = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(kwargs["thinking"]).toEqual({ type: "adaptive" });
    expect(kwargs["output_config"]).toEqual({ effort: "max" });
    expect(kwargs["temperature"]).toBeUndefined();
  });

  it("omits sampling for Kimi K2.7 Code", async () => {
    const provider = new KimiAnthropicProvider(kimiConfig({ model: "kimi-k2.7-code" }));
    const create = mock(async () => ({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    (provider as any)._client = { messages: { create } };

    await provider.sendMessage([{ role: "user", content: "hi" }], undefined, {
      thinkingLevel: "on",
    });

    const kwargs = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(kwargs["temperature"]).toBeUndefined();
  });

  it("forwards only betas for Claude and drops Chat/Responses-specific extras", async () => {
    const provider = new AnthropicProvider(anthropicConfig({
      extra: {
        betas: ["context-1m-2025-08-07"],
        top_p: 0.5,
        top_k: 10,
        reasoning_effort: "high",
        web_search_options: {},
        extra_body: { legacy: true },
      },
    }));

    const create = mock(async () => ({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    (provider as any)._client = { messages: { create } };

    await provider.sendMessage([{ role: "user", content: "hi" }]);

    const kwargs = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(kwargs["betas"]).toEqual(["context-1m-2025-08-07"]);
    expect(kwargs["top_p"]).toBeUndefined();
    expect(kwargs["top_k"]).toBeUndefined();
    expect(kwargs["reasoning_effort"]).toBeUndefined();
    expect(kwargs["web_search_options"]).toBeUndefined();
    expect(kwargs["extra_body"]).toBeUndefined();
  });

  it("drops unsupported extras for DeepSeek Anthropic transport too", async () => {
    const provider = new DeepSeekAnthropicProvider(deepseekConfig({
      extra: {
        reasoning_effort: "high",
        top_p: 0.5,
        web_search_options: {},
      },
    }));

    const create = mock(async () => ({
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    (provider as any)._client = { messages: { create } };

    await provider.sendMessage([{ role: "user", content: "hi" }]);

    const kwargs = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(kwargs["reasoning_effort"]).toBeUndefined();
    expect(kwargs["top_p"]).toBeUndefined();
    expect(kwargs["web_search_options"]).toBeUndefined();
  });
});
