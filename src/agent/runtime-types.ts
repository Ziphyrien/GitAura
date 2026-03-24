import type { TSchema } from "@sinclair/typebox"
import type { AssistantMessage } from "@/types/chat"
import type { Message } from "@mariozechner/pi-ai"
import type { ProviderId, ThinkingLevel } from "@/types/models"
import type { SessionData } from "@/types/storage"

export interface ToolDefinition {
  description: string
  name: string
  parameters: TSchema
}

export interface StreamChatParams {
  apiKey?: string
  assistantId?: string
  assistantTimestamp?: number
  messages: Message[]
  model: string
  onTextDelta: (delta: string) => void
  provider: ProviderId
  sessionId: string
  signal: AbortSignal
  thinkingLevel: ThinkingLevel
  tools: ToolDefinition[]
}

export interface SendMessageParams {
  content: string
  model: string
  onSessionChange: (session: SessionData) => void
  provider: ProviderId
  session: SessionData
  signal: AbortSignal
  tools?: ToolDefinition[]
}

export interface StreamChatResult {
  assistantMessage: AssistantMessage
}
