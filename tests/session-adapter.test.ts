import type { AgentState } from "@mariozechner/pi-agent-core"
import { describe, expect, it } from "vitest"
import {
  buildInitialAgentState,
  buildSessionFromAgentState,
} from "@/agent/session-adapter"
import { getModel } from "@/models/catalog"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

function createSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    id: "session-1",
    messages: [],
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

function createAgentState(): AgentState {
  const usage = createEmptyUsage()
  usage.cost.input = 0.1
  usage.cost.output = 0.2
  usage.cost.total = 0.3
  usage.input = 10
  usage.output = 20
  usage.totalTokens = 30

  return {
    error: undefined,
    isStreaming: false,
    messages: [
      {
        content: "Audit the mounted host lifecycle",
        role: "user",
        timestamp: 1,
      },
      {
        api: "openai-codex-responses",
        content: [{ text: "Streaming stays local.", type: "text" }],
        model: "gpt-5.1-codex-mini",
        provider: "openai-codex",
        role: "assistant",
        stopReason: "stop",
        timestamp: 2,
        usage,
      },
    ],
    model: getModel("openai-codex", "gpt-5.1-codex-mini"),
    pendingToolCalls: new Set<string>(),
    streamMessage: null,
    systemPrompt: "system",
    thinkingLevel: "medium",
    tools: [],
  }
}

describe("session adapter", () => {
  it("builds agent state from a persisted session", () => {
    const session = createSession()
    const model = getModel(session.provider, session.model)
    const initialState = buildInitialAgentState(session, model, [])

    expect(initialState).toMatchObject({
      messages: session.messages,
      model,
      thinkingLevel: "medium",
      tools: [],
    })
  })

  it("maps agent state back to a persisted session shape", () => {
    const nextSession = buildSessionFromAgentState(createSession(), createAgentState())

    expect(nextSession.id).toBe("session-1")
    expect(nextSession.createdAt).toBe("2026-03-24T12:00:00.000Z")
    expect(nextSession.provider).toBe("openai-codex")
    expect(nextSession.model).toBe("gpt-5.1-codex-mini")
    expect(nextSession.messages).toHaveLength(2)
    expect(nextSession.messages[0]?.id).toBe("user-1-0")
    expect(nextSession.messages[1]?.id).toBe("assistant-2-1")
    expect(nextSession.preview).toContain("Audit the mounted host lifecycle")
    expect(nextSession.preview).toContain("Streaming stays local.")
    expect(nextSession.title).toBe("Audit the mounted host lifecycle")
    expect(nextSession.cost).toBe(0.3)
    expect(nextSession.usage.totalTokens).toBe(30)
  })
})
