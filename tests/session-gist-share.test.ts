import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SessionData } from "@/types/storage";
import type { ChatMessage } from "@/types/chat";
import { createEmptyUsage } from "@/types/models";

const getGithubPersonalAccessToken = vi.fn();

vi.mock("@/repo/github-token", () => ({
  getGithubPersonalAccessToken,
}));

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
      model: "gpt-5.4",
      provider: "openai",
      role: "assistant",
      stopReason: "stop",
      timestamp: 1,
      usage: createEmptyUsage(),
    },
  ];
}

function buildSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-04-26T14:00:00.000Z",
    id: "session-1",
    isStreaming: false,
    messageCount: 2,
    model: "gpt-5.4",
    preview: "How does this repo work?",
    provider: "openai",
    providerGroup: "openai",
    repoSource: {
      owner: "acme",
      ref: "main",
      refOrigin: "explicit",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/main",
        fullRef: "refs/heads/main",
        kind: "branch",
        name: "main",
      },
    },
    sourceUrl: "https://github.com/acme/demo/blob/main/README.md",
    thinkingLevel: "medium",
    title: "Repo runtime overview",
    updatedAt: "2026-04-26T14:05:00.000Z",
    usage: createEmptyUsage(),
  };
}

describe("createSessionGistShare", () => {
  beforeEach(() => {
    getGithubPersonalAccessToken.mockReset();
    vi.restoreAllMocks();
  });

  it("creates a secret gist with markdown and metadata files", async () => {
    getGithubPersonalAccessToken.mockResolvedValue("github_pat_test");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ html_url: "https://gist.github.com/example/123", id: "123" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 201,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createSessionGistShare } = await import("@/lib/session-gist-share");
    const result = await createSessionGistShare({
      messages: buildMessages(),
      session: buildSession(),
    });

    expect(result).toEqual({ id: "123", url: "https://gist.github.com/example/123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    expect(request).toBeTruthy();
    expect((request as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer github_pat_test",
    );

    const body = JSON.parse(String((request as { body: string }).body)) as {
      description: string;
      files: Record<string, { content: string }>;
      public: boolean;
    };

    expect(body.public).toBe(false);
    expect(body.description).toBe("WebAura chat about acme/demo@main");
    expect(Object.keys(body.files)).toEqual([
      "webaura-acme-demo-main.md",
      "webaura-acme-demo-main.metadata.json",
    ]);
    expect(body.files["webaura-acme-demo-main.md"]?.content).toContain("# Chat about acme/demo");
    expect(body.files["webaura-acme-demo-main.metadata.json"]?.content).toContain(
      '"format": "webaura-session-gist"',
    );
  });

  it("fails clearly when no PAT is stored", async () => {
    getGithubPersonalAccessToken.mockResolvedValue(undefined);

    const { SessionGistShareError, createSessionGistShare } =
      await import("@/lib/session-gist-share");

    await expect(
      createSessionGistShare({
        messages: buildMessages(),
        session: buildSession(),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<InstanceType<typeof SessionGistShareError>>>({
        code: "missing_token",
        message: "Add a GitHub Personal Access Token before sharing as a gist.",
      }),
    );
  });

  it("explains gist scope failures", async () => {
    getGithubPersonalAccessToken.mockResolvedValue("github_pat_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ message: "Resource not accessible by personal access token" }),
            {
              headers: { "Content-Type": "application/json" },
              status: 403,
            },
          ),
      ),
    );

    const { SessionGistShareError, createSessionGistShare } =
      await import("@/lib/session-gist-share");

    await expect(
      createSessionGistShare({
        messages: buildMessages(),
        session: buildSession(),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<InstanceType<typeof SessionGistShareError>>>({
        code: "insufficient_scope",
        status: 403,
      }),
    );
  });
});
