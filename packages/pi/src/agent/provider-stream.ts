import * as PiAi from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, ToolCall } from "@webaura/pi/types/chat";
import type { ModelDefinition, ProviderId } from "@webaura/pi/types/models";
import { SYSTEM_PROMPT } from "@webaura/pi/agent/system-prompt";
import { createProxyAwareStreamFn } from "@webaura/pi/agent/provider-proxy";
import { isUserAbortError, USER_ABORT_NOTICE_MESSAGE } from "@webaura/pi/agent/runtime-errors";
import { createId } from "@webaura/pi/lib/ids";
import { getModel } from "@webaura/pi/models/catalog";
import { createEmptyUsage } from "@webaura/pi/types/models";

function createAssistantDraft(
  model: ModelDefinition,
  id: string,
  timestamp: number,
): AssistantMessage {
  return {
    api: model.api,
    content: [],
    id,
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: createEmptyUsage(),
  };
}

function cloneToolCallArguments(argumentsValue: ToolCall["arguments"]): ToolCall["arguments"] {
  return Object.fromEntries(Object.entries(argumentsValue));
}

function cloneContentBlock(
  block: PiAi.AssistantMessage["content"][number],
): AssistantMessage["content"][number] {
  switch (block.type) {
    case "text":
      return { ...block };
    case "thinking":
      return { ...block };
    case "toolCall":
      return {
        ...block,
        arguments: cloneToolCallArguments(block.arguments),
      };
  }
}

function cloneUsage(usage: PiAi.AssistantMessage["usage"]): AssistantMessage["usage"] {
  return {
    ...usage,
    cost: {
      ...usage.cost,
    },
  };
}

function syncAssistantMessage(
  target: AssistantMessage,
  source: PiAi.AssistantMessage,
  id: string,
  _fallbackTimestamp: number,
): AssistantMessage {
  target.api = source.api;
  target.content = source.content.map(cloneContentBlock);
  target.errorMessage = source.errorMessage;
  target.id = id;
  target.model = source.model;
  target.provider = source.provider;
  target.responseId = source.responseId;
  target.role = "assistant";
  target.stopReason = source.stopReason;
  target.timestamp = source.timestamp;
  target.usage = cloneUsage(source.usage);

  if (target.errorMessage === undefined) {
    delete target.errorMessage;
  }

  if (target.responseId === undefined) {
    delete target.responseId;
  }

  return target;
}

function extractErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Request failed";
  }

  const parts: Array<string> = [error.message];
  let current: unknown = (error as Error & { cause?: unknown }).cause;

  while (current instanceof Error) {
    if (current.message && !parts.includes(current.message)) {
      parts.push(current.message);
    }
    current = (current as Error & { cause?: unknown }).cause;
  }

  return parts.join(" — ");
}

function formatConnectionDiagnostic(model: ModelDefinition, detail: string): string {
  const target = model.baseUrl;
  return `${detail} [${model.provider}/${model.id} → ${target}]`;
}

function attachProviderDiagnostic(model: ModelDefinition, detail: string): string {
  if (detail.includes(model.baseUrl) || detail.includes(`${model.provider}/${model.id}`)) {
    return detail;
  }

  return formatConnectionDiagnostic(model, detail);
}

function createStreamErrorMessage(
  model: ModelDefinition,
  id: string,
  timestamp: number,
  error: unknown,
  aborted: boolean,
): AssistantMessage {
  if (aborted) {
    return {
      ...createAssistantDraft(model, id, timestamp),
      errorMessage: USER_ABORT_NOTICE_MESSAGE,
      stopReason: "aborted",
    };
  }

  const raw = extractErrorDetail(error);
  const errorMessage = attachProviderDiagnostic(model, raw);

  return {
    ...createAssistantDraft(model, id, timestamp),
    errorMessage,
    stopReason: "error",
  };
}

function toSuccessStopReason(
  reason: StopReason,
): Extract<StopReason, "length" | "stop" | "toolUse"> {
  if (reason === "length") {
    return "length";
  }

  return reason === "toolUse" ? "toolUse" : "stop";
}

function isEmptyAssistantPlaceholder(message: PiAi.Message): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  return (
    message.content.length === 0 ||
    message.content.every((part) => {
      if (part.type === "text") {
        return part.text.length === 0;
      }

      if (part.type === "thinking") {
        return part.thinking.length === 0;
      }

      return false;
    })
  );
}

function normalizeContext(context: PiAi.Context): PiAi.Context {
  const trailingMessage = context.messages.at(-1);
  const messages =
    trailingMessage && isEmptyAssistantPlaceholder(trailingMessage)
      ? context.messages.slice(0, -1)
      : context.messages;

  return {
    ...context,
    messages,
    systemPrompt: context.systemPrompt ?? SYSTEM_PROMPT,
  };
}

const proxyAwareStreamSimple = createProxyAwareStreamFn();
type ProxyAwareStream = Awaited<ReturnType<ReturnType<typeof createProxyAwareStreamFn>>>;

function wrapAssistantMessageEventStream(
  model: ModelDefinition,
  upstream: ProxyAwareStream,
  assistantId: string,
  timestamp: number,
  abortSignal?: AbortSignal,
) {
  const stream = PiAi.createAssistantMessageEventStream();
  const partials = new WeakMap<object, AssistantMessage>();

  const decorateAssistant = (message: PiAi.AssistantMessage): AssistantMessage => {
    const key: object = message;
    const existing = partials.get(key);

    if (existing) {
      return syncAssistantMessage(existing, message, assistantId, timestamp);
    }

    const created = syncAssistantMessage(
      createAssistantDraft(model, assistantId, timestamp),
      message,
      assistantId,
      timestamp,
    );
    partials.set(key, created);
    return created;
  };

  const pushEvent = (event: PiAi.AssistantMessageEvent): boolean => {
    switch (event.type) {
      case "start":
        stream.push({
          ...event,
          partial: decorateAssistant(event.partial),
        });
        return false;
      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
        stream.push({
          ...event,
          partial: decorateAssistant(event.partial),
        });
        return false;
      case "toolcall_end":
        stream.push({
          ...event,
          partial: decorateAssistant(event.partial),
          toolCall: {
            ...event.toolCall,
            arguments: cloneToolCallArguments(event.toolCall.arguments),
          },
        });
        return false;
      case "done": {
        const message = decorateAssistant(event.message);
        stream.push({
          ...event,
          message,
          reason: toSuccessStopReason(message.stopReason),
        });
        stream.end(message);
        return true;
      }
      case "error": {
        const error = decorateAssistant(event.error);
        if (error.errorMessage) {
          error.errorMessage = attachProviderDiagnostic(model, error.errorMessage);
        }
        console.error(
          `[provider-stream] Error from ${model.provider}/${model.id} (${model.baseUrl}):`,
          error.errorMessage,
        );
        stream.push({
          ...event,
          error,
          reason: error.stopReason === "aborted" ? "aborted" : "error",
        });
        stream.end(error);
        return true;
      }
    }
  };

  void (async () => {
    try {
      for await (const event of upstream) {
        if (pushEvent(event)) {
          return;
        }
      }

      const message = decorateAssistant(await upstream.result());
      stream.push({
        message,
        reason: toSuccessStopReason(message.stopReason),
        type: "done",
      });
      stream.end(message);
    } catch (error) {
      console.error(
        `[provider-stream] Stream threw for ${model.provider}/${model.id} (${model.baseUrl}):`,
        error,
      );
      const aborted = abortSignal?.aborted === true || isUserAbortError(error);
      const failure = createStreamErrorMessage(model, assistantId, timestamp, error, aborted);
      stream.push({
        error: failure,
        reason: aborted ? "aborted" : "error",
        type: "error",
      });
      stream.end(failure);
    }
  })();

  return stream;
}

async function createAppStream(
  model: ModelDefinition,
  context: PiAi.Context,
  options?: PiAi.SimpleStreamOptions,
  assistantId = createId(),
  timestamp = Date.now(),
) {
  const upstream = await proxyAwareStreamSimple(model, normalizeContext(context), {
    ...options,
    maxTokens: options?.maxTokens ?? model.maxTokens,
  });
  return wrapAssistantMessageEventStream(model, upstream, assistantId, timestamp, options?.signal);
}

export const streamChatWithPiAgent: StreamFn = async (model, context, options) => {
  const modelDefinition = getModel(model.provider as ProviderId, model.id);

  try {
    return await createAppStream(modelDefinition, context, options);
  } catch (error) {
    console.error(
      `[provider-stream] createAppStream failed for ${modelDefinition.provider}/${modelDefinition.id} (${modelDefinition.baseUrl}):`,
      error,
    );
    const stream = PiAi.createAssistantMessageEventStream();
    const failure = createStreamErrorMessage(
      modelDefinition,
      createId(),
      Date.now(),
      error,
      options?.signal?.aborted === true || isUserAbortError(error),
    );

    queueMicrotask(() => {
      stream.push({
        error: failure,
        reason: failure.stopReason === "aborted" ? "aborted" : "error",
        type: "error",
      });
      stream.end(failure);
    });

    return stream;
  }
};
