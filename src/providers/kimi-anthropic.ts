/**
 * Kimi (Moonshot) Anthropic-compatible provider.
 *
 * Endpoints:
 *   - Global: https://api.moonshot.ai/anthropic
 *   - China:  https://api.moonshot.cn/anthropic
 *
 * Verified live (2026-05): the endpoint returns standard Anthropic Messages
 * shape with structured thinking/text blocks. Backend runs automatic prefix
 * cache — `cache_control` markers are unnecessary. `thinking.signature` is
 * absent (open-source model) so we do not round-trip it.
 *
 * Vendor quirks: K2.5/K2.6 thinking requires temperature=1; K3 uses
 * adaptive thinking with an effort level and rejects sampling parameters.
 */

import type { ModelConfig } from "../config.js";
import { getProviderDefaultBaseUrl } from "../provider-defaults.js";
import { makeAnthropicSSERepairFetch } from "./anthropic-sse-repair.js";
import { BaseAnthropicProvider } from "./anthropic-base.js";
import type { SendMessageOptions } from "./base.js";

export class KimiAnthropicProvider extends BaseAnthropicProvider {
  private static readonly _K3_MODEL_RE = /^(?:kimi-k3|k3)(?:$|[.-])/;
  private static readonly _NO_SAMPLING_PARAMS_RE = /^(?:kimi-k2\.7-code|kimi-k3|k3)(?:$|[.-])/;
  private static readonly _THINKING_TEMPERATURE_RE = /^kimi-k2\.[56](?:$|[.-])/;

  constructor(config: ModelConfig) {
    super(config);
  }

  protected override _defaultBaseUrl(): string {
    return getProviderDefaultBaseUrl(this._config.provider) ?? "https://api.moonshot.ai/anthropic";
  }

  /**
   * Kimi's `/anthropic` web_search emits `input_json_delta` events without a
   * `partial_json` field on degenerate (empty) searches, which crashes the
   * SDK's stream parser. Repair the SSE before the SDK sees it.
   */
  protected override _wrapFetch() {
    return makeAnthropicSSERepairFetch();
  }

  /**
   * Kimi prepends a "Search results for query: ..." text block before its
   * server-side web_search on every search turn. Suppress it from the live
   * stream (only relevant when web search is actually enabled).
   */
  protected override _dropsLeadingSearchPreamble(): boolean {
    return this._config.supportsWebSearch;
  }

  protected override _convertWebSearchTool(): Record<string, unknown> {
    return {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 20,
    };
  }

  protected override _applySamplingParams(
    kwargs: Record<string, unknown>,
    options?: SendMessageOptions,
  ): void {
    if (KimiAnthropicProvider._NO_SAMPLING_PARAMS_RE.test(this._config.model)) return;
    const thinkingOff = options?.thinkingLevel === "off" || options?.thinkingLevel === "none";
    if (
      this._config.supportsThinking
      && !thinkingOff
      && KimiAnthropicProvider._THINKING_TEMPERATURE_RE.test(this._config.model)
    ) {
      // Kimi K2.5/K2.6 thinking mode requires temperature=1.
      kwargs["temperature"] = 1;
      return;
    }
    const t = options?.temperature !== undefined ? options.temperature : this._config.temperature;
    if (t !== undefined) {
      kwargs["temperature"] = t;
    }
  }

  protected override _applyThinkingParams(
    kwargs: Record<string, unknown>,
    options?: SendMessageOptions,
  ): void {
    if (!KimiAnthropicProvider._K3_MODEL_RE.test(this._config.model)) {
      super._applyThinkingParams(kwargs, options);
      return;
    }
    if (!this._config.supportsThinking) return;

    const level = options?.thinkingLevel;
    if (level === "off" || level === "none") {
      kwargs["thinking"] = { type: "disabled" };
      return;
    }

    const effort = level === "low" || level === "high" || level === "max" ? level : "high";
    kwargs["thinking"] = { type: "adaptive" };
    kwargs["output_config"] = { effort };
  }
}
