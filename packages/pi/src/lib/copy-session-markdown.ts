import type { ResolvedRepoSource } from "@gitinspect/db/storage-types";
import type { ChatMessage } from "@gitinspect/pi/types/chat";
import { getAssistantText, getUserText } from "@gitinspect/pi/lib/chat-adapter";
import { repoSourceToGitHubUrl } from "@gitinspect/pi/repo/url";

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

export function messagesToMarkdown(
  messages: readonly ChatMessage[],
  options: MarkdownExportOptions = {},
): string {
  const parts: string[] = [buildContextHeader(options).join("\n")];

  for (const message of messages) {
    switch (message.role) {
      case "user":
        parts.push(`## User\n\n${getUserText(message)}`);
        break;
      case "assistant": {
        const text = getAssistantText(message);
        if (text.trim()) {
          parts.push(`## Assistant\n\n${text}`);
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
