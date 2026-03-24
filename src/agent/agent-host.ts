import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import { getCanonicalProvider, getModel } from "@/models/catalog"
import { recordUsage } from "@/db/schema"
import { createId } from "@/lib/ids"
import { webMessageTransformer } from "@/agent/message-transformer"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import {
  buildInitialAgentState,
  buildSessionFromAgentState,
  normalizeAssistantDraft,
} from "@/agent/session-adapter"
import { streamChatWithPiAgent } from "@/agent/live-runtime"
import { createRepoRuntime } from "@/repo/repo-runtime"
import {
  persistSession,
  persistSessionSnapshot,
  shouldSaveSession,
} from "@/sessions/session-service"
import { normalizeRepoSource } from "@/repo/settings"
import { createRepoTools } from "@/tools"
import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

export interface AgentHostSnapshot {
  error?: string
  isStreaming: boolean
  session: SessionData
  streamMessage?: import("@/types/chat").AssistantMessage
}

export class AgentHost {
  readonly agent: Agent

  private readonly listeners = new Set<(snapshot: AgentHostSnapshot) => void>()
  private readonly recordedAssistantMessageIds = new Set<string>()
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined
  private lastCheckpointAt = 0
  private lastStreamingState: boolean
  private persistQueue = Promise.resolve()
  private promptPending = false
  private repoRuntime
  private session: SessionData
  private unsubscribe?: () => void

  constructor(
    session: SessionData,
    onSnapshot?: (snapshot: AgentHostSnapshot) => void
  ) {
    this.session = session
    this.lastStreamingState = false
    this.repoRuntime = this.createRuntime(session.repoSource)
    this.seedRecordedCosts(session)
    if (onSnapshot) {
      this.listeners.add(onSnapshot)
    }

    const model = getModel(session.provider, session.model)

    this.agent = new Agent({
      convertToLlm: webMessageTransformer,
      getApiKey: async (provider) =>
        await resolveApiKeyForProvider(
          provider as ProviderId,
          this.session.providerGroup
        ),
      initialState: buildInitialAgentState(
        session,
        model,
        this.getAgentTools(this.repoRuntime)
      ),
      streamFn: streamChatWithPiAgent,
      toolExecution: "sequential",
    })
    this.agent.sessionId = session.id
    this.unsubscribe = this.agent.subscribe((event) => {
      void this.handleEvent(event)
    })
  }

  subscribe(listener: (snapshot: AgentHostSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())

    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): AgentHostSnapshot {
    return {
      error: this.agent.state.error,
      isStreaming: this.agent.state.isStreaming,
      session: this.session,
      streamMessage: normalizeAssistantDraft(this.agent.state.streamMessage),
    }
  }

  isBusy(): boolean {
    return this.promptPending || this.agent.state.isStreaming
  }

  async prompt(content: string): Promise<void> {
    const trimmed = content.trim()

    if (!trimmed) {
      return
    }

    const message: Message & { id: string } = {
      content: trimmed,
      id: createId(),
      role: "user",
      timestamp: Date.now(),
    }

    this.promptPending = true

    try {
      await this.agent.prompt(message)
    } catch {
      this.emitSnapshot()
    } finally {
      this.promptPending = false
    }
  }

  abort(): void {
    this.agent.abort()
  }

  async setModelSelection(
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    const provider = getCanonicalProvider(providerGroup)
    const model = getModel(provider, modelId)

    this.agent.setModel(model)
    this.agent.sessionId = this.session.id
    this.session = buildSessionFromAgentState(
      {
        ...this.session,
        provider,
        providerGroup,
      },
      this.agent.state
    )
    this.emitSnapshot()
    this.queuePersist(async () => {
      await persistSessionSnapshot(this.session)
    })
    await this.persistQueue
  }

  async setRepoSource(repoSource?: RepoSource): Promise<SessionData> {
    this.repoRuntime = this.createRuntime(repoSource)
    this.session = {
      ...this.session,
      repoSource: normalizeRepoSource(repoSource),
    }
    this.agent.setTools(this.getAgentTools(this.repoRuntime))
    this.emitSnapshot()
    this.queuePersist(async () => {
      await persistSessionSnapshot(this.session)
    })
    await this.persistQueue
    return this.session
  }

  dispose(): void {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer)
      this.checkpointTimer = undefined
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.listeners.clear()
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()

    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    const wasStreaming = this.lastStreamingState
    const isStreaming = this.agent.state.isStreaming
    this.lastStreamingState = isStreaming
    this.session = buildSessionFromAgentState(this.session, this.agent.state)
    this.emitSnapshot()

    if (isStreaming) {
      if (!wasStreaming) {
        this.queuePersist(async () => {
          await persistSessionSnapshot(this.session)
        })
      } else {
        this.scheduleCheckpoint()
      }
    } else if (wasStreaming) {
      this.flushScheduledCheckpoint()
      this.queuePersist(async () => {
        await persistSessionSnapshot(this.session)
      })
    }

    if (event.type !== "message_end") {
      return
    }

    this.queuePersist(async () => {
      if (shouldSaveSession(this.session)) {
        await persistSession(this.session)
      }

      if (
        event.message.role === "assistant" &&
        event.message.usage.cost.total > 0
      ) {
        const messageId =
          "id" in event.message && typeof event.message.id === "string"
            ? event.message.id
            : undefined

        if (messageId && !this.recordedAssistantMessageIds.has(messageId)) {
          this.recordedAssistantMessageIds.add(messageId)
          await recordUsage(
            event.message.usage,
            this.session.provider,
            this.session.model,
            event.message.timestamp
          )
        }
      }
    })

    await this.persistQueue
  }

  private flushScheduledCheckpoint(): void {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer)
      this.checkpointTimer = undefined
    }
  }

  private scheduleCheckpoint(): void {
    const elapsed = Date.now() - this.lastCheckpointAt

    if (elapsed >= 500) {
      this.lastCheckpointAt = Date.now()
      this.queuePersist(async () => {
        await persistSessionSnapshot(this.session)
      })
      return
    }

    if (this.checkpointTimer) {
      return
    }

    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = undefined
      this.lastCheckpointAt = Date.now()
      this.queuePersist(async () => {
        await persistSessionSnapshot(this.session)
      })
    }, 500 - elapsed)
  }

  private queuePersist(task: () => Promise<void>): void {
    this.persistQueue = this.persistQueue.then(task, task)
  }

  private seedRecordedCosts(session: SessionData): void {
    for (const message of session.messages) {
      if (message.role !== "assistant" || message.usage.cost.total <= 0) {
        continue
      }

      this.recordedAssistantMessageIds.add(message.id)
    }
  }

  private createRuntime(repoSource?: RepoSource) {
    const normalized = normalizeRepoSource(repoSource)
    return normalized ? createRepoRuntime(normalized) : undefined
  }

  private getAgentTools(runtime = this.repoRuntime) {
    return runtime ? createRepoTools(runtime).agentTools : []
  }
}
