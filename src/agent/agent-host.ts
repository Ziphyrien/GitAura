import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import {
  getSessionMessages,
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  recordUsage,
} from "@/db/schema"
import { createId } from "@/lib/ids"
import { getIsoNow } from "@/lib/dates"
import { getCanonicalProvider, getModel } from "@/models/catalog"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import {
  buildInitialAgentState,
  inferMessageStatus,
  normalizeAssistantDraft,
  normalizeMessages,
  toMessageRow,
} from "@/agent/session-adapter"
import { streamChatWithPiAgent } from "@/agent/live-runtime"
import { webMessageTransformer } from "@/agent/message-transformer"
import { createRepoRuntime } from "@/repo/repo-runtime"
import { normalizeRepoSource } from "@/repo/settings"
import { buildPersistedSession } from "@/sessions/session-service"
import { createRepoTools } from "@/tools"
import type { AssistantMessage } from "@/types/chat"
import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { MessageRow, RepoSource, SessionData } from "@/types/storage"

type TerminalAssistantStatus = "aborted" | "error" | undefined

function sortByTimestamp(left: MessageRow, right: MessageRow): number {
  return left.timestamp - right.timestamp
}

export class AgentHost {
  readonly agent: Agent

  private currentAssistantMessageId?: string
  private lastDraftAssistant?: AssistantMessage
  private lastTerminalStatus: TerminalAssistantStatus
  private readonly persistedMessageIds = new Set<string>()
  private readonly recordedAssistantMessageIds = new Set<string>()
  private persistQueue = Promise.resolve()
  private promptPending = false
  private repoRuntime
  private session: SessionData
  private unsubscribe?: () => void

  constructor(session: SessionData, messages: MessageRow[]) {
    this.lastTerminalStatus = undefined
    this.session = session
    this.repoRuntime = this.createRuntime(session.repoSource)
    this.seedRecordedCosts(messages)

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
        messages,
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

  isBusy(): boolean {
    return this.promptPending || this.agent.state.isStreaming
  }

  async prompt(content: string): Promise<void> {
    const trimmed = content.trim()

    if (!trimmed) {
      return
    }

    const timestamp = Date.now()
    const userMessage: Message & { id: string } = {
      content: trimmed,
      id: createId(),
      role: "user",
      timestamp,
    }

    this.currentAssistantMessageId = createId()
    this.lastDraftAssistant = {
      api: "openai-responses",
      content: [{ text: "", type: "text" }],
      id: this.currentAssistantMessageId,
      model: this.session.model,
      provider: this.session.provider,
      role: "assistant",
      stopReason: "stop",
      timestamp,
      usage: {
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
      },
    }
    this.lastTerminalStatus = undefined
    this.promptPending = true

    const userRow = toMessageRow(this.session.id, userMessage)
    const assistantRow = toMessageRow(
      this.session.id,
      this.lastDraftAssistant,
      "streaming",
      this.currentAssistantMessageId
    )
    await this.persistSessionBoundary(
      {
        error: undefined,
        isStreaming: true,
      },
      [userRow, assistantRow],
      [
        ...this.buildCompletedRows(),
        userRow,
        assistantRow,
      ]
    )
    this.persistedMessageIds.add(userRow.id)
    this.persistedMessageIds.add(assistantRow.id)

    try {
      await this.agent.prompt(userMessage)
    } catch (error) {
      this.lastTerminalStatus = "error"
      this.session = {
        ...this.session,
        error: error instanceof Error ? error.message : "Request failed",
      }
      const currentAssistantRow = this.buildCurrentAssistantRow()
      const currentRows = this.buildCurrentRows()

      await this.persistSessionBoundary(
        {
          error: this.session.error,
          isStreaming: false,
        },
        currentAssistantRow ? [currentAssistantRow] : [],
        currentRows
      )
      this.clearActiveStreamPointers()
    } finally {
      this.promptPending = false
    }
  }

  abort(): void {
    this.lastTerminalStatus = "aborted"
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
    this.session = {
      ...this.session,
      error: undefined,
      model: modelId,
      provider,
      providerGroup,
      updatedAt: getIsoNow(),
    }
    await putSession(this.session)
  }

  async setRepoSource(repoSource?: RepoSource): Promise<SessionData> {
    this.repoRuntime = this.createRuntime(repoSource)
    this.session = {
      ...this.session,
      repoSource: normalizeRepoSource(repoSource),
      updatedAt: getIsoNow(),
    }
    this.agent.setTools(this.getAgentTools(this.repoRuntime))
    await putSession(this.session)
    return this.session
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private buildCompletedRows(): MessageRow[] {
    const normalizedMessages = normalizeMessages(this.agent.state.messages)
    let lastAssistantIndex = -1

    for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
      if (normalizedMessages[index]?.role === "assistant") {
        lastAssistantIndex = index
        break
      }
    }

    return normalizedMessages.map((message, index) => {
      const id =
        message.role === "assistant" &&
        this.currentAssistantMessageId &&
        !this.agent.state.isStreaming &&
        index === lastAssistantIndex
          ? this.currentAssistantMessageId
          : message.id

      return toMessageRow(
        this.session.id,
        message,
        inferMessageStatus(message),
        id
      )
    })
  }

  private buildCurrentAssistantRow(): MessageRow | undefined {
    const draft = normalizeAssistantDraft(this.agent.state.streamMessage)

    if (draft) {
      this.lastDraftAssistant = draft
    }

    if (!this.currentAssistantMessageId || !this.lastDraftAssistant) {
      return undefined
    }

    if (this.agent.state.isStreaming) {
      return toMessageRow(
        this.session.id,
        {
          ...this.lastDraftAssistant,
          id: this.currentAssistantMessageId,
          model: this.session.model,
          provider: this.session.provider,
        },
        "streaming",
        this.currentAssistantMessageId
      )
    }

    if (!this.lastTerminalStatus) {
      return undefined
    }

    return toMessageRow(
      this.session.id,
      {
        ...this.lastDraftAssistant,
        errorMessage:
          this.lastTerminalStatus === "error"
            ? this.agent.state.error ?? this.lastDraftAssistant.errorMessage
            : this.lastDraftAssistant.errorMessage,
        id: this.currentAssistantMessageId,
        model: this.session.model,
        provider: this.session.provider,
        stopReason: this.lastTerminalStatus === "aborted" ? "aborted" : "error",
      },
      this.lastTerminalStatus,
      this.currentAssistantMessageId
    )
  }

  private buildCurrentRows(): MessageRow[] {
    const rowsById = new Map<string, MessageRow>()

    for (const row of this.buildCompletedRows()) {
      rowsById.set(row.id, row)
    }

    const currentAssistantRow = this.buildCurrentAssistantRow()

    if (currentAssistantRow) {
      rowsById.set(currentAssistantRow.id, currentAssistantRow)
    }

    return [...rowsById.values()].sort(sortByTimestamp)
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    if (!this.agent.state.isStreaming && this.agent.state.error) {
      this.lastTerminalStatus ??= "error"
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const recordedId =
        this.currentAssistantMessageId ??
        ("id" in event.message && typeof event.message.id === "string"
          ? event.message.id
          : undefined)

      if (
        recordedId &&
        event.message.usage.cost.total > 0 &&
        !this.recordedAssistantMessageIds.has(recordedId)
      ) {
        this.recordedAssistantMessageIds.add(recordedId)
        await recordUsage(
          event.message.usage,
          this.session.provider,
          this.session.model,
          event.message.timestamp
        )
      }
    }

    if (this.agent.state.isStreaming) {
      const currentAssistantRow = this.buildCurrentAssistantRow()
      const newlyCompletedRows = this.buildCompletedRows().filter(
        (message) => !this.persistedMessageIds.has(message.id)
      )

      if (currentAssistantRow || newlyCompletedRows.length > 0) {
        await this.persistStreamingProgress(currentAssistantRow, newlyCompletedRows)
      }
      return
    }

    const currentAssistantRow = this.buildCurrentAssistantRow()
    const currentRows = this.buildCurrentRows()
    const changedMessages =
      currentAssistantRow
        ? [currentAssistantRow]
        : this.currentAssistantMessageId
          ? currentRows.filter((row) => row.id === this.currentAssistantMessageId)
          : []

    await this.persistSessionBoundary(
      {
        error: this.agent.state.error,
        isStreaming: false,
      },
      changedMessages,
      currentRows
    )
    this.clearActiveStreamPointers()
  }

  private async persistStreamingProgress(
    currentAssistantRow: MessageRow | undefined,
    newlyCompletedRows: MessageRow[]
  ): Promise<void> {
    this.persistQueue = this.persistQueue.then(async () => {
      if (newlyCompletedRows.length > 0) {
        await putMessages(newlyCompletedRows)

        for (const message of newlyCompletedRows) {
          this.persistedMessageIds.add(message.id)
        }
      }

      if (currentAssistantRow) {
        await putMessage(currentAssistantRow)
        this.persistedMessageIds.add(currentAssistantRow.id)
      }
    })

    await this.persistQueue
  }

  private async persistSessionBoundary(
    overrides: Pick<SessionData, "error" | "isStreaming">,
    changedMessages: MessageRow[],
    rowsForDerivation?: MessageRow[]
  ): Promise<void> {
    const nextSessionBase = {
      ...this.session,
      error: overrides.error,
      isStreaming: overrides.isStreaming,
      updatedAt: getIsoNow(),
    }

    const allRows =
      rowsForDerivation ??
      (await getSessionMessages(this.session.id)).map((message) => {
        const changedMessage = changedMessages.find(
          (candidate) => candidate.id === message.id
        )
        return changedMessage ?? message
      })

    this.session = buildPersistedSession(nextSessionBase, allRows)

    this.persistQueue = this.persistQueue.then(async () => {
      if (changedMessages.length > 0) {
        await putSessionAndMessages(this.session, changedMessages)

        for (const message of changedMessages) {
          this.persistedMessageIds.add(message.id)
        }
        return
      }

      await putSession(this.session)
    })

    await this.persistQueue
  }

  private clearActiveStreamPointers(): void {
    this.currentAssistantMessageId = undefined
    this.lastDraftAssistant = undefined
    this.lastTerminalStatus = undefined
  }

  private seedRecordedCosts(messages: MessageRow[]): void {
    for (const message of messages) {
      this.persistedMessageIds.add(message.id)

      if (
        message.role !== "assistant" ||
        message.status !== "completed" ||
        message.usage.cost.total <= 0
      ) {
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
