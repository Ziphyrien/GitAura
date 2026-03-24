import { streamChat } from "@/agent/provider-stream"
import type { SendMessageParams, ToolDefinition } from "@/agent/runtime-types"
import { getIsoNow } from "@/lib/dates"
import { createId } from "@/lib/ids"
import { createEmptyUsage } from "@/types/models"
import { recordUsage } from "@/db/schema"
import type { AssistantMessage, UserMessage } from "@/types/chat"
import type { Usage } from "@/types/models"
import type { SessionData } from "@/types/storage"
import { persistSession, updateSessionSummaries } from "@/sessions/session-service"

function mergeUsage(left: Usage, right: Usage): Usage {
  return {
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: {
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      total: left.cost.total + right.cost.total,
    },
    input: left.input + right.input,
    output: left.output + right.output,
    totalTokens: left.totalTokens + right.totalTokens,
  }
}

export interface RuntimeConfig {
  tools: ToolDefinition[]
}

export function createRuntime(config?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    tools: config?.tools ?? [],
  }
}

export async function sendMessage(
  params: SendMessageParams
): Promise<SessionData> {
  const startedAt = Date.now()
  const userMessage: UserMessage = {
    content: params.content.trim(),
    id: createId(),
    role: "user",
    timestamp: startedAt,
  }
  const assistantDraft: AssistantMessage = {
    api: "openai-completions",
    content: [{ text: "", type: "text" }],
    id: createId(),
    model: params.model,
    provider: params.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: startedAt,
    usage: createEmptyUsage(),
  }

  let draftSession = updateSessionSummaries({
    ...params.session,
    messages: [...params.session.messages, userMessage, assistantDraft],
    model: params.model,
    provider: params.provider,
    updatedAt: getIsoNow(),
  })

  params.onSessionChange(draftSession)

  try {
    const result = await streamChat({
      messages: draftSession.messages,
      model: params.model,
      onTextDelta(delta) {
        const currentAssistant = draftSession.messages[
          draftSession.messages.length - 1
        ]

        if (currentAssistant?.role !== "assistant") {
          return
        }

        const firstPart = currentAssistant.content[0]

        if (firstPart?.type !== "text") {
          return
        }

        firstPart.text += delta
        draftSession = updateSessionSummaries({
          ...draftSession,
          updatedAt: getIsoNow(),
        })
        params.onSessionChange(draftSession)
      },
      provider: params.provider,
      providerGroup: params.session.providerGroup,
      sessionId: params.session.id,
      signal: params.signal,
      thinkingLevel: params.session.thinkingLevel,
      tools: params.tools ?? [],
    })

    const finalMessages = [...params.session.messages, userMessage, result.assistantMessage]
    const finalSession = updateSessionSummaries({
      ...params.session,
      cost: params.session.cost + result.assistantMessage.usage.cost.total,
      messages: finalMessages,
      model: params.model,
      provider: params.provider,
      updatedAt: getIsoNow(),
      usage: mergeUsage(params.session.usage, result.assistantMessage.usage),
    })

    await persistSession(finalSession)

    if (
      result.assistantMessage.stopReason === "length" ||
      result.assistantMessage.stopReason === "stop"
    ) {
      await recordUsage(
        result.assistantMessage.usage,
        params.provider,
        params.model,
        startedAt
      )
    }

    return finalSession
  } catch (error) {
    const currentAssistant = draftSession.messages[draftSession.messages.length - 1]

    if (currentAssistant?.role === "assistant") {
      currentAssistant.errorMessage =
        error instanceof Error ? error.message : "Request failed"
      currentAssistant.stopReason =
        params.signal.aborted ? "aborted" : "error"
    }

    draftSession = updateSessionSummaries({
      ...draftSession,
      updatedAt: getIsoNow(),
    })
    await persistSession(draftSession)
    return draftSession
  }
}
