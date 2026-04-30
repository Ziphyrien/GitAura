import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Type } from "typebox";
import { deleteAllLocalData } from "@webaura/db";
import { githubExtensionPackage } from "@webaura/extensions/github";
import { createExtensionRuntimeSnapshot } from "@webaura/pi/extensions/registry";
import { getEnabledExtensionRuntime, getExtensionCatalog } from "@webaura/pi/extensions/runtime";
import { setExtensionEnabled } from "@webaura/pi/extensions/settings";
import type { ExtensionPackage, WebAuraExtension } from "@webaura/pi/extensions/types";

const customExtension: WebAuraExtension = {
  manifest: {
    description: "Test extension",
    id: "test-extension",
    name: "Test Extension",
    version: "1.0.0",
  },
  register(api) {
    api.registerTool({
      description: "Echo a string",
      label: "Echo",
      name: "test_echo",
      parameters: Type.Object({
        text: Type.String(),
      }),
      async execute(_toolCallId, params) {
        return {
          content: [{ text: params.text, type: "text" }],
          details: { text: params.text },
        };
      },
    });
  },
};

const installedExtensions = [githubExtensionPackage] satisfies readonly ExtensionPackage[];

describe("extensions", () => {
  beforeEach(async () => {
    await deleteAllLocalData();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps installed extensions disabled by default", async () => {
    const catalog = await getExtensionCatalog(installedExtensions);
    const runtime = await getEnabledExtensionRuntime(installedExtensions);

    expect(catalog).toEqual([
      expect.objectContaining({
        enabled: false,
        manifest: expect.objectContaining({ id: "github" }),
      }),
    ]);
    expect(runtime.enabledExtensions).toEqual([]);
    expect(runtime.tools).toEqual([]);
  });

  it("loads package runtime only after the package is enabled", async () => {
    const loadRuntime = vi.fn(async () => customExtension);
    const lazyPackage = {
      defaultEnabled: false,
      loadRuntime,
      manifest: customExtension.manifest,
      source: {
        kind: "uploaded" as const,
        packageId: customExtension.manifest.id,
      },
    } satisfies ExtensionPackage;

    expect(await getEnabledExtensionRuntime([lazyPackage])).toEqual({
      enabledExtensions: [],
      tools: [],
    });
    expect(loadRuntime).not.toHaveBeenCalled();

    await setExtensionEnabled(customExtension.manifest.id, true);

    const runtime = await getEnabledExtensionRuntime([lazyPackage]);

    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.enabledExtensions.map((extension) => extension.id)).toEqual([
      customExtension.manifest.id,
    ]);
  });

  it("registers GitHub tools only after the extension is enabled", async () => {
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);

    expect(runtime.enabledExtensions.map((extension) => extension.id)).toEqual(["github"]);
    expect(runtime.tools.map((tool) => tool.name).sort()).toEqual([
      "github_actions",
      "github_api",
      "github_issue",
      "github_pr",
      "github_repo",
      "github_search",
      "github_status",
    ]);
  });

  it("maps repository searches to GitHub's repositories search endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ incomplete_results: false, items: [], total_count: 0 }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_search");

    if (!tool) {
      throw new Error("github_search tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        query: "mariozechner pi-ai",
        type: "repos",
      },
      undefined,
    );
    const [contentPart] = result.content;

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "https://api.github.com/search/repositories?",
    );
    expect(contentPart?.text).toContain('repos query="mariozechner pi-ai"');
    expect(contentPart?.text).not.toContain("Structured result");
  });

  it("qualifies issue searches so pull requests are not mixed in", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ incomplete_results: false, items: [], total_count: 0 }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_search");

    if (!tool) {
      throw new Error("github_search tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        query: "auth",
        repo: "owner/repo",
        type: "issues",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("q=auth+repo%3Aowner%2Frepo+is%3Aissue");
  });

  it("rejects unscoped code searches before GitHub returns 422", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_search");

    if (!tool) {
      throw new Error("github_search tool was not registered");
    }

    await expect(
      tool.execute(
        "call-1",
        {
          query: "createSession",
          type: "code",
        },
        undefined,
      ),
    ).rejects.toThrow("requires repo parameter or a repo:/org:/user: qualifier");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns code search text matches when GitHub provides them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          incomplete_results: false,
          items: [
            {
              html_url: "https://github.com/owner/repo/blob/main/src/auth.ts",
              path: "src/auth.ts",
              repository: { full_name: "owner/repo" },
              sha: "abc123",
              text_matches: [
                {
                  fragment: "export function auth() { return true }",
                  matches: [{ indices: [16, 20], text: "auth" }],
                  object_type: "FileContent",
                  property: "content",
                },
              ],
            },
          ],
          total_count: 1,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_search");

    if (!tool) {
      throw new Error("github_search tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        query: "auth",
        repo: "owner/repo",
        type: "code",
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestHeaders = requestInit?.headers as Record<string, string> | undefined;

    expect(requestHeaders?.Accept).toBe("application/vnd.github.text-match+json");
    expect(result.content[0]?.text).toContain("owner/repo/src/auth.ts");
    expect(result.content[0]?.text).toContain("export function auth()");
    expect(result.details).toMatchObject({
      items: [
        {
          path: "src/auth.ts",
          textMatches: [{ fragment: "export function auth() { return true }" }],
        },
      ],
    });
  });

  it("returns compact line-windowed file reads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: btoa("alpha\nbeta\ngamma\ndelta"),
          encoding: "base64",
          html_url: "https://github.com/owner/repo/blob/main/src/index.ts",
          name: "index.ts",
          path: "src/index.ts",
          sha: "abc123",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        lineNumbers: true,
        limit: 2,
        offset: 2,
        operation: "read",
        path: "src/index.ts",
        repo: "owner/repo",
      },
      undefined,
    );
    const [contentPart] = result.content;

    expect(contentPart?.text).toBe(
      "file: owner/repo/src/index.ts\nlines: 2-3/4 nextOffset=4\n\n2\tbeta\n3\tgamma\n\n[1 more lines in file. Use offset=4 to continue.]",
    );
    expect(result.details).toMatchObject({
      lines: {
        endLine: 3,
        nextOffset: 4,
        offset: 2,
        totalLines: 4,
        lineNumbers: true,
        truncated: true,
        truncatedBy: "lines",
      },
    });
  });

  it("reads file contents through operation=contents even without explicit line options", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: btoa("alpha\nbeta"),
          encoding: "base64",
          name: "index.ts",
          path: "src/index.ts",
          sha: "abc123",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        operation: "contents",
        path: "src/index.ts",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(result.content[0]?.text).toBe(
      "file: owner/repo/src/index.ts\nlines: 1-2/2\n\nalpha\nbeta",
    );
    expect(result.details).toMatchObject({
      file: { path: "src/index.ts", sha: "abc123" },
      lines: { endLine: 2, offset: 1, totalLines: 2 },
    });
  });

  it("rejects text reads when offset is beyond the file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: btoa("alpha\nbeta"),
          encoding: "base64",
          name: "index.ts",
          path: "src/index.ts",
          sha: "abc123",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    await expect(
      tool.execute(
        "call-1",
        {
          offset: 9,
          operation: "read",
          path: "src/index.ts",
          repo: "owner/repo",
        },
        undefined,
      ),
    ).rejects.toThrow("Offset 9 is beyond end of file (2 lines total)");
  });

  it("lists GitHub issues through search so pull requests are not paginated in", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          incomplete_results: false,
          items: [
            {
              comments: 2,
              html_url: "https://github.com/owner/repo/issues/7",
              labels: [{ name: "bug" }],
              number: 7,
              state: "open",
              title: "Fix auth",
              user: { login: "octo" },
            },
          ],
          total_count: 1,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_issue");

    if (!tool) {
      throw new Error("github_issue tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        direction: "asc",
        limit: 1,
        operation: "list",
        page: 2,
        repo: "owner/repo",
        sort: "updated",
      },
      undefined,
    );
    const [contentPart] = result.content;

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(requestUrl.pathname).toBe("/search/issues");
    expect(requestUrl.searchParams.get("q")).toBe("repo:owner/repo is:issue");
    expect(requestUrl.searchParams.get("order")).toBe("asc");
    expect(requestUrl.searchParams.get("page")).toBe("2");
    expect(requestUrl.searchParams.get("per_page")).toBe("1");
    expect(requestUrl.searchParams.get("sort")).toBe("updated");
    expect(contentPart?.text).toContain(
      "owner/repo issues page=2 total=1 returned=1 incomplete=false",
    );
    expect(contentPart?.text).toContain("#7 open Fix auth");
    expect(result.details).toMatchObject({
      issues: [
        {
          author: "octo",
          labels: ["bug"],
          number: 7,
        },
      ],
      incomplete: false,
      page: 2,
      repo: "owner/repo",
      total: 1,
    });
  });

  it("paginates issue comments when fetching issue details", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            body: "Issue body",
            comments: 1,
            html_url: "https://github.com/owner/repo/issues/7",
            number: 7,
            state: "open",
            title: "Fix auth",
            user: { login: "octo" },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              body: "Please add a regression test",
              html_url: "https://github.com/owner/repo/issues/7#issuecomment-1",
              user: { login: "reviewer" },
            },
          ]),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_issue");

    if (!tool) {
      throw new Error("github_issue tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        includeComments: true,
        limit: 2,
        number: 7,
        operation: "get",
        page: 3,
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/issues/7/comments?page=3&per_page=2",
    );
    expect(result.details).toMatchObject({
      comments: [{ author: "reviewer", body: "Please add a regression test" }],
      commentsPage: 3,
    });
  });

  it("keeps issue search filters inside the search query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ incomplete_results: false, items: [], total_count: 0 }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_issue");

    if (!tool) {
      throw new Error("github_issue tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        assignee: "alice",
        labels: ["help wanted", "ui"],
        operation: "list",
        repo: "owner/repo",
        search: "bug",
        state: "closed",
      },
      undefined,
    );

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(requestUrl.pathname).toBe("/search/issues");
    expect(requestUrl.searchParams.get("q")).toBe(
      'repo:owner/repo is:issue bug is:closed assignee:alice label:"help wanted" label:ui',
    );
  });

  it("returns binary file metadata instead of decoded garbage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: btoa("\0PNG\r\n\u001a\n"),
          encoding: "base64",
          name: "image.png",
          path: "assets/image.png",
          sha: "abc123",
          size: 8,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        operation: "read",
        path: "assets/image.png",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(result.content[0]?.text).toBe(
      "file: owner/repo/assets/image.png\n\n[Binary file, size: 8 bytes]",
    );
    expect(result.details).toMatchObject({
      binary: true,
      file: {
        path: "assets/image.png",
        size: 8,
      },
    });
  });

  it("reads oversized repository files through Git blobs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: "",
            encoding: "none",
            name: "big.txt",
            path: "docs/big.txt",
            sha: "blob-sha",
            size: 1_000_001,
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: btoa("alpha\nbeta"),
            encoding: "base64",
            sha: "blob-sha",
            size: 1_000_001,
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        operation: "read",
        path: "docs/big.txt",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/git/blobs/blob-sha",
    );
    expect(result.content[0]?.text).toBe(
      "file: owner/repo/docs/big.txt\nlines: 1-2/2\n\nalpha\nbeta",
    );
    expect(result.details).toMatchObject({ file: { path: "docs/big.txt", sha: "blob-sha" } });
  });

  it("returns repository trees with line windows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tree: [
            { path: "src/index.ts", sha: "aaa", size: 10, type: "blob" },
            { path: "src/runtime.ts", sha: "bbb", size: 20, type: "blob" },
            { path: "tests", sha: "ccc", type: "tree" },
          ],
          truncated: false,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        limit: 2,
        operation: "tree",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/git/trees/HEAD",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toContain(
      "owner/repo tree target=HEAD recursive=false entries=3",
    );
    expect(result.content[0]?.text).toContain("blob src/index.ts 10b");
    expect(result.content[0]?.text).toContain("Use offset=3 to continue");
    expect(result.details).toMatchObject({
      entries: [
        { path: "src/index.ts", type: "blob" },
        { path: "src/runtime.ts", type: "blob" },
      ],
      totalEntries: 3,
    });
  });

  it("only compacts visible repository tree entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tree: [
            { sha: "bad", type: "blob" },
            { path: "src/index.ts", sha: "good", size: 10, type: "blob" },
          ],
          truncated: false,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        limit: 1,
        offset: 2,
        operation: "tree",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(result.content[0]?.text).toContain("blob src/index.ts 10b");
    expect(result.details).toMatchObject({
      entries: [{ path: "src/index.ts", type: "blob" }],
      totalEntries: 2,
    });
  });

  it("reads repository trees by tree sha when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tree: [{ path: "nested.ts", sha: "blob-sha", size: 12, type: "blob" }],
          truncated: false,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_repo");

    if (!tool) {
      throw new Error("github_repo tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        operation: "tree",
        recursive: true,
        repo: "owner/repo",
        sha: "tree-sha",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/git/trees/tree-sha?recursive=1",
    );
    expect(result.content[0]?.text).toContain(
      "owner/repo tree target=tree-sha recursive=true entries=1",
    );
    expect(result.details).toMatchObject({ target: "tree-sha", recursive: true });
  });

  it("passes pull request list sorting to GitHub", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            draft: false,
            html_url: "https://github.com/owner/repo/pull/5",
            number: 5,
            state: "open",
            title: "Fix auth",
          },
        ]),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        direction: "asc",
        operation: "list",
        repo: "owner/repo",
        sort: "updated",
        state: "closed",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls?direction=asc&page=1&per_page=20&sort=updated&state=closed",
    );
  });

  it("paginates pull request files", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { additions: 1, changes: 1, deletions: 0, filename: "src/auth.ts", status: "modified" },
        ]),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        limit: 30,
        number: 5,
        operation: "files",
        page: 4,
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls/5/files?page=4&per_page=30",
    );
    expect(result.content[0]?.text).toContain("owner/repo#5 files page=4 returned=1");
  });

  it("includes pull request conversation and review comments", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            body: "PR body",
            comments: 1,
            draft: false,
            html_url: "https://github.com/owner/repo/pull/5",
            number: 5,
            review_comments: 1,
            state: "open",
            title: "Fix auth",
            user: { login: "octo" },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              body: "Please update tests",
              html_url: "https://github.com/owner/repo/pull/5#issuecomment-1",
              user: { login: "maintainer" },
            },
          ]),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              body: "Simplify this branch",
              html_url: "https://github.com/owner/repo/pull/5#discussion_r1",
              id: 1,
              line: 12,
              path: "src/auth.ts",
              user: { login: "reviewer" },
            },
          ]),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              body: "Looks good overall",
              html_url: "https://github.com/owner/repo/pull/5#pullrequestreview-1",
              id: 11,
              state: "APPROVED",
              submitted_at: "2026-04-30T12:00:00Z",
              user: { login: "approver" },
            },
          ]),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        includeComments: true,
        includeReviewComments: true,
        includeReviews: true,
        limit: 2,
        number: 5,
        operation: "get",
        page: 3,
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/issues/5/comments?page=3&per_page=2",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls/5/comments?page=3&per_page=2",
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls/5/reviews?page=3&per_page=2",
    );
    expect(result.details).toMatchObject({
      comments: [{ author: "maintainer", body: "Please update tests" }],
      commentsPage: 3,
      reviewComments: [{ author: "reviewer", path: "src/auth.ts" }],
      reviews: [{ author: "approver", body: "Looks good overall", state: "APPROVED" }],
      reviewsPage: 3,
    });
  });

  it("merges GitHub pull requests through the REST merge endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ merged: true, message: "Pull Request successfully merged" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        commitMessage: "merge it",
        commitTitle: "Squash auth fixes",
        mergeMethod: "squash",
        number: 5,
        sha: "head-sha",
        operation: "merge",
        repo: "owner/repo",
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls/5/merge",
    );
    expect(requestInit?.method).toBe("PUT");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      commit_message: "merge it",
      commit_title: "Squash auth fixes",
      merge_method: "squash",
      sha: "head-sha",
    });
    expect(result.content[0]?.text).toContain("merged pull request owner/repo#5");
  });

  it("reads pull request diffs as line-windowed text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("diff --git a/a.ts b/a.ts\n+one\n+two\n+three", {
        headers: { "content-type": "text/plain" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        lineNumbers: true,
        limit: 2,
        number: 5,
        operation: "diff",
        repo: "owner/repo",
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestHeaders = requestInit?.headers as Record<string, string> | undefined;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls/5",
    );
    expect(requestHeaders?.Accept).toBe("application/vnd.github.v3.diff");
    expect(result.content[0]?.text).toBe(
      "file: owner/repo/pulls/5.diff\nlines: 1-2/4 nextOffset=3\n\n1\tdiff --git a/a.ts b/a.ts\n2\t+one\n\n[2 more lines in file. Use offset=3 to continue.]",
    );
  });

  it("returns pull request line-level review comments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            body: "Please simplify this branch\n```ts\nreturn value\n```",
            diff_hunk: "@@ -1 +1 @@",
            html_url: "https://github.com/owner/repo/pull/5#discussion_r1",
            id: 1,
            line: 12,
            path: "src/auth.ts",
            user: { login: "reviewer" },
          },
        ]),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        number: 5,
        operation: "review_comments",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/pulls/5/comments?page=1&per_page=20",
    );
    expect(result.content[0]?.text).toContain(
      "src/auth.ts:12 reviewer Please simplify this branch\t```ts\treturn value\t```",
    );
    expect(result.details).toMatchObject({
      reviewComments: [
        {
          author: "reviewer",
          path: "src/auth.ts",
        },
      ],
    });
  });

  it("submits line-level comments with pull request reviews", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          html_url: "https://github.com/owner/repo/pull/5#review",
          id: 10,
          state: "CHANGES_REQUESTED",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        body: "Review summary",
        commitId: "review-sha",
        number: 5,
        operation: "review",
        repo: "owner/repo",
        reviewComments: [
          {
            body: "Please simplify this branch",
            line: 12,
            path: "src/auth.ts",
            side: "RIGHT",
          },
        ],
        reviewEvent: "REQUEST_CHANGES",
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(JSON.parse(String(requestInit?.body))).toEqual({
      body: "Review summary",
      comments: [
        {
          body: "Please simplify this branch",
          line: 12,
          path: "src/auth.ts",
          side: "RIGHT",
        },
      ],
      commit_id: "review-sha",
      event: "REQUEST_CHANGES",
    });
  });

  it("rejects pull request review comments without an exact location", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    await expect(
      tool.execute(
        "call-1",
        {
          number: 5,
          operation: "review",
          repo: "owner/repo",
          reviewComments: [{ body: "Needs a location", path: "src/auth.ts" }],
        },
        undefined,
      ),
    ).rejects.toThrow("require exactly one of line or position");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits empty pull request review bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          html_url: "https://github.com/owner/repo/pull/5#review",
          id: 10,
          state: "APPROVED",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_pr");

    if (!tool) {
      throw new Error("github_pr tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        number: 5,
        operation: "review",
        repo: "owner/repo",
        reviewEvent: "APPROVE",
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(JSON.parse(String(requestInit?.body))).toEqual({ event: "APPROVE" });
  });

  it("returns GitHub Actions run totals from the REST list endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          total_count: 7,
          workflow_runs: [
            {
              display_title: "CI",
              html_url: "https://github.com/owner/repo/actions/runs/42",
              id: 42,
              status: "completed",
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_actions");

    if (!tool) {
      throw new Error("github_actions tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        operation: "runs",
        repo: "owner/repo",
      },
      undefined,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/actions/runs?page=1&per_page=20",
    );
    expect(result.content[0]?.text).toContain("owner/repo runs page=1 total=7 returned=1");
    expect(result.details).toMatchObject({ total: 7, runs: [{ id: 42, status: "completed" }] });
  });

  it("reruns GitHub Actions runs through the REST rerun endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 201,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_actions");

    if (!tool) {
      throw new Error("github_actions tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        operation: "rerun",
        repo: "owner/repo",
        runId: 42,
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/actions/runs/42/rerun",
    );
    expect(requestInit?.method).toBe("POST");
    expect(result.content[0]?.text).toBe("rerun requested for owner/repo run 42");
  });

  it("reads GitHub Actions job logs as line-windowed text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("setup\nbuild\nfail", {
        headers: { "content-type": "text/plain" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_actions");

    if (!tool) {
      throw new Error("github_actions tool was not registered");
    }

    const result = await tool.execute(
      "call-1",
      {
        jobId: 99,
        limit: 2,
        operation: "logs",
        repo: "owner/repo",
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestHeaders = requestInit?.headers as Record<string, string> | undefined;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/actions/jobs/99/logs",
    );
    expect(requestHeaders?.Accept).toBe("text/plain");
    expect(result.content[0]?.text).toBe(
      "file: owner/repo/actions/jobs/99.log\nlines: 1-2/3 nextOffset=3\n\nsetup\nbuild\n\n[1 more lines in file. Use offset=3 to continue.]",
    );
  });

  it("does not call raw GitHub mutations unless confirmed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_api");

    if (!tool) {
      throw new Error("github_api tool was not registered");
    }

    await expect(
      tool.execute(
        "call-1",
        {
          body: {},
          method: "POST",
          operation: "rest",
          path: "/repos/owner/repo/issues",
        },
        undefined,
      ),
    ).rejects.toThrow("confirmMutation=true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects GraphQL mutations after leading comments unless confirmed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_api");

    if (!tool) {
      throw new Error("github_api tool was not registered");
    }

    await expect(
      tool.execute(
        "call-1",
        {
          graphqlQuery:
            "// update issue\nmutation CloseIssue { closeIssue(input: {}) { clientMutationId } }",
          operation: "graphql",
        },
        undefined,
      ),
    ).rejects.toThrow("confirmMutation=true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not reject GraphQL queries that mention mutation in comments or strings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { viewer: { login: "octo" } } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_api");

    if (!tool) {
      throw new Error("github_api tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        graphqlQuery:
          'query Viewer { viewer { login } issue(title: "mutation bug") { title } } # mutation note',
        operation: "graphql",
      },
      undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes raw GitHub REST body and query as native JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    await setExtensionEnabled("github", true);

    const runtime = await getEnabledExtensionRuntime(installedExtensions);
    const tool = runtime.tools.find((candidate) => candidate.name === "github_api");

    if (!tool) {
      throw new Error("github_api tool was not registered");
    }

    await tool.execute(
      "call-1",
      {
        body: { body: "hello" },
        confirmMutation: true,
        operation: "rest",
        path: "/repos/owner/repo/issues",
        query: { per_page: 1, preview: true },
      },
      undefined,
    );
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/owner/repo/issues?per_page=1&preview=true",
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({ body: "hello" });
  });

  it("wraps extension tools with execution context", async () => {
    const runtime = await createExtensionRuntimeSnapshot([customExtension]);
    const [tool] = runtime.tools;

    const result = await tool.execute("call-1", { text: "hello" }, undefined);

    expect(result).toEqual({
      content: [{ text: "hello", type: "text" }],
      details: { text: "hello" },
    });
  });

  it("rejects duplicate tool names across enabled extensions", async () => {
    await expect(
      createExtensionRuntimeSnapshot([customExtension, customExtension]),
    ).rejects.toThrow("Tool test_echo is already registered");
  });
});
