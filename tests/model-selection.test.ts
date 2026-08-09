import { describe, expect, it } from "bun:test";

import { Config } from "../src/config.js";
import {
  resolveAgentModelEntry,
  resolveModelTierEntry,
  runtimeModelName,
} from "../src/model-selection.js";

function makeSession(provider = "openai-codex", model = "gpt-5.6-terra"): any {
  return {
    config: new Config({}),
    primaryAgent: {
      modelConfig: {
        name: runtimeModelName(provider, model),
        provider,
        model,
        apiKey: "provider-token",
      },
    },
  };
}

describe("runtime model resolution", () => {
  it("materializes model tier identities with provider credentials from the active runtime", () => {
    const session = makeSession();

    const resolved = resolveModelTierEntry(session, {
      provider: "openai-codex",
      selection_key: "gpt-5.6-luna",
      model_id: "gpt-5.6-luna",
      thinking_level: "xhigh",
    });

    expect(resolved.selectedConfigName).toBe("runtime-openai-codex-gpt-5-6-luna");
    expect(resolved.thinkingLevel).toBe("xhigh");
    expect(resolved.modelConfig).toMatchObject({
      name: "runtime-openai-codex-gpt-5-6-luna",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
    });
    expect(typeof resolved.modelConfig.apiKey).toBe("string");
    expect(resolved.modelConfig.apiKey.length).toBeGreaterThan(0);
  });

  it("materializes agent model pins through the same runtime resolver", () => {
    const session = makeSession();

    const resolved = resolveAgentModelEntry(session, {
      provider: "openai-codex",
      selection_key: "gpt-5.6-sol",
      model_id: "gpt-5.6-sol",
      thinking_level: "high",
    });

    expect(resolved.selectedConfigName).toBe("runtime-openai-codex-gpt-5-6-sol");
    expect(resolved.modelConfig).toMatchObject({
      provider: "openai-codex",
      model: "gpt-5.6-sol",
    });
    expect(typeof resolved.modelConfig.apiKey).toBe("string");
    expect(resolved.modelConfig.apiKey.length).toBeGreaterThan(0);
  });

  it("materializes the gpt-5.6-terra agent pin with its configured thinking level", () => {
    const session = makeSession();
    session.config.upsertModelRaw("custom:gpt-5.6-terra", {
      provider: "custom",
      model: "gpt-5.6-terra",
      api_key: "dummy-key",
      base_url: "https://example.test/v1",
      supports_multimodal: true,
      supports_thinking: true,
      thinking_levels: ["none", "low", "medium", "high", "xhigh", "max"],
    });

    const resolved = resolveAgentModelEntry(session, {
      provider: "custom",
      selection_key: "gpt-5.6-terra",
      model_id: "gpt-5.6-terra",
      thinking_level: "high",
    });

    expect(resolved.modelConfig).toMatchObject({
      provider: "custom",
      model: "gpt-5.6-terra",
    });
    expect(resolved.thinkingLevel).toBe("high");
  });
});
