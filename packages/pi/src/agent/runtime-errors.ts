import type { SystemMessage } from "@webaura/pi/types/chat";
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
  StreamInterruptedRuntimeError,
} from "@webaura/pi/agent/runtime-command-errors";

export type RuntimeErrorKind =
  | "missing_session"
  | "provider_api"
  | "runtime_busy"
  | "provider_rate_limit"
  | "provider_connection"
  | "stream_interrupted"
  | "unknown";

export interface ClassifiedRuntimeError {
  kind: RuntimeErrorKind;
  fingerprint: string;
  message: string;
  severity: SystemMessage["severity"];
  source: SystemMessage["source"];
  detailsContext?: string;
  detailsHtml?: string;
}

const PROVIDER_MARKERS = [
  "anthropic",
  "openai",
  "openai-codex",
  "fireworks",
  "api.fireworks.ai",
  "gemini",
  "google",
  "groq",
  "mistral",
  "x.ai",
  "proxy",
] as const;

function isProviderRateLimitMessage(lower: string): boolean {
  return (
    lower.includes("too many requests") ||
    lower.includes(" 429") ||
    lower.startsWith("429") ||
    lower.includes("rate limit")
  );
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/** Shown when the user stops streaming or a provider hits an abort signal. */
export const USER_ABORT_NOTICE_MESSAGE = "User aborted!";

function isUserAbortPlainText(text: string): boolean {
  const m = text.toLowerCase().trim();
  return (
    m.includes("request was aborted") ||
    m.includes("command aborted") ||
    m === "the operation was aborted" ||
    m.includes("bodystreambuffer was aborted")
  );
}

/** User-initiated cancellation (stop button, AbortSignal), not a provider bug. */
export function isUserAbortError(error: unknown): boolean {
  if (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError")
  ) {
    return true;
  }

  const raw = normalizeMessage(error);
  return isUserAbortPlainText(raw);
}

interface HtmlErrorDetail {
  context?: string;
  html: string;
  summary: string;
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) {
    return undefined;
  }

  const titleMatch = match[1];

  if (!titleMatch) {
    return undefined;
  }

  const normalized = titleMatch
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || undefined;
}

function extractHtmlErrorDetail(message: string): HtmlErrorDetail | undefined {
  const match = message.match(/(<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i);

  if (!match || match.index === undefined) {
    return undefined;
  }

  const htmlMatch = match[1];

  if (!htmlMatch) {
    return undefined;
  }

  const html = htmlMatch.trim();
  const prefix = message.slice(0, match.index).replace(/\s+/g, " ").trim();
  const suffix = message
    .slice(match.index + htmlMatch.length)
    .replace(/\s+/g, " ")
    .trim();
  const title = extractHtmlTitle(html);
  const summaryPrefix = prefix || "HTML response";
  const summary = title ? `${summaryPrefix} — ${title}` : `${summaryPrefix} — HTML response`;

  return {
    context: suffix || undefined,
    html,
    summary,
  };
}

function isProviderMessage(lower: string, message: string): boolean {
  if (message.includes(" → https://") || message.includes(" → http://")) {
    return true;
  }

  return PROVIDER_MARKERS.some((marker) => lower.includes(marker));
}

function fingerprintFor(kind: RuntimeErrorKind, message: string): string {
  return `${kind}:${message.slice(0, 160)}`;
}

export function classifyRuntimeError(error: unknown): ClassifiedRuntimeError {
  const rawMessage = normalizeMessage(error);
  const htmlDetail = extractHtmlErrorDetail(rawMessage);
  const message = htmlDetail?.summary ?? rawMessage;
  const lower = message.toLowerCase();
  const rawLower = rawMessage.toLowerCase();

  if (error instanceof StreamInterruptedRuntimeError) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("stream_interrupted", message),
      kind: "stream_interrupted",
      message,
      severity: "error",
      source: "runtime",
    };
  }

  if (error instanceof BusyRuntimeError) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("runtime_busy", message),
      kind: "runtime_busy",
      message,
      severity: "warning",
      source: "runtime",
    };
  }

  if (error instanceof MissingSessionRuntimeError) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("missing_session", message),
      kind: "missing_session",
      message,
      severity: "error",
      source: "runtime",
    };
  }

  if (isUserAbortError(error)) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("stream_interrupted", USER_ABORT_NOTICE_MESSAGE),
      kind: "stream_interrupted",
      message: USER_ABORT_NOTICE_MESSAGE,
      severity: "info",
      source: "runtime",
    };
  }

  if (
    rawLower.includes("connection error") ||
    rawLower.includes("failed to fetch") ||
    rawLower.includes("networkerror") ||
    rawLower.includes("load failed") ||
    rawLower.includes("the network connection was lost")
  ) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("provider_connection", message),
      kind: "provider_connection",
      message,
      severity: "error",
      source: "provider",
    };
  }

  if (isProviderRateLimitMessage(rawLower)) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("provider_rate_limit", message),
      kind: "provider_rate_limit",
      message,
      severity: "error",
      source: "provider",
    };
  }

  if (isProviderMessage(rawLower || lower, rawMessage)) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("provider_api", message),
      kind: "provider_api",
      message,
      severity: "error",
      source: "provider",
    };
  }

  return {
    detailsContext: htmlDetail?.context,
    detailsHtml: htmlDetail?.html,
    fingerprint: fingerprintFor("unknown", message),
    kind: "unknown",
    message,
    severity: "error",
    source: "runtime",
  };
}

export function buildSystemMessage(
  classified: ClassifiedRuntimeError,
  id: string,
  timestamp: number,
): SystemMessage {
  return {
    detailsContext: classified.detailsContext,
    detailsHtml: classified.detailsHtml,
    fingerprint: classified.fingerprint,
    id,
    kind: classified.kind,
    message: classified.message,
    role: "system",
    severity: classified.severity,
    source: classified.source,
    timestamp,
  };
}

type SnapshotWithError = {
  error: string | undefined;
};

export function withTerminalError<T extends SnapshotWithError>(
  snapshot: T,
  terminalErrorMessage?: string,
): T {
  if (terminalErrorMessage === undefined || snapshot.error !== undefined) {
    return snapshot;
  }

  return {
    ...snapshot,
    error: terminalErrorMessage,
  };
}
