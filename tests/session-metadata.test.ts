import { describe, expect, it } from "vitest"
import { createEmptyUsage } from "@/types/models"
import {
  buildPreview,
  buildSessionMetadata,
  generateTitle,
  hasPersistableExchange,
} from "@/sessions/session-metadata"
import type { SessionData } from "@/types/storage"

describe("session metadata helpers", () => {
  const messages: SessionData["messages"] = [
    {
      content: "Help me inspect the OAuth flow and persistence behavior",
      id: "user-1",
      role: "user",
      timestamp: 1,
    },
    {
      api: "openai-codex-responses",
      content: [{ text: "Here is the streamed answer.", type: "text" }],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      provider: "openai-codex",
      role: "assistant",
      stopReason: "stop",
      timestamp: 2,
      usage: createEmptyUsage(),
    },
  ]

  it("generates a chat title from the first user message", () => {
    expect(generateTitle(messages)).toBe(
      "Help me inspect the OAuth flow and persistence..."
    )
  })

  it("builds a preview from user and assistant text", () => {
    expect(buildPreview(messages)).toContain(
      "Help me inspect the OAuth flow and persistence behavior"
    )
    expect(buildPreview(messages)).toContain("Here is the streamed answer.")
  })

  it("detects whether a session should be persisted", () => {
    expect(hasPersistableExchange(messages)).toBe(true)
    expect(hasPersistableExchange([messages[0]])).toBe(false)
  })

  it("builds sidebar metadata from a full session", () => {
    const session: SessionData = {
      cost: 0.42,
      createdAt: "2026-03-23T12:00:00.000Z",
      id: "session-1",
      messages,
      model: "gpt-5.1-codex-mini",
      preview: buildPreview(messages),
      provider: "openai-codex",
      thinkingLevel: "medium",
      title: generateTitle(messages),
      updatedAt: "2026-03-23T12:01:00.000Z",
      usage: createEmptyUsage(),
    }

    expect(buildSessionMetadata(session)).toMatchObject({
      id: "session-1",
      lastModified: "2026-03-23T12:01:00.000Z",
      messageCount: 2,
      title: "Help me inspect the OAuth flow and persistence...",
    })
  })
})
