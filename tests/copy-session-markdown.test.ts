import { describe, expect, it } from "vite-plus/test";
import { messagesToMarkdown } from "@/lib/copy-session-markdown";
import type { ChatMessage } from "@/types/chat";
import { createEmptyUsage } from "@/types/models";

function buildMessages(): ChatMessage[] {
  return [
    {
      content: "Help me plan this",
      id: "user-1",
      role: "user",
      timestamp: 0,
    },
    {
      api: "openai-responses",
      content: [{ text: "Here is a concise plan.", type: "text" }],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      provider: "openai",
      role: "assistant",
      stopReason: "stop",
      timestamp: 1,
      usage: createEmptyUsage(),
    },
  ];
}

function buildMessagesWithTools(): ChatMessage[] {
  return [
    {
      content: "How does copy work?",
      id: "user-1",
      role: "user",
      timestamp: 0,
    },
    {
      api: "openai-responses",
      content: [
        { text: "I inspected the export path.", type: "text" },
        {
          arguments: { query: "status" },
          id: "call-tool",
          name: "example_tool",
          type: "toolCall",
        },
        {
          arguments: { query: "missing" },
          id: "call-tool-error",
          name: "example_tool",
          type: "toolCall",
        },
      ],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      provider: "openai",
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 1,
      usage: createEmptyUsage(),
    },
    {
      content: [{ text: "tool output that should not be copied", type: "text" }],
      id: "tool-result-1",
      isError: false,
      parentAssistantId: "assistant-1",
      role: "toolResult",
      timestamp: 2,
      toolCallId: "call-tool",
      toolName: "example_tool",
    },
    {
      content: [{ text: "command failed loudly", type: "text" }],
      id: "tool-result-2",
      isError: true,
      parentAssistantId: "assistant-1",
      role: "toolResult",
      timestamp: 3,
      toolCallId: "call-tool-error",
      toolName: "example_tool",
    },
  ];
}

describe("messagesToMarkdown", () => {
  it("exports plain chats", () => {
    const markdown = messagesToMarkdown(buildMessages());

    expect(markdown).toContain("# Chat");
    expect(markdown).toContain("## User");
    expect(markdown).toContain("## Assistant");
    expect(markdown).not.toContain("- Repository:");
  });

  it("includes failed tool error messages without copying successful tool output", () => {
    const markdown = messagesToMarkdown(buildMessagesWithTools());

    expect(markdown).toContain("## Assistant\n\nI inspected the export path.");
    expect(markdown).toContain("### Tools");
    expect(markdown).toContain("1. example_tool — Completed");
    expect(markdown).toContain('   args: {"query":"status"}');
    expect(markdown).toContain("2. example_tool — Error");
    expect(markdown).toContain('   args: {"query":"missing"}');
    expect(markdown).toContain("   error: command failed loudly");
    expect(markdown).not.toContain("tool output that should not be copied");
  });
});
