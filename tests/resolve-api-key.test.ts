import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const providerKeyRows = new Map<string, { provider: string; updatedAt: string; value: string }>();
const settingsRows = new Map<string, { key: string; updatedAt: string; value: unknown }>();
const setProviderKey = vi.fn(async (provider: string, value: string) => {
  providerKeyRows.set(provider, {
    provider,
    updatedAt: new Date().toISOString(),
    value,
  });
});
const getProviderKey = vi.fn(async (provider: string) => providerKeyRows.get(provider));
const oauthRefresh = vi.fn();
const getProxyConfig = vi.fn();

vi.mock("@webaura/db", () => ({
  db: {
    providerKeys: {},
    settings: {
      add: async (row: { key: string; updatedAt: string; value: unknown }) => {
        if (settingsRows.has(row.key)) {
          throw new DOMException("Duplicate key", "ConstraintError");
        }

        settingsRows.set(row.key, row);
      },
      delete: async (key: string) => {
        settingsRows.delete(key);
      },
      get: async (key: string) => settingsRows.get(key),
    },
    transaction: async (
      _mode: string,
      _table: Record<string, string>,
      callback: () => Promise<void>,
    ) => await callback(),
  },
  getProviderKey,
  setProviderKey,
}));

vi.mock("@/auth/oauth-refresh", () => ({
  oauthRefresh,
}));

vi.mock("@/proxy/settings", () => ({
  getProxyConfig,
}));

describe("resolveStoredApiKey", () => {
  beforeEach(() => {
    providerKeyRows.clear();
    settingsRows.clear();
    setProviderKey.mockClear();
    getProviderKey.mockClear();
    oauthRefresh.mockReset();
    getProxyConfig.mockReset();
  });

  it("returns plain api keys unchanged", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key");

    await expect(resolveStoredApiKey("sk-test", "openai-codex")).resolves.toBe("sk-test");
  });

  it("refreshes expiring OAuth credentials and stores the update", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key");
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    });
    oauthRefresh.mockResolvedValue({
      access: "next-access",
      accountId: "acct-1",
      expires: Date.now() + 120_000,
      providerId: "openai-codex",
      refresh: "next-refresh",
    });

    const result = await resolveStoredApiKey(
      JSON.stringify({
        access: "old-access",
        accountId: "acct-1",
        expires: Date.now() - 1,
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
      "openai-codex",
    );

    expect(result).toBe("next-access");
    expect(oauthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        access: "old-access",
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
      {
        proxyUrl: "https://proxy.example/proxy",
      },
    );
    expect(setProviderKey).toHaveBeenCalledTimes(1);
    expect(setProviderKey.mock.calls[0]?.[0]).toBe("openai-codex");
    expect(JSON.parse(String(setProviderKey.mock.calls[0]?.[1]))).toMatchObject({
      access: "next-access",
      accountId: "acct-1",
      expires: expect.any(Number),
      providerId: "openai-codex",
      refresh: "next-refresh",
    });
  });

  it("serializes concurrent oauth refreshes for the same provider", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key");
    getProxyConfig.mockResolvedValue({
      enabled: false,
      url: "https://proxy.example/proxy",
    });
    let resolveRefresh: (() => void) | undefined;
    oauthRefresh.mockImplementation(
      async () =>
        await new Promise((resolve) => {
          resolveRefresh = () =>
            resolve({
              access: "next-access",
              accountId: "acct-1",
              expires: Date.now() + 120_000,
              providerId: "openai-codex",
              refresh: "next-refresh",
            });
        }),
    );
    const storedValue = JSON.stringify({
      access: "old-access",
      accountId: "acct-1",
      expires: Date.now() - 1,
      providerId: "openai-codex",
      refresh: "old-refresh",
    });

    const first = resolveStoredApiKey(storedValue, "openai-codex");
    const second = resolveStoredApiKey(storedValue, "openai-codex");

    await vi.waitFor(() => expect(oauthRefresh).toHaveBeenCalledTimes(1));
    resolveRefresh?.();

    await expect(Promise.all([first, second])).resolves.toEqual(["next-access", "next-access"]);
    expect(oauthRefresh).toHaveBeenCalledTimes(1);
    expect(setProviderKey).toHaveBeenCalledTimes(1);
  });

  it("passes a proxy url when oauth refresh is enabled", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key");
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    });
    oauthRefresh.mockResolvedValue({
      access: "next-access",
      accountId: "acct-1",
      expires: Date.now() + 120_000,
      providerId: "openai-codex",
      refresh: "next-refresh",
    });

    await resolveStoredApiKey(
      JSON.stringify({
        access: "old-access",
        accountId: "acct-1",
        expires: Date.now() - 1,
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
      "openai-codex",
    );

    expect(oauthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
      {
        proxyUrl: "https://proxy.example/proxy",
      },
    );
  });

  it("keeps oauth refresh direct when proxy is disabled", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key");
    getProxyConfig.mockResolvedValue({
      enabled: false,
      url: "https://proxy.example/proxy",
    });
    oauthRefresh.mockResolvedValue({
      access: "next-access",
      accountId: "acct-1",
      expires: Date.now() + 120_000,
      providerId: "openai-codex",
      refresh: "next-refresh",
    });

    await resolveStoredApiKey(
      JSON.stringify({
        access: "old-access",
        accountId: "acct-1",
        expires: Date.now() - 1,
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
      "openai-codex",
    );

    expect(oauthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
    );
  });

  it("returns undefined when no provider key is stored", async () => {
    const { resolveApiKeyForProvider } = await import("@/auth/resolve-api-key");

    await expect(resolveApiKeyForProvider("opencode")).resolves.toBeUndefined();
  });
});
