import { describe, expect, it } from "vitest"
import { createEmptyUsage } from "@/types/models"
import { serializeOAuthCredentials } from "@/auth/oauth-types"
import {
  DEFAULT_MODELS,
  calculateCost,
  getCanonicalProvider,
  getConnectedProviders,
  getDefaultModel,
  getDefaultModelForGroup,
  getModel,
  getModelsForGroup,
  getProviderGroups,
  isFreeModel,
} from "@/models/catalog"

describe("model catalog", () => {
  it("does not treat a non-OAuth openai-codex key as connected", () => {
    const connected = getConnectedProviders([
      { provider: "openai-codex", value: "sk-not-oauth" },
    ])

    expect(connected).not.toContain("openai-codex")
  })

  it("treats valid OpenAI Codex OAuth credentials as connected", () => {
    const connected = getConnectedProviders([
      {
        provider: "openai-codex",
        value: serializeOAuthCredentials({
          access: "access-token",
          expires: Date.now() + 60_000,
          providerId: "openai-codex",
          refresh: "refresh-token",
        }),
      },
    ])

    expect(connected).toContain("openai-codex")
  })

  it("sorts models by id descending (newer ids first)", () => {
    const models = getModelsForGroup("openai")
    const ids = models.map((model) => model.id)
    const sorted = [...ids].sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" })
    )

    expect(ids).toEqual(sorted)
  })

  it("returns the configured default models", () => {
    expect(getDefaultModel("openai-codex").id).toBe(DEFAULT_MODELS["openai-codex"])
    expect(getDefaultModel("anthropic").id).toBe(DEFAULT_MODELS.anthropic)
  })

  it("falls back to the provider default when the requested model is missing", () => {
    expect(getModel("github-copilot", "missing-model").id).toBe("gpt-4o")
  })

  it("exposes the OpenCode provider groups and canonicalizes the free group", () => {
    expect(getProviderGroups()).toEqual(
      expect.arrayContaining(["opencode", "opencode-free"])
    )
    expect(getCanonicalProvider("opencode-free")).toBe("opencode")
  })

  it("filters the OpenCode free group to free-tier models only", () => {
    const freeModels = getModelsForGroup("opencode-free")
    const freeModelIds = freeModels.map((model) => model.id)

    expect(freeModels.length).toBeGreaterThan(0)
    expect(freeModels.every((model) => isFreeModel(model))).toBe(true)
    expect(freeModelIds).toEqual(
      expect.arrayContaining([
        "mimo-v2-omni-free",
        "mimo-v2-pro-free",
        "minimax-m2.5-free",
        "nemotron-3-super-free",
      ])
    )
    expect(freeModelIds).not.toContain("gpt-5-nano")
    expect(freeModelIds).not.toContain("big-pickle")
    expect(getDefaultModelForGroup("opencode-free").id).toBe("mimo-v2-omni-free")
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
