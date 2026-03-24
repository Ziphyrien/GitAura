import type { RuntimeConfig } from "@/agent/runtime-types"

export function createRuntime(config?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    tools: config?.tools ?? [],
  }
}
