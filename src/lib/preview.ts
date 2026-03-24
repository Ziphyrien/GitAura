import type { AssistantContent, ChatMessage, UserContent } from "@/types/chat"

function getTextFromUserContent(content: string | UserContent[]): string {
  if (typeof content === "string") {
    return content.trim()
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ")
}

function getTextFromAssistantContent(content: AssistantContent[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ")
}

export function getMessageText(message: ChatMessage): string {
  if (message.role === "user") {
    return getTextFromUserContent(message.content)
  }

  if (message.role === "assistant") {
    return getTextFromAssistantContent(message.content)
  }

  return getTextFromUserContent(message.content)
}
