import type { Model, Usage as PiUsage, Api } from "@mariozechner/pi-ai"

export type ProviderId =
  | "anthropic"
  | "github-copilot"
  | "google-gemini-cli"
  | "openai-codex"

export type ApiType = Api
export type { ThinkingLevel } from "@mariozechner/pi-agent-core"

export type ModelInput = "image" | "text"

export type Usage = PiUsage

export interface UsageCost {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  total: number
}

export type ModelDefinition = Model<ApiType>

export function createEmptyUsage(): Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      total: 0,
    },
    input: 0,
    output: 0,
    totalTokens: 0,
  }
}
