import { Type } from "@sinclair/typebox"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getModel } from "@/models/catalog"

const resolveProviderAuthForProvider = vi.fn()
const getProxyConfig = vi.fn()
const fetchMock = vi.fn<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>()

vi.mock("@/auth/resolve-api-key", () => ({
  resolveProviderAuthForProvider,
}))

vi.mock("@/proxy/settings", () => ({
  getProxyConfig,
}))

function createSseResponse(lines: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines.join("\n\n")))
        controller.close()
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
      },
      status: 200,
    }
  )
}

describe("provider stream", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    resolveProviderAuthForProvider.mockReset()
    getProxyConfig.mockReset()
    fetchMock.mockReset()
    globalThis.fetch = Object.assign(fetchMock, {
      preconnect: originalFetch.preconnect,
    })
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it("proxies OpenAI Codex responses and normalizes usage", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "api-key",
      isOAuth: true,
      provider: "openai-codex",
      storedValue: '{"providerId":"openai-codex"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    fetchMock.mockResolvedValue(
      createSseResponse([
        'data: {"type":"response.output_text.delta","delta":"Hello"}',
        'data: {"type":"response.completed","usage":{"input_tokens":10,"output_tokens":5,"input_cached_tokens":2}}',
      ])
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("openai-codex", "gpt-5.1-codex-mini")
    let text = ""
    const result = await streamChat({
      messages: [],
      model: "gpt-5.1-codex-mini",
      onTextDelta(delta) {
        text += delta
      },
      provider: "openai-codex",
      sessionId: "session-1",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://proxy.example/proxy/?url=${encodeURIComponent(
        `${model.baseUrl}/codex/responses`
      )}`
    )
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    ).toMatchObject({
      model: "gpt-5.1-codex-mini",
      store: false,
      stream: true,
    })
    expect(text).toBe("Hello")
    expect(result.assistantMessage.usage.input).toBe(10)
    expect(result.assistantMessage.usage.output).toBe(5)
  })

  it("parses codex tool calls and emits tool events", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "api-key",
      isOAuth: true,
      provider: "openai-codex",
      storedValue: '{"providerId":"openai-codex"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    fetchMock.mockResolvedValue(
      createSseResponse([
        'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_123","id":"fc_123","name":"read","arguments":""}}',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_123","delta":"{\\"path\\":\\"README.md\\"}"}',
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_123","id":"fc_123","name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}',
        'data: {"type":"response.completed","usage":{"input_tokens":10,"output_tokens":5,"input_cached_tokens":2}}',
      ])
    )

    const { streamChat, streamChatWithPiAgent } = await import(
      "@/agent/provider-stream"
    )

    const result = await streamChat({
      messages: [],
      model: "gpt-5.1-codex-mini",
      onTextDelta() {},
      provider: "openai-codex",
      sessionId: "session-tools",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [
        {
          description: "Read a file",
          name: "read",
          parameters: Type.Object({
            path: Type.String(),
          }),
        },
      ],
    })

    expect(result.assistantMessage.stopReason).toBe("toolUse")
    expect(result.assistantMessage.content).toContainEqual({
      arguments: { path: "README.md" },
      id: "call_123|fc_123",
      name: "read",
      type: "toolCall",
    })

    fetchMock.mockResolvedValueOnce(
      createSseResponse([
        'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_123","id":"fc_123","name":"read","arguments":""}}',
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_123","id":"fc_123","name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}',
        'data: {"type":"response.completed","usage":{"input_tokens":10,"output_tokens":5,"input_cached_tokens":2}}',
      ])
    )

    const eventStream = await streamChatWithPiAgent(
      getModel("openai-codex", "gpt-5.1-codex-mini"),
      {
        messages: [],
        tools: [
          {
            description: "Read a file",
            name: "read",
            parameters: Type.Object({
              path: Type.String(),
            }),
          },
        ],
      },
      {
        apiKey: "api-key",
        reasoning: "medium",
        sessionId: "session-tools",
      }
    )
    const events = []

    for await (const event of eventStream) {
      events.push(event.type)
    }

    expect(events).toContain("toolcall_start")
    expect(events).toContain("toolcall_end")
    expect(events).toContain("done")
  })

  it("keeps google gemini requests direct and parses the stream", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: JSON.stringify({
        projectId: "project-1",
        token: "google-access",
      }),
      isOAuth: true,
      provider: "google-gemini-cli",
      storedValue: '{"providerId":"google-gemini-cli"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    fetchMock.mockResolvedValue(
      createSseResponse([
        'data: {"response":{"text":"Gemini","usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"cachedContentTokenCount":0,"totalTokenCount":3}}}',
      ])
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("google-gemini-cli", "gemini-2.5-pro")
    let text = ""
    const result = await streamChat({
      messages: [],
      model: "gemini-2.5-pro",
      onTextDelta(delta) {
        text += delta
      },
      provider: "google-gemini-cli",
      sessionId: "session-4",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${model.baseUrl}/v1internal:streamGenerateContent?alt=sse`
    )
    expect(text).toBe("Gemini")
    expect(result.assistantMessage.usage.input).toBe(1)
    expect(result.assistantMessage.usage.output).toBe(2)
  })

  it("keeps anthropic api key requests direct", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "api-key",
      isOAuth: false,
      provider: "anthropic",
      storedValue: "sk-ant-api-1",
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    fetchMock.mockResolvedValue(
      createSseResponse([
        'event: content_block_delta\ndata: {"delta":{"text":"Claude"}}',
        'event: message_delta\ndata: {"usage":{"input_tokens":12,"output_tokens":7,"cache_read_input_tokens":1,"cache_creation_input_tokens":3}}',
        'event: message_stop\ndata: {}',
      ])
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("anthropic", "claude-sonnet-4-6")
    let text = ""
    const result = await streamChat({
      messages: [],
      model: "claude-sonnet-4-6",
      onTextDelta(delta) {
        text += delta
      },
      provider: "anthropic",
      sessionId: "session-2",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${model.baseUrl}/v1/messages`)
    expect(text).toBe("Claude")
    expect(result.assistantMessage.usage.input).toBe(12)
    expect(result.assistantMessage.usage.output).toBe(7)
  })

  it("proxies anthropic oauth requests and still parses sse", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "api-key",
      isOAuth: true,
      provider: "anthropic",
      storedValue: '{"providerId":"anthropic"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    fetchMock.mockResolvedValue(
      createSseResponse([
        'event: content_block_delta\ndata: {"delta":{"text":"Claude"}}',
        'event: message_delta\ndata: {"usage":{"input_tokens":12,"output_tokens":7,"cache_read_input_tokens":1,"cache_creation_input_tokens":3}}',
        'event: message_stop\ndata: {}',
      ])
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("anthropic", "claude-sonnet-4-6")
    let text = ""
    const result = await streamChat({
      messages: [],
      model: "claude-sonnet-4-6",
      onTextDelta(delta) {
        text += delta
      },
      provider: "anthropic",
      sessionId: "session-3",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://proxy.example/proxy/?url=${encodeURIComponent(
        `${model.baseUrl}/v1/messages`
      )}`
    )
    expect(text).toBe("Claude")
    expect(result.assistantMessage.usage.input).toBe(12)
    expect(result.assistantMessage.usage.output).toBe(7)
  })

  it("keeps github copilot requests direct", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "copilot-token",
      isOAuth: true,
      provider: "github-copilot",
      storedValue: '{"providerId":"github-copilot"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    fetchMock.mockResolvedValue(
      createSseResponse([
        'data: {"choices":[{"delta":{"content":"Copilot"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      ])
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("github-copilot", "gpt-4o")
    let text = ""
    const result = await streamChat({
      messages: [],
      model: "gpt-4o",
      onTextDelta(delta) {
        text += delta
      },
      provider: "github-copilot",
      sessionId: "session-5",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${model.baseUrl}/chat/completions`
    )
    expect(text).toBe("Copilot")
    expect(result.assistantMessage.usage.input).toBe(1)
    expect(result.assistantMessage.usage.output).toBe(2)
  })
})
