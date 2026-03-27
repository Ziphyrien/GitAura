import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import type {
  AssistantMessage,
  SystemMessage,
  ToolResultMessage,
} from "@/types/chat"
import type { MessageRow, SessionData } from "@/types/storage"
import { GitHubFsError } from "@/repo/github-fs"
import { createEmptyUsage } from "@/types/models"

const state = {
  messagesBySession: new Map<string, Array<MessageRow>>(),
  sessions: new Map<string, SessionData>(),
}

function mergeSessionMessages(
  sessionId: string,
  messages: Array<MessageRow>
): void {
  const nextMessages = new Map<string, MessageRow>()

  for (const message of state.messagesBySession.get(sessionId) ?? []) {
    nextMessages.set(message.id, message)
  }

  for (const message of messages) {
    nextMessages.set(message.id, message)
  }

  state.messagesBySession.set(
    sessionId,
    [...nextMessages.values()].sort((left, right) => left.timestamp - right.timestamp)
  )
}

const getSession = vi.fn(async (id: string): Promise<SessionData | undefined> =>
  state.sessions.get(id)
)
const getSessionMessages = vi.fn(async (sessionId: string): Promise<Array<MessageRow>> =>
  state.messagesBySession.get(sessionId) ?? []
)
const putMessage = vi.fn(async (message: MessageRow): Promise<void> => {
  mergeSessionMessages(message.sessionId, [message])
})
const putMessages = vi.fn(async (messages: Array<MessageRow>): Promise<void> => {
  for (const message of messages) {
    mergeSessionMessages(message.sessionId, [message])
  }
})
const putSession = vi.fn(async (session: SessionData): Promise<void> => {
  state.sessions.set(session.id, session)
})
const putSessionAndMessages = vi.fn(
  async (session: SessionData, messages: Array<MessageRow>): Promise<void> => {
    state.sessions.set(session.id, session)
    mergeSessionMessages(session.id, messages)
  }
)
const recordUsage = vi.fn(
  async (
    _usage: SessionData["usage"],
    _provider: SessionData["provider"],
    _model: SessionData["model"],
    _timestamp: number
  ): Promise<void> => {}
)

const createIdMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ids", () => ({
  createId: createIdMock,
}))

type MockAgentEvent =
  | {
      message: AssistantMessage
      type: "message_end"
    }
  | {
      type: "stream_update"
    }
  | {
      message: AssistantMessage
      toolResults: ToolResultMessage[]
      type: "turn_end"
    }
  | {
      messages: AgentMessage[]
      type: "agent_end"
    }

type MockAgentState = {
  error: string | undefined
  isStreaming: boolean
  messages: Array<Message>
  model: {
    id: string
    provider: string
  }
  streamMessage: AgentMessage | null
  thinkingLevel: "medium"
}

type MockAgentClass = {
  abort: () => void
  prompt: (message: Message & { id: string }) => Promise<void>
  sessionId: string
  setModel: (model: { id: string; provider: string }) => void
  setThinkingLevel: (thinkingLevel: "medium" | "off" | "high") => void
  setTools: (tools: Array<AgentTool>) => void
  state: MockAgentState
  subscribe: (listener: (event: MockAgentEvent) => void) => () => void
}

type Subscriber = (event: MockAgentEvent) => void
let subscriber: Subscriber | undefined

const agentState: MockAgentState = {
  error: undefined as string | undefined,
  isStreaming: false,
  messages: [],
  model: {
    id: "gpt-5.1-codex-mini",
    provider: "openai-codex",
  },
  streamMessage: null,
  thinkingLevel: "medium" as const,
}

const promptMock = vi.fn(
  async (_message: Message & { id: string }): Promise<void> => {}
)
const abortMock = vi.fn(() => {})
const setModelMock = vi.fn(
  (_model: { id: string; provider: string }): void => {}
)
const setThinkingLevelMock = vi.fn(
  (_thinkingLevel: "medium" | "off" | "high"): void => {}
)
const setToolsMock = vi.fn((_tools: Array<AgentTool>): void => {})

vi.mock("@/db/schema", () => ({
  getSession,
  getSessionMessages,
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  recordUsage,
}))

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: class {
    state = agentState
    sessionId = ""

    constructor() {}

    subscribe(listener: Subscriber) {
      subscriber = listener
      return () => {
        subscriber = undefined
      }
    }

    prompt = promptMock
    abort = abortMock
    setModel = setModelMock
    setThinkingLevel = setThinkingLevelMock
    setTools = setToolsMock
  } satisfies new () => MockAgentClass,
}))

function createSession(): SessionData {
  return {
    bootstrapStatus: "ready",
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

function createAssistantMessage(
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text: "Done", type: "text" }],
    id: "assistant-1",
    model: "gpt-5.1-codex-mini",
    provider: "openai-codex",
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  }
}

function createToolResultMessage(
  overrides: Partial<ToolResultMessage> = {}
): ToolResultMessage {
  return {
    content: [{ text: "README contents", type: "text" }],
    id: "tool-result-1",
    isError: false,
    parentAssistantId: "assistant-1",
    role: "toolResult",
    timestamp: 2,
    toolCallId: "call-1",
    toolName: "read",
    ...overrides,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

function getPersistedSystemRows(): Array<
  SystemMessage & Pick<MessageRow, "sessionId" | "status">
> {
  return putSessionAndMessages.mock.calls.flatMap(([_session, messages]) =>
    messages.filter(
      (
        message
      ): message is SystemMessage & Pick<MessageRow, "sessionId" | "status"> =>
        message.role === "system"
    )
  )
}

function collectAllPersistedRows(): Array<MessageRow> {
  return [
    ...putSessionAndMessages.mock.calls.flatMap(([, rows]) => rows),
    ...putMessages.mock.calls.flatMap(([rows]) => rows),
    ...putMessage.mock.calls.map(([row]) => row),
  ]
}

describe("AgentHost persistence", () => {
  beforeEach(() => {
    state.messagesBySession = new Map()
    state.sessions = new Map()
    getSession.mockReset()
    getSessionMessages.mockReset()
    getSessionMessages.mockResolvedValue([])
    putMessage.mockClear()
    putMessages.mockClear()
    putSession.mockClear()
    putSessionAndMessages.mockClear()
    recordUsage.mockClear()
    createIdMock.mockReset()
    let generatedId = 0
    createIdMock.mockImplementation(() => `gen-${++generatedId}`)
    promptMock.mockClear()
    abortMock.mockClear()
    setModelMock.mockClear()
    setThinkingLevelMock.mockClear()
    setToolsMock.mockClear()

    getSession.mockImplementation(async (id: string) =>
      state.sessions.get(id)
    )
    getSessionMessages.mockImplementation(async (sessionId: string) =>
      state.messagesBySession.get(sessionId) ?? []
    )

    agentState.error = undefined
    agentState.isStreaming = false
    agentState.messages = []
    agentState.streamMessage = null
    subscriber = undefined
  })

  it("persists optimistic user and streaming assistant rows before completion", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockImplementation(async () => {
      const assistant = createAssistantMessage()
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "read the repo",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("read the repo")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: true,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          sessionId: "session-1",
          status: "completed",
        }),
        expect.objectContaining({
          role: "assistant",
          sessionId: "session-1",
          status: "streaming",
        }),
      ])
    )

    host.dispose()
  })

  it("drops queued session writes after disposal", async () => {
    const { SessionPersistence } = await import("@/agent/session-persistence")

    const firstWrite = createDeferred<void>()
    putSessionAndMessages.mockImplementationOnce(async () => {
      await firstWrite.promise
    })

    const persistence = new SessionPersistence(
      createSession(),
      {
        getCurrentAssistantId: () => "assistant-1",
        getError: () => undefined,
        getLastDraftAssistant: () => undefined,
        getLastTerminalStatus: () => undefined,
        getMessages: () => [],
        getStreamMessage: () => null,
        isStreaming: () => false,
        setLastDraftAssistant: () => {},
      },
      []
    )

    const first = persistence.persistPromptStart(
      {
        content: "hello",
        id: "user-1",
        role: "user",
        sessionId: "session-1",
        status: "completed",
        timestamp: 1,
      },
      {
        api: "openai-responses",
        content: [{ text: "", type: "text" }],
        id: "assistant-1",
        model: "gpt-5.1-codex-mini",
        provider: "openai-codex",
        role: "assistant",
        sessionId: "session-1",
        status: "streaming",
        stopReason: "stop",
        timestamp: 1,
        usage: createEmptyUsage(),
      }
    )
    const second = persistence.persistSessionBoundary(
      {
        bootstrapStatus: "ready",
        error: undefined,
        isStreaming: false,
      },
      [],
      []
    )

    persistence.dispose()
    firstWrite.resolve()

    await first
    await second

    expect(putSession).not.toHaveBeenCalled()
  })

  it("does not rebind seeded assistants during prompt start", async () => {
    const { SessionPersistence } = await import("@/agent/session-persistence")

    const persistence = new SessionPersistence(
      createSession(),
      {
        getCurrentAssistantId: () => "fresh-assistant-id",
        getError: () => undefined,
        getLastDraftAssistant: () => undefined,
        getLastTerminalStatus: () => undefined,
        getMessages: () => [
          {
            content: "first",
            role: "user",
            timestamp: 1,
          },
          createAssistantMessage({
            id: "seeded-assistant",
            timestamp: 2,
          }),
          createToolResultMessage({
            id: "seeded-tool",
            parentAssistantId: "seeded-assistant",
            timestamp: 3,
          }),
        ],
        getStreamMessage: () => null,
        isStreaming: () => false,
        setLastDraftAssistant: () => {},
      },
      [
        {
          ...createAssistantMessage({
            id: "seeded-assistant",
            timestamp: 2,
          }),
          sessionId: "session-1",
          status: "completed",
        },
        {
          ...createToolResultMessage({
            id: "seeded-tool",
            parentAssistantId: "seeded-assistant",
            timestamp: 3,
          }),
          sessionId: "session-1",
          status: "completed",
        },
      ]
    )

    await persistence.persistPromptStart(
      {
        content: "follow-up",
        id: "new-user-id",
        role: "user",
        sessionId: "session-1",
        status: "completed",
        timestamp: 9,
      },
      {
        ...createAssistantMessage({
          id: "fresh-assistant-id",
          timestamp: 9,
        }),
        sessionId: "session-1",
        status: "streaming",
      }
    )

    const rows = persistence.buildCompletedRows()

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seeded-assistant",
          role: "assistant",
        }),
        expect.objectContaining({
          id: "seeded-tool",
          parentAssistantId: "seeded-assistant",
          role: "toolResult",
        }),
      ])
    )
  })

  it("persists tool result rows while the stream is still active", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockImplementation(async () => {
      const toolResult = createToolResultMessage()
      agentState.isStreaming = true
      agentState.messages = [
        {
          content: "read the repo",
          role: "user",
          timestamp: 1,
        },
        toolResult,
      ]
      agentState.streamMessage = createAssistantMessage({
        content: [
          {
            arguments: { path: "README.md" },
            id: "call-1",
            name: "read",
            type: "toolCall",
          },
        ],
        id: "assistant-stream",
        stopReason: "toolUse",
        timestamp: 3,
        usage: createEmptyUsage(),
      })

      subscriber?.({ type: "stream_update" })
      agentState.isStreaming = false
      agentState.streamMessage = null
      await flushMicrotasks()
    })

    await host.prompt("read the repo")

    expect(putMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool-result-1",
          role: "toolResult",
          sessionId: "session-1",
          toolCallId: "call-1",
        }),
      ])
    )
    expect(putMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        sessionId: "session-1",
        status: "streaming",
      })
    )

    host.dispose()
  })

  it("persists the completed assistant row and clears isStreaming on normal completion", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const assistant = createAssistantMessage({
      content: [{ text: "Finished", type: "text" }],
      id: "assistant-final",
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: false,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          content: [{ text: "Finished", type: "text" }],
          role: "assistant",
          sessionId: "session-1",
          status: "completed",
        }),
      ])
    )

    host.dispose()
  })

  it("records usage only once when duplicate assistant completion events arrive", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const assistant = createAssistantMessage({
      id: "assistant-final",
      usage: {
        ...createEmptyUsage(),
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0.1,
          output: 0.2,
          total: 0.3,
        },
      },
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(recordUsage).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it("does not record usage for zero-cost assistant completions", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const assistant = createAssistantMessage({
      id: "assistant-zero-cost",
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(recordUsage).not.toHaveBeenCalled()

    host.dispose()
  })

  it("does not re-record usage for a seeded persisted assistant message", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const seededAssistant: MessageRow = {
      ...createAssistantMessage({
        id: "seeded-assistant",
        usage: {
          ...createEmptyUsage(),
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0.1,
            output: 0.1,
            total: 0.2,
          },
        },
      }),
      sessionId: "session-1",
      status: "completed",
    }
    const host = new AgentHost(createSession(), [seededAssistant])

    subscriber?.({
      message: seededAssistant,
      type: "message_end",
    })
    await flushMicrotasks()

    expect(recordUsage).not.toHaveBeenCalled()

    host.dispose()
  })

  it("persists an errored assistant row and system notice when prompt throws", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockRejectedValue(new Error("Prompt failed"))

    await host.prompt("hello")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapStatus: "ready",
        error: undefined,
        isStreaming: false,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          sessionId: "session-1",
          status: "error",
        }),
      ])
    )

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          sessionId: "session-1",
          kind: "unknown",
        }),
      ])
    )

    host.dispose()
  })

  it("persists an aborted assistant row when the host is aborted mid-stream", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true
      agentState.streamMessage = createAssistantMessage({
        content: [{ text: "Partial", type: "text" }],
        id: "assistant-partial",
        stopReason: "toolUse",
      })
      host.abort()
      agentState.isStreaming = false
      agentState.streamMessage = null
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
      ]
      subscriber?.({ type: "stream_update" })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: false,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          sessionId: "session-1",
          status: "aborted",
          stopReason: "aborted",
        }),
      ])
    )

    host.dispose()
  })

  it("dedupes repeated system notices for the same classified error", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const error = new GitHubFsError("EACCES", "Authentication required", "/")

    promptMock.mockRejectedValue(error)

    await host.prompt("first")
    await host.prompt("second")

    expect(
      putSessionAndMessages.mock.calls.filter(([_session, messages]) =>
        messages.some(
          (message) =>
            message.role === "system" && message.kind === "github_auth"
        )
      )
    ).toHaveLength(1)

    host.dispose()
  })

  it("appends multiple system notices for distinct runtime failures", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock
      .mockRejectedValueOnce(
        new GitHubFsError("EACCES", "Authentication required", "/")
      )
      .mockRejectedValueOnce(
        new GitHubFsError(
          "EACCES",
          "GitHub API rate limit exceeded (resets at 3:00:00 PM): /",
          "/"
        )
      )

    await host.prompt("first")
    await host.prompt("second")

    const systemKinds = getPersistedSystemRows().map((message) => message.kind)

    expect(systemKinds).toEqual(
      expect.arrayContaining(["github_auth", "github_rate_limit"])
    )

    host.dispose()
  })

  it("persists distinct assistant ids and parentAssistantId across a 2-round tool loop", async () => {
    createIdMock.mockReset()
    createIdMock
      .mockReturnValueOnce("user-msg-id")
      .mockReturnValueOnce("asst-round-1")
      .mockReturnValueOnce("asst-round-2")

    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    const userMsg = {
      content: "read the repo",
      role: "user",
      timestamp: 1,
    } as Message
    const assistant1 = createAssistantMessage({
      content: [
        {
          arguments: { path: "README.md" },
          id: "call-1",
          name: "read",
          type: "toolCall",
        },
      ],
      stopReason: "toolUse",
      timestamp: 2,
    })
    const toolResult1 = createToolResultMessage({
      id: "tool-row-1",
      timestamp: 3,
      toolCallId: "call-1",
    })
    const assistant2 = createAssistantMessage({
      content: [{ text: "Final answer", type: "text" }],
      id: "assistant-2-final",
      stopReason: "stop",
      timestamp: 4,
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true
      agentState.messages = [userMsg, assistant1, toolResult1]
      agentState.streamMessage = null

      subscriber?.({ type: "stream_update" })
      await host.flushPersistence()

      subscriber?.({
        message: assistant1,
        toolResults: [toolResult1],
        type: "turn_end",
      })
      await host.flushPersistence()

      agentState.messages = [userMsg, assistant1, toolResult1, assistant2]
      agentState.streamMessage = null
      agentState.isStreaming = false

      subscriber?.({
        message: assistant2,
        type: "message_end",
      })
      await host.flushPersistence()
    })

    await host.prompt("read the repo")

    expect(createIdMock).toHaveBeenCalledTimes(3)

    const allRows = collectAllPersistedRows()
    const assistantIds = new Set(
      allRows.filter((row) => row.role === "assistant").map((row) => row.id)
    )

    expect(assistantIds.has("asst-round-1")).toBe(true)
    expect(assistantIds.has("asst-round-2")).toBe(true)
    expect(
      allRows.some(
        (row) =>
          row.role === "toolResult" &&
          row.parentAssistantId === "asst-round-1" &&
          row.toolCallId === "call-1"
      )
    ).toBe(true)

    host.dispose()
  })

  it("persists three distinct assistant ids across a 3-round tool loop", async () => {
    createIdMock.mockReset()
    createIdMock
      .mockReturnValueOnce("user-msg-id")
      .mockReturnValueOnce("asst-a")
      .mockReturnValueOnce("asst-b")
      .mockReturnValueOnce("asst-c")

    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    const userMsg = {
      content: "multi",
      role: "user",
      timestamp: 1,
    } as Message
    const mkToolCall = (id: string) => ({
      arguments: {},
      id,
      name: "read",
      type: "toolCall" as const,
    })

    const assistant1 = createAssistantMessage({
      content: [mkToolCall("call-1")],
      stopReason: "toolUse",
      timestamp: 2,
    })
    const toolResult1 = createToolResultMessage({
      id: "tr-1",
      timestamp: 3,
      toolCallId: "call-1",
    })

    const assistant2 = createAssistantMessage({
      content: [mkToolCall("call-2")],
      id: "assistant-2",
      stopReason: "toolUse",
      timestamp: 4,
    })
    const toolResult2 = createToolResultMessage({
      id: "tr-2",
      timestamp: 5,
      toolCallId: "call-2",
    })

    const assistant3 = createAssistantMessage({
      content: [{ text: "Done", type: "text" }],
      id: "assistant-3",
      stopReason: "stop",
      timestamp: 6,
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true

      agentState.messages = [userMsg, assistant1, toolResult1]
      agentState.streamMessage = null
      subscriber?.({ type: "stream_update" })
      await host.flushPersistence()

      subscriber?.({
        message: assistant1,
        toolResults: [toolResult1],
        type: "turn_end",
      })
      await host.flushPersistence()

      agentState.messages = [userMsg, assistant1, toolResult1, assistant2, toolResult2]
      agentState.streamMessage = null
      subscriber?.({ type: "stream_update" })
      await host.flushPersistence()

      subscriber?.({
        message: assistant2,
        toolResults: [toolResult2],
        type: "turn_end",
      })
      await host.flushPersistence()

      agentState.messages = [
        userMsg,
        assistant1,
        toolResult1,
        assistant2,
        toolResult2,
        assistant3,
      ]
      agentState.streamMessage = null
      agentState.isStreaming = false

      subscriber?.({
        message: assistant3,
        type: "message_end",
      })
      await host.flushPersistence()
    })

    await host.prompt("multi")

    expect(createIdMock).toHaveBeenCalledTimes(4)

    const allRows = collectAllPersistedRows()
    const assistantIds = new Set(
      allRows.filter((row) => row.role === "assistant").map((row) => row.id)
    )

    expect(assistantIds.has("asst-a")).toBe(true)
    expect(assistantIds.has("asst-b")).toBe(true)
    expect(assistantIds.has("asst-c")).toBe(true)

    expect(
      allRows.some(
        (row) =>
          row.role === "toolResult" &&
          row.toolCallId === "call-1" &&
          row.parentAssistantId === "asst-a"
      )
    ).toBe(true)
    expect(
      allRows.some(
        (row) =>
          row.role === "toolResult" &&
          row.toolCallId === "call-2" &&
          row.parentAssistantId === "asst-b"
      )
    ).toBe(true)

    host.dispose()
  })

  it("does not rotate assistant id when turn_end has no tool results", async () => {
    createIdMock.mockReset()
    createIdMock.mockReturnValueOnce("user-id").mockReturnValueOnce("asst-only")

    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    const assistant1 = createAssistantMessage({
      content: [{ text: "oops", type: "text" }],
      stopReason: "error",
      timestamp: 2,
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true
      agentState.messages = [
        { content: "hello", role: "user", timestamp: 1 },
        assistant1,
      ]
      agentState.streamMessage = null

      subscriber?.({ type: "stream_update" })
      await flushMicrotasks()

      subscriber?.({
        message: assistant1,
        toolResults: [],
        type: "turn_end",
      })
      await flushMicrotasks()

      agentState.isStreaming = false
      subscriber?.({
        message: assistant1,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(createIdMock).toHaveBeenCalledTimes(2)

    const putMessagesCalls = putMessages.mock.calls.flatMap(([rows]) => rows)
    const assistantRows = putMessagesCalls.filter((row) => row.role === "assistant")
    expect(assistantRows.every((row) => row.id === "asst-only")).toBe(true)

    host.dispose()
  })

  it("keeps seeded message ids stable across a new prompt", async () => {
    createIdMock.mockReset()
    createIdMock
      .mockReturnValueOnce("new-user-id")
      .mockReturnValueOnce("new-asst-id")

    const seededAssistant: MessageRow = {
      ...createAssistantMessage({
        id: "seeded-assistant",
        timestamp: 1,
      }),
      sessionId: "session-1",
      status: "completed",
    }
    const seededTool: MessageRow = {
      ...createToolResultMessage({
        id: "seeded-tool",
        parentAssistantId: "seeded-assistant",
        timestamp: 2,
      }),
      sessionId: "session-1",
      status: "completed",
    }

    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [seededAssistant, seededTool])

    const nextAssistant = createAssistantMessage({
      id: "next-assistant-msg",
      timestamp: 10,
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        { content: "first", role: "user", timestamp: 1 },
        createAssistantMessage({
          id: "seeded-assistant",
          timestamp: 1,
        }),
        createToolResultMessage({
          id: "seeded-tool",
          parentAssistantId: "seeded-assistant",
          timestamp: 2,
        }),
        { content: "follow-up", role: "user", timestamp: 9 },
        nextAssistant,
      ]
      subscriber?.({
        message: nextAssistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("follow-up")

    const allRows = collectAllPersistedRows()
    const newAssistantRows = allRows.filter(
      (row) => row.role === "assistant" && row.id === "new-asst-id"
    )
    const seededToolRows = allRows.filter(
      (row): row is ToolResultMessage & Pick<MessageRow, "sessionId" | "status"> =>
        row.role === "toolResult" && row.id === "seeded-tool"
    )

    expect(newAssistantRows.length).toBeGreaterThan(0)
    expect(
      allRows.some(
        (row) =>
          row.role === "assistant" &&
          row.id === "new-asst-id" &&
          row.timestamp === 1
      )
    ).toBe(false)
    expect(
      seededToolRows.every(
        (row) => row.parentAssistantId === "seeded-assistant"
      )
    ).toBe(true)
    expect(
      allRows.some(
        (row) =>
          row.role === "toolResult" &&
          row.parentAssistantId === "new-asst-id"
      )
    ).toBe(false)
    expect(
      allRows.some(
        (row) => row.role === "assistant" && row.id === "new-asst-id"
      )
    ).toBe(true)
    expect(
      allRows.some(
        (row) => row.role === "assistant" && row.id === "seeded-assistant"
      )
    ).toBe(false)

    host.dispose()
  })
})
