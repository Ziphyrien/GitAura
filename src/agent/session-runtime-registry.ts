import { AgentHost } from "@/agent/agent-host"
import type {
  RuntimeMutationResult,
} from "@/agent/runtime-worker-types"
import { loadSessionWithMessages } from "@/sessions/session-service"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { RepoSource } from "@/types/storage"

export class SessionRuntimeRegistry {
  private readonly sessionHosts = new Map<string, AgentHost>()

  async ensureSession(sessionId: string): Promise<boolean> {
    if (this.sessionHosts.has(sessionId)) {
      return true
    }

    const loaded = await loadSessionWithMessages(sessionId)

    if (!loaded) {
      return false
    }

    this.sessionHosts.set(
      sessionId,
      new AgentHost(loaded.session, loaded.messages)
    )

    return true
  }

  async send(
    sessionId: string,
    content: string
  ): Promise<RuntimeMutationResult> {
    const exists = await this.ensureSession(sessionId)

    if (!exists) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    await host.prompt(content)

    return {
      ok: true,
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.ensureSession(sessionId)
    this.sessionHosts.get(sessionId)?.abort()
  }

  releaseSession(sessionId: string): void {
    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return
    }

    host.dispose()
    this.sessionHosts.delete(sessionId)
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult> {
    const exists = await this.ensureSession(sessionId)

    if (!exists) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    await host.setModelSelection(providerGroup, modelId)

    return {
      ok: true,
    }
  }

  async setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult> {
    const exists = await this.ensureSession(sessionId)

    if (!exists) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    await host.setRepoSource(repoSource)

    return {
      ok: true,
    }
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<RuntimeMutationResult> {
    const exists = await this.ensureSession(sessionId)

    if (!exists) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    await host.setThinkingLevel(thinkingLevel)

    return {
      ok: true,
    }
  }

  dispose(): void {
    for (const host of this.sessionHosts.values()) {
      host.dispose()
    }

    this.sessionHosts.clear()
  }
}
