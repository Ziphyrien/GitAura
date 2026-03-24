// App-facing catalog helpers layered on top of the vendored pi-ai registry.
// The app no longer carries its own model snapshot; defaults are derived from the
// first model exposed by each supported provider.
import {
  getPiAiModel,
  getPiAiModels,
  getPiAiProviders,
} from "@/models/pi-ai-models"
import type { ModelDefinition, ProviderId, Usage } from "@/types/models"

const SUPPORTED_PROVIDERS = getPiAiProviders()
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-6",
  "github-copilot": "gpt-4o",
  "google-gemini-cli": "gemini-2.5-pro",
  "openai-codex": "gpt-5.1-codex-mini",
}

export function getProviders(): ProviderId[] {
  return SUPPORTED_PROVIDERS
}

export function getModels(provider: ProviderId): ModelDefinition[] {
  return getPiAiModels(provider)
}

export function getModel(provider: ProviderId, modelId: string): ModelDefinition {
  return getPiAiModel(provider, modelId) ?? getDefaultModel(provider)
}

export function getDefaultModel(provider: ProviderId): ModelDefinition {
  const defaultModel = getPiAiModel(provider, DEFAULT_MODELS[provider])

  if (!defaultModel) {
    throw new Error(`Missing default model for provider: ${provider}`)
  }

  return defaultModel
}

export function hasModel(provider: ProviderId, modelId: string): boolean {
  return Boolean(getPiAiModel(provider, modelId))
}

export function getPreferredProvider(
  providersWithAuth: ProviderId[]
): ProviderId {
  return providersWithAuth[0] ?? "openai-codex"
}

export function calculateCost(model: ModelDefinition, usage: Usage): Usage["cost"] {
  const input = (model.cost.input / 1_000_000) * usage.input
  const output = (model.cost.output / 1_000_000) * usage.output
  const cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead
  const cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite

  return {
    cacheRead,
    cacheWrite,
    input,
    output,
    total: input + output + cacheRead + cacheWrite,
  }
}
