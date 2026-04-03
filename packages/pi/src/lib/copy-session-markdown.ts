import type { ResolvedRepoSource } from "@gitinspect/db/storage-types";
import {
  deriveAssistantView,
  getAssistantText,
  getUserText,
} from "@gitinspect/pi/lib/chat-adapter";
import { repoSourceToGitHubUrl } from "@gitinspect/pi/repo/url";
import type { ChatMessage, ToolCall, ToolResultMessage } from "@gitinspect/pi/types/chat";

type MarkdownExportOptions = {
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
};

function formatExportedAt(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildContextHeader(options: MarkdownExportOptions): string[] {
  if (!options.repoSource) {
    return ["# Chat", `- Exported: ${formatExportedAt(new Date())}`];
  }

  const sourceUrl = options.sourceUrl ?? repoSourceToGitHubUrl(options.repoSource);
  const lines = [`# Chat about ${options.repoSource.owner}/${options.repoSource.repo}`];

  lines.push(`- Repository: \`${options.repoSource.owner}/${options.repoSource.repo}\``);
  lines.push(`- Ref: \`${options.repoSource.ref}\``);
  lines.push(`- Source: ${sourceUrl}`);
  lines.push(`- Exported: ${formatExportedAt(new Date())}`);

  return lines;
}

function getToolStatusLabel(toolResult?: ToolResultMessage): string {
  if (!toolResult) {
    return "Running";
  }

  return toolResult.isError ? "Error" : "Completed";
}

function formatToolArguments(toolCall: ToolCall, toolResult?: ToolResultMessage): string[] {
  const args = toolCall.arguments;

  if (toolCall.name === "read") {
    const lines: string[] = [];

    if (typeof args.path === "string") {
      lines.push(`   path: ${args.path}`);
    }

    if (typeof args.offset === "number") {
      lines.push(`   offset: ${String(args.offset)}`);
    }

    if (typeof args.limit === "number") {
      lines.push(`   limit: ${String(args.limit)}`);
    }

    const details = toolResult?.details;
    if (
      details &&
      typeof details === "object" &&
      "resolvedPath" in details &&
      typeof details.resolvedPath === "string"
    ) {
      lines.push(`   resolved: ${details.resolvedPath}`);
    }

    return lines;
  }

  if (toolCall.name === "bash") {
    const lines: string[] = [];

    if (typeof args.command === "string") {
      lines.push(`   command: ${args.command}`);
    }

    const details = toolResult?.details;
    if (
      details &&
      typeof details === "object" &&
      "cwd" in details &&
      typeof details.cwd === "string"
    ) {
      lines.push(`   cwd: ${details.cwd}`);
    }

    return lines;
  }

  return [`   args: ${JSON.stringify(args)}`];
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

export function messagesToMarkdown(
  messages: readonly ChatMessage[],
  options: MarkdownExportOptions = {},
): string {
  const parts: string[] = [buildContextHeader(options).join("\n")];

  for (const [index, message] of messages.entries()) {
    switch (message.role) {
      case "user":
        parts.push(`## User\n\n${getUserText(message)}`);
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
  messages: readonly ChatMessage[],
  options: MarkdownExportOptions = {},
): Promise<void> {
  const markdown = messagesToMarkdown(messages, options);
  await navigator.clipboard.writeText(markdown);
}
