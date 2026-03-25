import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { RepoSource } from "@/types/storage"
import type {
  RuntimeMutationResult,
  RuntimeWorkerApi,
} from "@/agent/runtime-worker-types"

function createWorkerApi(): RuntimeWorkerApi {
  if (typeof window === "undefined" || typeof SharedWorker === "undefined") {
    throw new Error("SharedWorker runtime is only available in Chromium browsers")
  }

  return new ComlinkSharedWorker<typeof import("./runtime-shared-worker")>(
    new URL("./runtime-shared-worker", import.meta.url),
    {
      name: "gitinspect-runtime",
      type: "module",
    }
  )
}

export class RuntimeClient {
  private api?: RuntimeWorkerApi
  private connectError?: Error
  private connectPromise?: Promise<void>

  async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      return await this.connectPromise
    }

    if (this.connectError) {
      throw this.connectError
    }

    this.connectPromise = (async () => {
      this.api = createWorkerApi()
    })().catch((error) => {
      this.connectError =
        error instanceof Error ? error : new Error(String(error))
      this.connectPromise = undefined
      throw error
    })

    return await this.connectPromise
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    await this.ensureConnected()
    return (await this.api?.ensureSession(sessionId)) ?? false
  }

  async send(sessionId: string, content: string): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.send(sessionId, content)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    await this.api?.abort(sessionId)
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.api?.releaseSession(sessionId)
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setModelSelection(
      sessionId,
      providerGroup,
      modelId
    )) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setRepoSource(sessionId, repoSource)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setThinkingLevel(sessionId, thinkingLevel)) ?? {
      error: "missing-session",
      ok: false,
    }
  }
}

export const runtimeClient = new RuntimeClient()
