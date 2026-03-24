import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import { SYSTEM_PROMPT } from "@/agent/system-prompt"
import type {
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
} from "@/types/chat"
import type { JsonValue } from "@/types/common"

function isLlmMessage(message: AgentMessage): message is Message {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    (message.role === "assistant" ||
      message.role === "toolResult" ||
      message.role === "user")
  )
}

function getMessageText(message: Message): string {
  if (message.role === "assistant") {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content
    }

    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function hasToolCalls(message: Message): message is AssistantMessage {
  return (
    message.role === "assistant" &&
    message.content.some((part) => part.type === "toolCall")
  )
}

function getToolCallIds(message: AssistantMessage): Set<string> {
  const ids = new Set<string>()

  for (const block of message.content) {
    if (block.type === "toolCall") {
      ids.add(block.id)
    }
  }

  return ids
}

function isToolResultFor(
  message: Message,
  toolCallIds: Set<string>
): message is ToolResultMessage {
  return message.role === "toolResult" && toolCallIds.has(message.toolCallId)
}

function reorderMessages(messages: Message[]): Message[] {
  const result: Message[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]

    if (message && hasToolCalls(message)) {
      result.push(message)
      index += 1

      const toolCallIds = getToolCallIds(message)
      const toolResults: Message[] = []
      const otherMessages: Message[] = []

      while (index < messages.length && messages[index]?.role !== "assistant") {
        const next = messages[index]

        if (next && isToolResultFor(next, toolCallIds)) {
          toolResults.push(next)
        } else if (next) {
          otherMessages.push(next)
        }

        index += 1
      }

      result.push(...toolResults, ...otherMessages)
      continue
    }

    if (message) {
      result.push(message)
    }
    index += 1
  }

  return result
}

export function webMessageTransformer(messages: AgentMessage[]): Message[] {
  return reorderMessages(messages.filter(isLlmMessage))
}

export function toOpenAIChatMessages(messages: Message[]) {
  const transformed: Array<Record<string, JsonValue>> = [
    {
      content: SYSTEM_PROMPT,
      role: "system",
    },
  ]

  for (const message of messages) {
    if (message.role === "user") {
      transformed.push({
        content: getMessageText(message),
        role: "user",
      })
      continue
    }

    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
      const toolCalls = message.content
        .filter((part): part is ToolCall => part.type === "toolCall")
        .map((part) => ({
          function: {
            arguments: JSON.stringify(part.arguments),
            name: part.name,
          },
          id: part.id,
          type: "function",
        }))

      const assistantMessage: Record<string, JsonValue> = {
        content: text.length > 0 ? text : null,
        role: "assistant",
      }

      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls
      }

      transformed.push(assistantMessage)
      continue
    }

    transformed.push({
      content: getMessageText(message) || "(no output)",
      role: "tool",
      tool_call_id: message.toolCallId,
    })
  }

  return transformed
}

export function toOpenAIResponsesInput(messages: Message[]) {
  return messages.flatMap((message) => {
    if (message.role === "assistant") {
      const items: Array<Record<string, JsonValue>> = []
      const text = getMessageText(message)

      if (text.length > 0) {
        items.push({
          content: text,
          role: "assistant",
          type: "message",
        })
      }

      for (const block of message.content) {
        if (block.type !== "toolCall") {
          continue
        }

        const [callId, responseItemId] = block.id.split("|")
        items.push({
          arguments: JSON.stringify(block.arguments),
          call_id: callId,
          id: responseItemId,
          name: block.name,
          type: "function_call",
        })
      }

      return items
    }

    if (message.role === "toolResult") {
      const [callId] = message.toolCallId.split("|")
      return [
        {
          call_id: callId,
          output: getMessageText(message) || "(no output)",
          type: "function_call_output",
        },
      ]
    }

    return [
      {
        content: getMessageText(message),
        role: message.role,
        type: "message",
      },
    ]
  })
}

export function toAnthropicMessages(messages: Message[]) {
  const transformed: Array<Record<string, JsonValue>> = []

  for (const message of messages) {
    if (message.role === "user") {
      transformed.push({
        content: getMessageText(message),
        role: "user",
      })
      continue
    }

    if (message.role === "assistant") {
      const content: Array<Record<string, JsonValue>> = []

      for (const block of message.content) {
        if (block.type === "text" && block.text.trim().length > 0) {
          content.push({ text: block.text, type: "text" })
        }

        if (block.type === "toolCall") {
          content.push({
            id: block.id,
            input: block.arguments ?? {},
            name: block.name,
            type: "tool_use",
          })
        }
      }

      if (content.length > 0) {
        transformed.push({
          content,
          role: "assistant",
        })
      }
      continue
    }

    transformed.push({
      content: [
        {
          content: [
            {
              text: getMessageText(message) || "(no output)",
              type: "text",
            },
          ],
          is_error: message.isError,
          tool_use_id: message.toolCallId,
          type: "tool_result",
        },
      ],
      role: "user",
    })
  }

  return transformed
}

export function toGoogleContents(messages: Message[]) {
  const transformed: Array<Record<string, JsonValue>> = []

  for (const message of messages) {
    if (message.role === "user") {
      transformed.push({
        parts: [{ text: getMessageText(message) }],
        role: "user",
      })
      continue
    }

    if (message.role === "assistant") {
      const parts: Array<Record<string, JsonValue>> = []

      for (const block of message.content) {
        if (block.type === "text" && block.text.trim().length > 0) {
          parts.push({ text: block.text })
        }

        if (block.type === "toolCall") {
          parts.push({
            functionCall: {
              args: block.arguments ?? {},
              id: block.id,
              name: block.name,
            },
          })
        }
      }

      if (parts.length > 0) {
        transformed.push({
          parts,
          role: "model",
        })
      }
      continue
    }

    transformed.push({
      parts: [
        {
          functionResponse: {
            id: message.toolCallId,
            name: message.toolName,
            response: message.isError
              ? { error: getMessageText(message) || "(no output)" }
              : { output: getMessageText(message) || "(no output)" },
          },
        },
      ],
      role: "user",
    })
  }

  return transformed
}
