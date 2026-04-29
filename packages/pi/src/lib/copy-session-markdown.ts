import {
  deriveAssistantView,
  getAssistantText,
  getToolResultText,
  getUserAttachments,
  getUserText,
} from "@webaura/pi/lib/chat-adapter";
import type { DisplayChatMessage, ToolCall, ToolResultMessage } from "@webaura/pi/types/chat";

function formatExportedAt(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildContextHeader(): string[] {
  return ["# Chat", `- Exported: ${formatExportedAt(new Date())}`];
}

function getToolStatusLabel(toolResult?: ToolResultMessage): string {
  if (!toolResult) {
    return "Running";
  }

  return toolResult.isError ? "Error" : "Completed";
}

function getToolErrorSummary(toolResult?: ToolResultMessage): string | undefined {
  if (!toolResult?.isError) {
    return undefined;
  }

  const text = getToolResultText(toolResult)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");

  return text || undefined;
}

function formatToolArguments(toolCall: ToolCall, toolResult?: ToolResultMessage): string[] {
  const lines = [`   args: ${JSON.stringify(toolCall.arguments)}`];
  const errorSummary = getToolErrorSummary(toolResult);

  if (errorSummary) {
    lines.push(`   error: ${errorSummary}`);
  }

  return lines;
}

function formatUserMessage(message: Extract<DisplayChatMessage, { role: "user" }>): string {
  const text = getUserText(message).trim();
  const lines = text ? [text] : [];
  const attachments = getUserAttachments(message);

  if (attachments.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(
      "Attachments:",
      ...attachments.map((file) => `- ${file.fileName} (${file.mediaType})`),
    );
  }

  return lines.join("\n");
}

function formatToolExecutions(
  toolExecutions: ReturnType<typeof deriveAssistantView>["toolExecutions"],
): string[] {
  if (toolExecutions.length === 0) {
    return [];
  }

  return toolExecutions.flatMap(({ toolCall, toolResult }, index) => [
    `${index + 1}. ${toolCall.name} — ${getToolStatusLabel(toolResult)}`,
    ...formatToolArguments(toolCall, toolResult),
  ]);
}

export function messagesToMarkdown(messages: readonly DisplayChatMessage[]): string {
  const parts: string[] = [buildContextHeader().join("\n")];

  for (const [index, message] of messages.entries()) {
    switch (message.role) {
      case "user":
        parts.push(`## User\n\n${formatUserMessage(message)}`);
        break;
      case "assistant": {
        const text = getAssistantText(message);
        const view = deriveAssistantView(message, messages.slice(index + 1));
        const toolLines = formatToolExecutions(view.toolExecutions);
        const section: string[] = ["## Assistant"];

        if (text.trim()) {
          section.push("", text);
        }

        if (toolLines.length > 0) {
          section.push("", "### Tools", "", ...toolLines);
        }

        if (section.length > 1) {
          parts.push(section.join("\n"));
        }
        break;
      }
      case "system":
        parts.push(`> **System:** ${message.message}`);
        break;
      case "toolResult":
        break;
    }
  }

  return parts.join("\n\n---\n\n") + "\n";
}

export async function copySessionToClipboard(
  messages: readonly DisplayChatMessage[],
): Promise<void> {
  const markdown = messagesToMarkdown(messages);
  await navigator.clipboard.writeText(markdown);
}
