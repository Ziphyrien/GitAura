import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  env: {
    VITE_GITHUB_PROXY_ENABLED: false,
  },
}));

const toastErrorMock = vi.fn();
const appendSessionNoticeMock = vi.fn(async () => {});
const resolveRegisteredGitHubRequestAuthMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("@webaura/env/web", () => ({
  env: state.env,
}));

vi.mock("@/repo/github-access", () => ({
  resolveRegisteredGitHubRequestAuth: (access?: "public" | "repo") =>
    resolveRegisteredGitHubRequestAuthMock(access),
}));

vi.mock("@/sessions/session-notices", () => ({
  appendSessionNotice: appendSessionNoticeMock,
}));

function createJsonResponse(
  value: object,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    status,
  });
}

function createRateLimitResponse(): Response {
  return createJsonResponse({ message: "API rate limit exceeded" }, 403, {
    "x-ratelimit-limit": "60",
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": String(Math.floor((Date.now() + 60_000) / 1000)),
  });
}

describe("github-fetch", () => {
  beforeEach(() => {
    state.env.VITE_GITHUB_PROXY_ENABLED = false;
    toastErrorMock.mockReset();
    appendSessionNoticeMock.mockReset();
    resolveRegisteredGitHubRequestAuthMock.mockReset();
    resolveRegisteredGitHubRequestAuthMock.mockResolvedValue({ mode: "anon" as const });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("treats an omitted transport the same as auto", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");

    await githubApiFetch("/repos/acme/demo", { access: "public" });
    await githubApiFetch("/repos/acme/demo", { access: "public", transport: "auto" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/acme/demo",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/demo",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("uses direct authenticated requests for public auto access when auth is available", async () => {
    resolveRegisteredGitHubRequestAuthMock.mockResolvedValue({
      mode: "oauth" as const,
      scopes: ["repo"],
      token: "oauth-token",
    });
    state.env.VITE_GITHUB_PROXY_ENABLED = true;
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    await githubApiFetch("/repos/acme/demo", { access: "public" });

    expect(resolveRegisteredGitHubRequestAuthMock).toHaveBeenCalledWith("public");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/demo",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer oauth-token",
        }),
      }),
    );
  });

  it("uses the proxy for public auto access when auth is unavailable and the proxy is enabled", async () => {
    state.env.VITE_GITHUB_PROXY_ENABLED = true;
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    await githubApiFetch("/repos/acme/demo", { access: "public" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/github/repos/acme/demo",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("falls back to direct anonymous requests for public auto access when the proxy is disabled", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    await githubApiFetch("/repos/acme/demo", { access: "public" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/demo",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("uses direct authenticated requests for repo auto access when auth is available", async () => {
    resolveRegisteredGitHubRequestAuthMock.mockResolvedValue({
      mode: "pat" as const,
      token: "pat-token",
    });
    state.env.VITE_GITHUB_PROXY_ENABLED = true;
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    await githubApiFetch("/repos/acme/demo", { access: "repo" });

    expect(resolveRegisteredGitHubRequestAuthMock).toHaveBeenCalledWith("repo");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/demo",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer pat-token",
        }),
      }),
    );
  });

  it("falls back to direct anonymous requests for repo auto access when auth is unavailable", async () => {
    state.env.VITE_GITHUB_PROXY_ENABLED = true;
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    await githubApiFetch("/repos/acme/demo", { access: "repo" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/demo",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("throws for repo proxy access", async () => {
    const { githubApiFetch } = await import("@/repo/github-fetch");

    await expect(
      githubApiFetch("/repos/acme/demo", { access: "repo", transport: "proxy" }),
    ).rejects.toThrow("Proxy transport only supports public GitHub requests in v1.");
  });

  it("does not keep cross-request blocked-until state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createRateLimitResponse())
      .mockResolvedValueOnce(createRateLimitResponse())
      .mockResolvedValueOnce(createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { GitHubRateLimitError, githubApiFetch } = await import("@/repo/github-fetch");

    await expect(githubApiFetch("/repos/acme/demo", { access: "repo" })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );
    await expect(githubApiFetch("/repos/acme/demo", { access: "repo" })).rejects.toBeInstanceOf(
      GitHubRateLimitError,
    );

    const response = await githubApiFetch("/repos/acme/demo", { access: "repo" });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("supports oauth, pat, and anonymous direct auth resolution", async () => {
    resolveRegisteredGitHubRequestAuthMock
      .mockResolvedValueOnce({ mode: "oauth" as const, scopes: ["repo"], token: "oauth-token" })
      .mockResolvedValueOnce({ mode: "pat" as const, token: "pat-token" })
      .mockResolvedValueOnce({ mode: "anon" as const });
    const fetchMock = vi.fn(async () => createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");

    await githubApiFetch("/repos/acme/demo", { access: "public", transport: "direct" });
    await githubApiFetch("/repos/acme/demo", { access: "repo", transport: "direct" });
    await githubApiFetch("/repos/acme/demo", { access: "repo", transport: "direct" });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer oauth-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer pat-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("keeps request-local anonymous fallback for direct auth failures", async () => {
    resolveRegisteredGitHubRequestAuthMock.mockResolvedValue({
      mode: "pat" as const,
      token: "github_pat_demo",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(
          {
            message: "Resource not accessible by personal access token",
          },
          403,
        ),
      )
      .mockResolvedValueOnce(createJsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    const response = await githubApiFetch("/repos/acme/demo", {
      access: "repo",
      transport: "direct",
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github_pat_demo",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it("shows an actionable toast and appends a session notice for GitHub rate limits", async () => {
    const blockedUntilMs = Date.parse("2026-03-29T10:02:00.000Z");
    const { GitHubRateLimitError, handleGithubError } = await import("@/repo/github-fetch");

    const handled = await handleGithubError(
      new GitHubRateLimitError({
        blockedUntilMs,
        kind: "primary",
      }),
      { sessionId: "session-1" },
    );

    expect(handled).toBe(true);
    expect(appendSessionNoticeMock).toHaveBeenCalledWith(
      "session-1",
      expect.any(GitHubRateLimitError),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("GitHub requests are rate limited"),
      expect.objectContaining({
        action: expect.objectContaining({
          label: "Open GitHub settings",
        }),
      }),
    );
  });
});
