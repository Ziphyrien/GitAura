import type { StreamFn } from "@mariozechner/pi-agent-core"
import {
  createAssistantMessageEventStream,
  type Message,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai"
import { SYSTEM_PROMPT } from "@/agent/system-prompt"
import {
  toAnthropicMessages,
  toGoogleContents,
  toOpenAIChatMessages,
  toOpenAIResponsesInput,
} from "@/agent/message-transformer"
import { resolveProviderAuthForProvider } from "@/auth/resolve-api-key"
import { calculateCost, getModel } from "@/models/catalog"
import { createId } from "@/lib/ids"
import { getProxyConfig } from "@/proxy/settings"
import { proxyAwareFetch } from "@/proxy/proxy-fetch"
import { createEmptyUsage } from "@/types/models"
import type { AssistantMessage, StopReason, ToolCall } from "@/types/chat"
import type { JsonValue } from "@/types/common"
import type { ModelDefinition, Usage } from "@/types/models"
import type {
  StreamChatParams,
  StreamChatResult,
} from "@/agent/runtime-types"

interface SseEvent {
  data: string[]
  event?: string
}

function isObject(
  value: JsonValue | undefined
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getObject(
  value: JsonValue | undefined
): { [key: string]: JsonValue } | undefined {
  return isObject(value) ? value : undefined
}

function getArray(value: JsonValue | undefined): JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function getString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function getNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined
}

function parseJson(data: string): JsonValue | undefined {
  try {
    return JSON.parse(data) as JsonValue
  } catch {
    return undefined
  }
}

async function readSseStream(
  response: Response,
  onEvent: (event: SseEvent) => void
): Promise<void> {
  const reader = response.body?.getReader()

  if (!reader) {
    throw new Error("No response body")
  }

  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent: SseEvent = { data: [] }

  while (true) {
    const result = await reader.read()

    if (result.done) {
      break
    }

    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "")

      if (!line) {
        if (currentEvent.data.length > 0) {
          onEvent(currentEvent)
        }

        currentEvent = { data: [] }
        continue
      }

      if (line.startsWith("event:")) {
        currentEvent.event = line.slice(6).trim()
        continue
      }

      if (line.startsWith("data:")) {
        currentEvent.data.push(line.slice(5).trim())
      }
    }
  }

  if (buffer.trim()) {
    for (const rawLine of buffer.split("\n")) {
      const line = rawLine.replace(/\r$/, "")

      if (!line) {
        continue
      }

      if (line.startsWith("event:")) {
        currentEvent.event = line.slice(6).trim()
        continue
      }

      if (line.startsWith("data:")) {
        currentEvent.data.push(line.slice(5).trim())
      }
    }
  }

  if (currentEvent.data.length > 0) {
    onEvent(currentEvent)
  }
}

function createAssistantDraft(
  model: ModelDefinition,
  id?: string,
  timestamp = Date.now()
): AssistantMessage {
  return {
    api: model.api,
    content: [],
    id: id ?? createId(),
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: createEmptyUsage(),
  }
}

function setStopReason(
  assistant: AssistantMessage,
  reason: StopReason | undefined
): void {
  if (reason) {
    assistant.stopReason = reason
  }
}

function applyUsage(
  assistant: AssistantMessage,
  model: ModelDefinition,
  usage: Partial<Usage>
): void {
  assistant.usage = {
    cacheRead: usage.cacheRead ?? assistant.usage.cacheRead,
    cacheWrite: usage.cacheWrite ?? assistant.usage.cacheWrite,
    cost: assistant.usage.cost,
    input: usage.input ?? assistant.usage.input,
    output: usage.output ?? assistant.usage.output,
    totalTokens: usage.totalTokens ?? assistant.usage.totalTokens,
  }
  assistant.usage.cost = calculateCost(model, assistant.usage)
}

function appendDelta(
  assistant: AssistantMessage,
  delta: string,
  onTextDelta: (delta: string) => void
): void {
  if (!delta) {
    return
  }

  let current = assistant.content[assistant.content.length - 1]

  if (!current || current.type !== "text") {
    current = { text: "", type: "text" }
    assistant.content.push(current)
  }

  current.text += delta
  onTextDelta(delta)
}

function parseStreamingArguments(value: string): Record<string, JsonValue> {
  const parsed = parseJson(value)
  return isObject(parsed) ? parsed : {}
}

function serializeToolParameters(
  parameters: StreamChatParams["tools"][number]["parameters"]
): JsonValue {
  return JSON.parse(JSON.stringify(parameters)) as JsonValue
}

function ensureToolCall(
  assistant: AssistantMessage,
  id: string,
  name: string
): ToolCall & { partialJson?: string } {
  const existing = assistant.content.find(
    (part): part is ToolCall & { partialJson?: string } =>
      part.type === "toolCall" && part.id === id
  )

  if (existing) {
    if (name.length > 0) {
      existing.name = name
    }
    return existing
  }

  const toolCall: ToolCall & { partialJson?: string } = {
    arguments: {},
    id,
    name,
    type: "toolCall",
  }
  assistant.content.push(toolCall)
  return toolCall
}

function extractGoogleFunctionCalls(
  value: JsonValue | undefined,
  results: ToolCall[] = []
): ToolCall[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      extractGoogleFunctionCalls(item, results)
    }
    return results
  }

  if (!isObject(value)) {
    return results
  }

  const functionCall = getObject(value.functionCall)

  if (functionCall) {
    const name = getString(functionCall.name)

    if (name) {
      results.push({
        arguments: getObject(functionCall.args) ?? {},
        id:
          getString(functionCall.id) ??
          `${name}_${results.length + 1}`,
        name,
        type: "toolCall",
      })
    }
  }

  for (const child of Object.values(value)) {
    extractGoogleFunctionCalls(child, results)
  }

  return results
}

function finalizeToolCalls(assistant: AssistantMessage): void {
  for (const part of assistant.content) {
    if (part.type === "toolCall" && "partialJson" in part) {
      delete (
        part as ToolCall & {
          partialJson?: string
        }
      ).partialJson
    }
  }
}

function inferCopilotHeaders(messages: Message[]) {
  const last = messages[messages.length - 1]
  const hasImages = messages.some((message) =>
    message.role === "user" &&
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image")
  )

  return {
    ...(hasImages ? { "Copilot-Vision-Request": "true" } : {}),
    "Openai-Intent": "conversation-edits",
    "X-Initiator": last && last.role !== "user" ? "agent" : "user",
  }
}

function resolveCodexUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "")

  if (normalized.endsWith("/codex/responses")) {
    return normalized
  }

  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`
  }

  return `${normalized}/codex/responses`
}

function shouldProxyProviderRequest(provider: StreamChatParams["provider"], storedValue: string): boolean {
  if (provider === "openai-codex") {
    return true
  }

  return (
    provider === "anthropic" &&
    (storedValue.startsWith("{") || storedValue.startsWith("sk-ant-oat"))
  )
}

async function sendOpenAICompletions(
  params: StreamChatParams,
  model: ModelDefinition,
  apiKey: string,
  proxyUrl?: string
): Promise<StreamChatResult> {
  const assistant = createAssistantDraft(
    model,
    params.assistantId,
    params.assistantTimestamp
  )
  const response = await proxyAwareFetch({
    proxyUrl,
    requestInit: {
      body: JSON.stringify({
        max_tokens: model.maxTokens,
        messages: toOpenAIChatMessages(params.messages),
        model: model.id,
        stream: true,
        stream_options: {
          include_usage: true,
        },
        tool_choice: params.tools.length > 0 ? "auto" : undefined,
        tools:
          params.tools.length > 0
            ? params.tools.map((tool) => ({
                function: {
                  description: tool.description,
                  name: tool.name,
                  parameters: serializeToolParameters(tool.parameters),
                },
                type: "function",
              }))
            : undefined,
      }),
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...model.headers,
        ...(model.provider === "github-copilot"
          ? inferCopilotHeaders(params.messages)
          : {}),
      },
      method: "POST",
      signal: params.signal,
    },
    targetUrl: `${model.baseUrl}/chat/completions`,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  await readSseStream(response, (event) => {
    const payload = event.data.join("\n")

    if (!payload || payload === "[DONE]") {
      return
    }

    const data = getObject(parseJson(payload))
    const choices = getArray(data?.choices)
    const firstChoice = getObject(choices?.[0])
    const delta = getObject(firstChoice?.delta)
    appendDelta(
      assistant,
      getString(delta?.content) ?? "",
      params.onTextDelta
    )

    const toolCalls = getArray(delta?.tool_calls)

    if (toolCalls) {
      for (const item of toolCalls) {
        const toolCall = getObject(item)
        const functionCall = getObject(toolCall?.function)
        const id = getString(toolCall?.id) ?? ""
        const name = getString(functionCall?.name) ?? ""
        const argumentsDelta = getString(functionCall?.arguments) ?? ""
        const block = ensureToolCall(assistant, id, name)

        block.partialJson = `${block.partialJson ?? ""}${argumentsDelta}`
        block.arguments = parseStreamingArguments(block.partialJson)
      }
    }

    setStopReason(
      assistant,
      getString(firstChoice?.finish_reason) === "length"
        ? "length"
        : getString(firstChoice?.finish_reason) === "tool_calls"
          ? "toolUse"
          : undefined
    )

    const usage = getObject(data?.usage)

    if (usage) {
      applyUsage(assistant, model, {
        cacheRead:
          getNumber(getObject(usage.prompt_tokens_details)?.cached_tokens) ?? 0,
        cacheWrite: 0,
        input: getNumber(usage.prompt_tokens) ?? 0,
        output: getNumber(usage.completion_tokens) ?? 0,
        totalTokens: getNumber(usage.total_tokens) ?? 0,
      })
    }
  })

  if (
    assistant.content.some((part) => part.type === "toolCall") &&
    assistant.stopReason === "stop"
  ) {
    assistant.stopReason = "toolUse"
  }

  finalizeToolCalls(assistant)

  return { assistantMessage: assistant }
}

async function sendOpenAICodexResponses(
  params: StreamChatParams,
  model: ModelDefinition,
  apiKey: string,
  proxyUrl?: string
): Promise<StreamChatResult> {
  const assistant = createAssistantDraft(
    model,
    params.assistantId,
    params.assistantTimestamp
  )
  const response = await proxyAwareFetch({
    proxyUrl,
    requestInit: {
      body: JSON.stringify({
        include: ["reasoning.encrypted_content"],
        input: toOpenAIResponsesInput(params.messages),
        instructions: SYSTEM_PROMPT,
        model: model.id,
        parallel_tool_calls: true,
        prompt_cache_key: params.sessionId,
        store: false,
        stream: true,
        text: {
          verbosity: "medium",
        },
        tool_choice: "auto",
        tools:
          params.tools.length > 0
            ? params.tools.map((tool) => ({
                description: tool.description,
                name: tool.name,
                parameters: serializeToolParameters(tool.parameters),
                strict: null,
                type: "function",
              }))
            : undefined,
      }),
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "responses=experimental",
      },
      method: "POST",
      signal: params.signal,
    },
    targetUrl: resolveCodexUrl(model.baseUrl),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  await readSseStream(response, (event) => {
    const payload = event.data.join("\n")
    const data = getObject(parseJson(payload))
    const type = getString(data?.type)
    const delta =
      getString(data?.delta) ??
      getString(getObject(data?.item)?.delta) ??
      getString(getObject(data?.response)?.delta)

    if (
      type === "response.output_text.delta" ||
      type === "output_text.delta" ||
      delta
    ) {
      appendDelta(assistant, delta ?? "", params.onTextDelta)
    }

    if (type === "response.output_item.added") {
      const item = getObject(data?.item)

      if (getString(item?.type) === "function_call") {
        const callId = getString(item?.call_id) ?? ""
        const itemId = getString(item?.id) ?? ""
        const name = getString(item?.name) ?? ""
        const block = ensureToolCall(
          assistant,
          itemId ? `${callId}|${itemId}` : callId,
          name
        )
        const argumentsValue = getString(item?.arguments) ?? ""

        if (argumentsValue) {
          block.partialJson = argumentsValue
          block.arguments = parseStreamingArguments(argumentsValue)
        }
      }
    }

    if (type === "response.function_call_arguments.delta") {
      const itemId = getString(data?.item_id) ?? ""
      const outputIndex = getNumber(data?.output_index)
      const deltaValue = getString(data?.delta) ?? ""
      const toolBlock = assistant.content.find(
        (part): part is ToolCall & { partialJson?: string } =>
          part.type === "toolCall" &&
          (itemId
            ? part.id.endsWith(`|${itemId}`)
            : outputIndex !== undefined)
      )

      if (toolBlock) {
        toolBlock.partialJson = `${toolBlock.partialJson ?? ""}${deltaValue}`
        toolBlock.arguments = parseStreamingArguments(toolBlock.partialJson)
      }
    }

    if (type === "response.output_item.done") {
      const item = getObject(data?.item)

      if (getString(item?.type) === "function_call") {
        const callId = getString(item?.call_id) ?? ""
        const itemId = getString(item?.id) ?? ""
        const name = getString(item?.name) ?? ""
        const argumentsValue = getString(item?.arguments) ?? "{}"
        const block = ensureToolCall(
          assistant,
          itemId ? `${callId}|${itemId}` : callId,
          name
        )

        block.partialJson = argumentsValue
        block.arguments = parseStreamingArguments(argumentsValue)
      }
    }

    const usage =
      getObject(data?.usage) ??
      getObject(getObject(data?.response)?.usage)

    if (usage) {
      applyUsage(assistant, model, {
        cacheRead: getNumber(usage.input_cached_tokens) ?? 0,
        cacheWrite: 0,
        input: getNumber(usage.input_tokens) ?? 0,
        output: getNumber(usage.output_tokens) ?? 0,
        totalTokens:
          (getNumber(usage.input_tokens) ?? 0) +
          (getNumber(usage.output_tokens) ?? 0),
      })
    }

    if (
      type === "response.completed" ||
      type === "response.done" ||
      type === "response.incomplete"
    ) {
      setStopReason(assistant, "stop")
    }
  })

  if (
    assistant.content.some((part) => part.type === "toolCall") &&
    assistant.stopReason === "stop"
  ) {
    assistant.stopReason = "toolUse"
  }

  finalizeToolCalls(assistant)

  return { assistantMessage: assistant }
}

async function sendAnthropicMessages(
  params: StreamChatParams,
  model: ModelDefinition,
  apiKey: string,
  proxyUrl?: string
): Promise<StreamChatResult> {
  const assistant = createAssistantDraft(
    model,
    params.assistantId,
    params.assistantTimestamp
  )
  const response = await proxyAwareFetch({
    proxyUrl,
    requestInit: {
      body: JSON.stringify({
        max_tokens: model.maxTokens,
        messages: toAnthropicMessages(params.messages),
        model: model.id,
        stream: true,
        system: SYSTEM_PROMPT,
        tools:
          params.tools.length > 0
            ? params.tools.map((tool) => ({
                description: tool.description,
                input_schema: serializeToolParameters(tool.parameters),
                name: tool.name,
              }))
            : undefined,
      }),
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(model.provider === "github-copilot"
          ? { Authorization: `Bearer ${apiKey}` }
          : { "x-api-key": apiKey }),
        ...model.headers,
      },
      method: "POST",
      signal: params.signal,
    },
    targetUrl: `${model.baseUrl}/v1/messages`,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  await readSseStream(response, (event) => {
    const payload = event.data.join("\n")
    const data = getObject(parseJson(payload))
    const delta = getObject(data?.delta)
    const usage = getObject(data?.usage)
    const contentBlock = getObject(data?.content_block)

    if (event.event === "content_block_start" && contentBlock) {
      if (getString(contentBlock.type) === "tool_use") {
        const id = getString(contentBlock.id) ?? ""
        const name = getString(contentBlock.name) ?? ""
        const block = ensureToolCall(assistant, id, name)
        block.arguments = getObject(contentBlock.input) ?? {}
        block.partialJson = JSON.stringify(block.arguments)
      }
    }

    appendDelta(assistant, getString(delta?.text) ?? "", params.onTextDelta)

    if (getString(delta?.type) === "input_json_delta") {
      const index = getNumber(data?.index)
      const partialJson = getString(delta?.partial_json) ?? ""
      const toolBlocks = assistant.content.filter(
        (part): part is ToolCall & { partialJson?: string } =>
          part.type === "toolCall"
      )
      const block =
        index !== undefined ? toolBlocks[index] : toolBlocks[toolBlocks.length - 1]

      if (block) {
        block.partialJson = `${block.partialJson ?? ""}${partialJson}`
        block.arguments = parseStreamingArguments(block.partialJson)
      }
    }

    if (usage) {
      applyUsage(assistant, model, {
        cacheRead: getNumber(usage.cache_read_input_tokens) ?? 0,
        cacheWrite: getNumber(usage.cache_creation_input_tokens) ?? 0,
        input: getNumber(usage.input_tokens) ?? 0,
        output: getNumber(usage.output_tokens) ?? 0,
        totalTokens:
          (getNumber(usage.input_tokens) ?? 0) +
          (getNumber(usage.output_tokens) ?? 0),
      })
    }

    if (getString(data?.stop_reason) === "max_tokens") {
      setStopReason(assistant, "length")
    }

    if (getString(data?.stop_reason) === "tool_use") {
      setStopReason(assistant, "toolUse")
    }

    if (event.event === "message_stop") {
      setStopReason(assistant, "stop")
    }
  })

  if (
    assistant.content.some((part) => part.type === "toolCall") &&
    assistant.stopReason === "stop"
  ) {
    assistant.stopReason = "toolUse"
  }

  finalizeToolCalls(assistant)

  return { assistantMessage: assistant }
}

function getGoogleText(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => getGoogleText(item)).join("")
  }

  if (isObject(value)) {
    if (typeof value.text === "string") {
      return value.text
    }

    if (typeof value.thought === "string") {
      return value.thought
    }

    return Object.values(value)
      .map((item) => getGoogleText(item))
      .join("")
  }

  return ""
}

async function sendGoogleGeminiCli(
  params: StreamChatParams,
  model: ModelDefinition,
  apiKey: string,
  proxyUrl?: string
): Promise<StreamChatResult> {
  const assistant = createAssistantDraft(
    model,
    params.assistantId,
    params.assistantTimestamp
  )
  const credentials = getObject(parseJson(apiKey))
  const accessToken = getString(credentials?.token)
  const projectId = getString(credentials?.projectId)

  if (!accessToken || !projectId) {
    throw new Error("Google Cloud Code Assist requires OAuth authentication")
  }

  let seenText = ""
  const response = await proxyAwareFetch({
    proxyUrl,
    requestInit: {
      body: JSON.stringify({
        model: model.id,
        project: projectId,
        request: {
          contents: toGoogleContents(params.messages),
          generationConfig: {
            maxOutputTokens: model.maxTokens,
          },
          sessionId: params.sessionId,
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          tools:
            params.tools.length > 0
              ? params.tools.map((tool) => ({
                  functionDeclarations: [
                    {
                      description: tool.description,
                      name: tool.name,
                      parameters: serializeToolParameters(tool.parameters),
                    },
                  ],
                }))
              : undefined,
        },
        requestId: `${params.sessionId}-${Date.now()}`,
        userAgent: "pi-coding-agent",
      }),
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
        "X-Goog-Api-Client": "gl-node/22.17.0",
      },
      method: "POST",
      signal: params.signal,
    },
    targetUrl: `${model.baseUrl}/v1internal:streamGenerateContent?alt=sse`,
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  await readSseStream(response, (event) => {
    const payload = event.data.join("\n")
    const data = getObject(parseJson(payload))
    const responsePayload = getObject(data?.response)
    const text = getGoogleText(responsePayload)

    if (text.startsWith(seenText)) {
      const delta = text.slice(seenText.length)
      appendDelta(assistant, delta, params.onTextDelta)
      seenText = text
    }

    const functionCalls = extractGoogleFunctionCalls(responsePayload)

    for (const functionCall of functionCalls) {
      const exists = assistant.content.some(
        (part) => part.type === "toolCall" && part.id === functionCall.id
      )

      if (!exists) {
        assistant.content.push(functionCall)
      }
    }

    const usage = getObject(responsePayload?.usageMetadata)

    if (usage) {
      applyUsage(assistant, model, {
        cacheRead: getNumber(usage.cachedContentTokenCount) ?? 0,
        cacheWrite: 0,
        input: getNumber(usage.promptTokenCount) ?? 0,
        output: getNumber(usage.candidatesTokenCount) ?? 0,
        totalTokens: getNumber(usage.totalTokenCount) ?? 0,
      })
    }
  })

  if (
    assistant.content.some((part) => part.type === "toolCall") &&
    assistant.stopReason === "stop"
  ) {
    assistant.stopReason = "toolUse"
  }

  finalizeToolCalls(assistant)

  return { assistantMessage: assistant }
}

export async function streamChat(
  params: StreamChatParams
): Promise<StreamChatResult> {
  const model = getModel(params.provider, params.model)
  const auth =
    params.apiKey === undefined
      ? await resolveProviderAuthForProvider(params.provider)
      : {
          apiKey: params.apiKey,
          isOAuth: false,
          provider: params.provider,
          storedValue: params.apiKey,
        }

  if (!auth) {
    throw new Error(`No credentials stored for ${params.provider}`)
  }

  const proxy = await getProxyConfig()
  const proxyUrl =
    proxy.enabled && shouldProxyProviderRequest(params.provider, auth.storedValue)
      ? proxy.url
      : undefined

  switch (model.api) {
    case "anthropic-messages":
      return await sendAnthropicMessages(params, model, auth.apiKey, proxyUrl)
    case "google-gemini-cli":
      return await sendGoogleGeminiCli(params, model, auth.apiKey, proxyUrl)
    case "openai-codex-responses":
      return await sendOpenAICodexResponses(params, model, auth.apiKey, proxyUrl)
    case "openai-completions":
      return await sendOpenAICompletions(params, model, auth.apiKey, proxyUrl)
    default:
      throw new Error(`Unsupported model API: ${model.api}`)
  }
}

function toSuccessStopReason(
  reason: StopReason
): Extract<StopReason, "length" | "stop" | "toolUse"> {
  if (reason === "length") {
    return "length"
  }

  return reason === "toolUse" ? "toolUse" : "stop"
}

function createStreamingAssistant(
  model: ModelDefinition,
  id: string,
  timestamp: number
): AssistantMessage {
  return createAssistantDraft(model, id, timestamp)
}

function createStreamErrorMessage(
  model: ModelDefinition,
  id: string,
  timestamp: number,
  error: unknown,
  partial: AssistantMessage,
  aborted: boolean
): AssistantMessage {
  return {
    ...partial,
    api: model.api,
    errorMessage: error instanceof Error ? error.message : "Request failed",
    id,
    model: model.id,
    provider: model.provider,
    stopReason: aborted ? "aborted" : "error",
    timestamp,
  }
}

function normalizeThinkingLevel(
  thinkingLevel: SimpleStreamOptions["reasoning"] | "off" | undefined
): StreamChatParams["thinkingLevel"] {
  return thinkingLevel === "off" || thinkingLevel === undefined
    ? "medium"
    : thinkingLevel
}

export const streamChatWithPiAgent: StreamFn = (
  model,
  context,
  options
) => {
  const stream = createAssistantMessageEventStream()
  const modelDefinition = getModel(
    model.provider as StreamChatParams["provider"],
    model.id
  )
  const assistantId = createId()
  const timestamp = Date.now()
  const partial = createStreamingAssistant(modelDefinition, assistantId, timestamp)

  void (async () => {
    let hasTextContent = false

    try {
      stream.push({
        partial,
        type: "start",
      })

      const result = await streamChat({
        apiKey: options?.apiKey,
        assistantId,
        assistantTimestamp: timestamp,
        messages: context.messages,
        model: model.id,
        onTextDelta(delta) {
          let content = partial.content[partial.content.length - 1]

          if (!content || content.type !== "text") {
            content = { text: "", type: "text" }
            partial.content.push(content)
          }

          if (!hasTextContent) {
            stream.push({
              contentIndex: partial.content.length - 1,
              partial,
              type: "text_start",
            })
            hasTextContent = true
          }

          content.text += delta
          stream.push({
            contentIndex: partial.content.length - 1,
            delta,
            partial,
            type: "text_delta",
          })
        },
        provider: model.provider as StreamChatParams["provider"],
        sessionId: options?.sessionId ?? "session",
        signal: options?.signal ?? new AbortController().signal,
        thinkingLevel: normalizeThinkingLevel(options?.reasoning),
        tools: (context.tools ?? []).map((tool) => ({
          description: tool.description,
          name: tool.name,
          parameters: tool.parameters,
        })),
      })

      if (hasTextContent) {
        const content = partial.content[0]

        if (content?.type === "text") {
          stream.push({
            content: content.text,
            contentIndex: 0,
            partial,
            type: "text_end",
          })
        }
      }

      const existingToolCallIds = new Set(
        partial.content
          .filter((part): part is ToolCall => part.type === "toolCall")
          .map((part) => part.id)
      )

      if (
        partial.content.length === 1 &&
        partial.content[0]?.type === "text" &&
        partial.content[0].text.length === 0
      ) {
        partial.content = []
      }

      for (const part of result.assistantMessage.content) {
        if (part.type !== "toolCall" || existingToolCallIds.has(part.id)) {
          continue
        }

        partial.content.push(part)
        const contentIndex = partial.content.length - 1
        const delta = JSON.stringify(part.arguments)

        stream.push({
          contentIndex,
          partial,
          type: "toolcall_start",
        })
        stream.push({
          contentIndex,
          delta,
          partial,
          type: "toolcall_delta",
        })
        stream.push({
          contentIndex,
          partial,
          toolCall: part,
          type: "toolcall_end",
        })
      }

      stream.push({
        message: result.assistantMessage,
        reason: toSuccessStopReason(result.assistantMessage.stopReason),
        type: "done",
      })
      stream.end(result.assistantMessage)
    } catch (error) {
      const errorReason: Extract<StopReason, "aborted" | "error"> =
        options?.signal?.aborted ? "aborted" : "error"
      const failedMessage = createStreamErrorMessage(
        modelDefinition,
        assistantId,
        timestamp,
        error,
        partial,
        errorReason === "aborted"
      )

      stream.push({
        error: failedMessage,
        reason: errorReason,
        type: "error",
      })
      stream.end(failedMessage)
    }
  })()

  return stream
}
