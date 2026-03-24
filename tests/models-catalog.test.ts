import { describe, expect, it } from "vitest"
import { createEmptyUsage } from "@/types/models"
import {
  DEFAULT_MODELS,
  calculateCost,
  getDefaultModel,
  getModel,
} from "@/models/catalog"

describe("model catalog", () => {
  it("returns the configured default models", () => {
    expect(getDefaultModel("openai-codex").id).toBe(DEFAULT_MODELS["openai-codex"])
    expect(getDefaultModel("anthropic").id).toBe(DEFAULT_MODELS.anthropic)
  })

  it("falls back to the provider default when the requested model is missing", () => {
    expect(getModel("github-copilot", "missing-model").id).toBe("gpt-4o")
  })

  it("calculates per-message cost from usage totals", () => {
    const model = getModel("openai-codex", "gpt-5.1-codex-mini")
    const usage = createEmptyUsage()
    usage.input = 1_000
    usage.output = 500
    usage.totalTokens = 1_500

    expect(calculateCost(model, usage)).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      input: 0.00025,
      output: 0.001,
      total: 0.00125,
    })
  })
})
