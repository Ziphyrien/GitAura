import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  MessageRow,
  PublicSessionRecord,
  SessionData,
  SyncedSessionRow,
} from "@gitinspect/db";
import { createEmptyUsage } from "@gitinspect/pi/types/models";

const state = vi.hoisted(() => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
  deleteDexieCloudRecord: vi.fn(),
  env: {
    DEXIE_CLOUD_CLIENT_ID: "dexie-client-id",
    DEXIE_CLOUD_CLIENT_SECRET: "dexie-client-secret",
    DEXIE_CLOUD_DB_URL: "https://gitinspect.dexie.cloud",
  },
  getCanonicalAppUserId: vi.fn(),
  getDexieCloudRecord: vi.fn(),
  isShareEntitledForUser: vi.fn(),
  listDexieCloudRecords: vi.fn(),
  putDexieCloudRecord: vi.fn(),
}));

vi.mock("@gitinspect/auth", () => ({
  auth: state.auth,
}));

vi.mock("@gitinspect/env/server", () => ({
  env: state.env,
}));

vi.mock("@/lib/autumn.server", () => ({
  getCanonicalAppUserId: state.getCanonicalAppUserId,
  isShareEntitledForUser: state.isShareEntitledForUser,
}));

vi.mock("@/lib/dexie-cloud-rest.server", () => ({
  DexieCloudSchemaPendingError: class DexieCloudSchemaPendingError extends Error {
    override readonly name = "DexieCloudSchemaPendingError";
  },
  deleteDexieCloudRecord: state.deleteDexieCloudRecord,
  getDexieCloudRecord: state.getDexieCloudRecord,
  listDexieCloudRecords: state.listDexieCloudRecords,
  putDexieCloudRecord: state.putDexieCloudRecord,
}));

function buildSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-04-16T12:00:00.000Z",
    id: "session-1",
    isStreaming: false,
    messageCount: 2,
    model: "gpt-5.1-codex-mini",
    preview: "How does sharing work?",
    provider: "openai",
    providerGroup: "openai-codex",
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
    title: "Sharing test",
    updatedAt: "2026-04-16T12:05:00.000Z",
    usage: createEmptyUsage(),
  };
}

function buildMessages(): MessageRow[] {
  return [
    {
      content: "How does sharing work?",
      id: "user-1",
      order: 0,
      role: "user",
      sessionId: "session-1",
      status: "completed",
      timestamp: 1,
    },
    {
      api: "openai-responses",
      content: [{ text: "It publishes a read-only snapshot.", type: "text" }],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      order: 1,
      provider: "openai",
      role: "assistant",
      sessionId: "session-1",
      status: "completed",
      stopReason: "stop",
      timestamp: 2,
      usage: createEmptyUsage(),
    },
  ];
}

describe("/api/shares/$sessionId route", () => {
  beforeEach(() => {
    state.auth.api.getSession.mockReset();
    state.deleteDexieCloudRecord.mockReset();
    state.getCanonicalAppUserId.mockReset();
    state.getDexieCloudRecord.mockReset();
    state.isShareEntitledForUser.mockReset();
    state.listDexieCloudRecords.mockReset();
    state.putDexieCloudRecord.mockReset();
    state.env.DEXIE_CLOUD_CLIENT_ID = "dexie-client-id";
    state.env.DEXIE_CLOUD_CLIENT_SECRET = "dexie-client-secret";
    state.env.DEXIE_CLOUD_DB_URL = "https://gitinspect.dexie.cloud";
  });

  it("returns 401 for signed-out share status checks", async () => {
    state.auth.api.getSession.mockResolvedValue(null);
    const { Route } = await import("@/routes/api/shares.$sessionId");

    const response = await Route.options.server.handlers.GET({
      params: { sessionId: "session-1" },
      request: new Request("https://gitinspect.com/api/shares/session-1"),
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 when a non-owner tries to unshare", async () => {
    state.auth.api.getSession.mockResolvedValue({
      user: {
        ghId: "gh_current",
        id: "user-1",
      },
    });
    state.getCanonicalAppUserId.mockReturnValue("gh_current");
    state.getDexieCloudRecord.mockResolvedValue({
      createdAt: "2026-04-16T12:00:00.000Z",
      id: "session-1",
      ownerUserId: "gh_other",
      publishedAt: "2026-04-16T12:06:00.000Z",
      realmId: "rlm-public",
      title: "Other",
      updatedAt: "2026-04-16T12:06:00.000Z",
    } satisfies PublicSessionRecord);
    const { Route } = await import("@/routes/api/shares.$sessionId");

    const response = await Route.options.server.handlers.DELETE({
      params: { sessionId: "session-1" },
      request: new Request("https://gitinspect.com/api/shares/session-1", {
        method: "DELETE",
      }),
    });

    expect(response.status).toBe(403);
    expect(state.deleteDexieCloudRecord).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller does not own the synced session", async () => {
    state.auth.api.getSession.mockResolvedValue({
      user: {
        email: "dev@example.com",
        ghId: "gh_owner",
        id: "user-1",
        name: "Dev",
      },
    });
    state.getCanonicalAppUserId.mockReturnValue("gh_owner");
    state.isShareEntitledForUser.mockResolvedValue(true);
    state.getDexieCloudRecord.mockImplementation(async (path: string) => {
      if (path.includes("/all/sessions/")) {
        return {
          ...buildSession(),
          owner: "gh_someone_else",
        } satisfies SyncedSessionRow;
      }
      return undefined;
    });
    const { Route } = await import("@/routes/api/shares.$sessionId");

    const response = await Route.options.server.handlers.PUT({
      params: { sessionId: "session-1" },
      request: new Request("https://gitinspect.com/api/shares/session-1", {
        body: JSON.stringify({
          messages: buildMessages(),
          session: buildSession(),
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "PUT",
      }),
    });

    expect(response.status).toBe(403);
    expect(state.putDexieCloudRecord).not.toHaveBeenCalled();
  });

  it("publishes a snapshot for the owner", async () => {
    state.auth.api.getSession.mockResolvedValue({
      user: {
        email: "dev@example.com",
        ghId: "gh_owner",
        id: "user-1",
        name: "Dev",
      },
    });
    state.getCanonicalAppUserId.mockReturnValue("gh_owner");
    state.getDexieCloudRecord.mockImplementation(async (path: string) => {
      if (path.includes("/all/sessions/")) {
        return {
          ...buildSession(),
          owner: "gh_owner",
        } satisfies SyncedSessionRow;
      }
      return undefined;
    });
    state.isShareEntitledForUser.mockResolvedValue(true);
    state.listDexieCloudRecords.mockResolvedValue([{ id: "stale-1" }]);
    const { Route } = await import("@/routes/api/shares.$sessionId");

    const response = await Route.options.server.handlers.PUT({
      params: { sessionId: "session-1" },
      request: new Request("https://gitinspect.com/api/shares/session-1", {
        body: JSON.stringify({
          messages: buildMessages(),
          session: buildSession(),
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "PUT",
      }),
    });

    expect(response.status).toBe(200);
    expect(state.deleteDexieCloudRecord).toHaveBeenCalledWith("/public/publicMessages/stale-1");
    expect(state.putDexieCloudRecord).toHaveBeenCalledWith(
      "/public/publicSessions",
      expect.objectContaining({
        id: "session-1",
        ownerUserId: "gh_owner",
        realmId: "rlm-public",
        title: "Sharing test",
      }),
    );
    expect(
      state.putDexieCloudRecord.mock.calls.some(([path]) => String(path).includes("shareOwners")),
    ).toBe(false);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      url: "https://gitinspect.com/share/session-1",
    });
  });
});
