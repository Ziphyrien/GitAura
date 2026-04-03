import { describe, expect, it, vi } from "vitest";
import { messagesToMarkdown } from "@/lib/copy-session-markdown";
import type { ChatMessage } from "@/types/chat";
import { createEmptyUsage } from "@/types/models";

function buildMessages(): ChatMessage[] {
  return [
    {
      content: "How does this repo work?",
      id: "user-1",
      role: "user",
      timestamp: 0,
    },
    {
      api: "openai-responses",
      content: [{ text: "It uses a repo-scoped runtime.", type: "text" }],
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

describe("messagesToMarkdown", () => {
  it("prepends repo metadata and the original source URL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T14:31:00.000Z"));

    const markdown = messagesToMarkdown(buildMessages(), {
      repoSource: {
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/feature/foo",
          fullRef: "refs/heads/feature/foo",
          kind: "branch",
          name: "feature/foo",
        },
      },
      sourceUrl: "https://github.com/acme/demo/blob/feature/foo/README.md",
    });

    expect(markdown).toContain("# Chat about acme/demo");
    expect(markdown).toContain("- Repository: `acme/demo`");
    expect(markdown).toContain("- Ref: `feature/foo`");
    expect(markdown).toContain("- Source: https://github.com/acme/demo/blob/feature/foo/README.md");
    expect(markdown).toContain("## User");
    expect(markdown).toContain("## Assistant");

    vi.useRealTimers();
  });

  it("falls back to a canonical GitHub URL when no source URL is stored", () => {
    const markdown = messagesToMarkdown(buildMessages(), {
      repoSource: {
        owner: "acme",
        ref: "0123456789abcdef0123456789abcdef01234567",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          kind: "commit",
          sha: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    });

    expect(markdown).toContain(
      "- Source: https://github.com/acme/demo/commit/0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("still exports plain chats without repo context", () => {
    const markdown = messagesToMarkdown(buildMessages());

    expect(markdown).toContain("# Chat");
    expect(markdown).not.toContain("- Repository:");
  });
});
