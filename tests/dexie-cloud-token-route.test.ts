import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
  env: {
    DEXIE_CLOUD_CLIENT_ID: "dexie-client-id",
    DEXIE_CLOUD_CLIENT_SECRET: "dexie-client-secret",
    DEXIE_CLOUD_DB_URL: "https://gitinspect.dexie.cloud",
  },
  fetch: vi.fn(),
  getCanonicalAppUserId: vi.fn(),
  isSyncEntitledForUser: vi.fn(),
}));

vi.mock("@gitinspect/auth", () => ({
  auth: state.auth,
}));

vi.mock("@gitinspect/env/server", () => ({
  env: state.env,
}));

vi.mock("@/lib/autumn.server", () => ({
  getCanonicalAppUserId: state.getCanonicalAppUserId,
  isSyncEntitledForUser: state.isSyncEntitledForUser,
}));

describe("/api/dexie-cloud-token route", () => {
  beforeEach(() => {
    state.auth.api.getSession.mockReset();
    state.fetch.mockReset();
    state.getCanonicalAppUserId.mockReset();
    state.isSyncEntitledForUser.mockReset();
    vi.stubGlobal("fetch", state.fetch);
    state.env.DEXIE_CLOUD_CLIENT_ID = "dexie-client-id";
    state.env.DEXIE_CLOUD_CLIENT_SECRET = "dexie-client-secret";
    state.env.DEXIE_CLOUD_DB_URL = "https://gitinspect.dexie.cloud";
  });

  it("returns 401 when the user is signed out", async () => {
    state.auth.api.getSession.mockResolvedValue(null);
    const { Route } = await import("@/routes/api/dexie-cloud-token");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/dexie-cloud-token", {
        body: JSON.stringify({ public_key: "public-key-1" }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(401);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("returns 403 when sync entitlement is missing", async () => {
    state.auth.api.getSession.mockResolvedValue({
      user: {
        email: "dev@example.com",
        ghId: "gh_123",
        id: "user-1",
        name: "Dev",
      },
    });
    state.isSyncEntitledForUser.mockResolvedValue(false);
    const { Route } = await import("@/routes/api/dexie-cloud-token");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/dexie-cloud-token", {
        body: JSON.stringify({ public_key: "public-key-1" }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(403);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("mints a Dexie Cloud token for entitled users", async () => {
    state.auth.api.getSession.mockResolvedValue({
      user: {
        email: "dev@example.com",
        ghId: "gh_123",
        id: "user-1",
        name: "Dev",
      },
    });
    state.getCanonicalAppUserId.mockReturnValue("gh_123");
    state.isSyncEntitledForUser.mockResolvedValue(true);
    state.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "access-token-1",
          accessTokenExpiration: Date.now() + 60_000,
          claims: {
            sub: "gh_123",
          },
          type: "tokens",
          userType: "prod",
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        },
      ),
    );
    const { Route } = await import("@/routes/api/dexie-cloud-token");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/dexie-cloud-token", {
        body: JSON.stringify({
          hints: {
            userId: "gh_123",
          },
          public_key: "public-key-1",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(200);
    expect(state.fetch).toHaveBeenCalledWith(
      "https://gitinspect.dexie.cloud/token",
      expect.objectContaining({
        body: JSON.stringify({
          claims: {
            email: "dev@example.com",
            name: "Dev",
            sub: "gh_123",
          },
          client_id: "dexie-client-id",
          client_secret: "dexie-client-secret",
          grant_type: "client_credentials",
          public_key: "public-key-1",
          scopes: ["ACCESS_DB"],
        }),
        method: "POST",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      accessToken: "access-token-1",
      type: "tokens",
    });
  });
});
