import type { ProviderGroupId } from "@/types/models"
import type { RepoSource } from "@/types/storage"

export type RuntimeCommandError = "busy" | "missing-session"

export interface RuntimeMutationResult {
  error?: RuntimeCommandError
  ok: boolean
}

export interface RuntimeWorkerApi {
  abort(sessionId: string): Promise<void>
  ensureSession(sessionId: string): Promise<boolean>
  send(sessionId: string, content: string): Promise<RuntimeMutationResult>
  setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult>
  setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult>
}
