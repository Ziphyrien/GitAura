import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const generatePKCE = vi.fn();
const generateState = vi.fn();
const openPopup = vi.fn();
const postTokenRequest = vi.fn();

vi.mock("@/auth/oauth-utils", () => ({
  generatePKCE,
  generateState,
  parseAuthorizationInput: (input: string) => {
    const url = new URL(input);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  },
  postTokenRequest,
}));

vi.mock("@/auth/popup-flow", () => ({
  openPopup,
}));

function createAccessToken(accountId: string): string {
  const payload = btoa(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  );

  return `header.${payload}.signature`;
}

function createAccessTokenWithoutAccountId(): string {
  const payload = btoa(
    JSON.stringify({
      "https://api.openai.com/auth": {},
    }),
  );

  return `header.${payload}.signature`;
}

describe("openai codex oauth", () => {
  beforeEach(() => {
    generatePKCE.mockReset();
    generateState.mockReset();
    openPopup.mockReset();
    postTokenRequest.mockReset();
  });

  it("exchanges the pasted callback URL for credentials", async () => {
    generatePKCE.mockResolvedValue({
      challenge: "challenge-1",
      verifier: "verifier-1",
    });
    generateState.mockReturnValue("state-1");
    postTokenRequest.mockResolvedValue({
      access_token: createAccessToken("acct-1"),
      expires_in: 3600,
      refresh_token: "refresh-1",
    });

    const { loginOpenAICodex } = await import("@/auth/providers/openai-codex");
    const credentials = await loginOpenAICodex("http://localhost/auth/callback", {
      onManualRedirect: async () => "http://localhost:1455/auth/callback?code=code-1&state=state-1",
      proxyUrl: "https://proxy.example/proxy",
    });

    expect(credentials).toMatchObject({
      access: expect.stringContaining("."),
      accountId: "acct-1",
      providerId: "openai-codex",
      refresh: "refresh-1",
    });
    expect(openPopup).toHaveBeenCalledWith(
      expect.stringContaining("redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback"),
    );
    expect(postTokenRequest).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/token",
      expect.objectContaining({
        code: "code-1",
        redirect_uri: "http://localhost:1455/auth/callback",
      }),
      expect.objectContaining({
        proxyUrl: "https://proxy.example/proxy",
      }),
    );
  });

  it("refreshes existing credentials", async () => {
    postTokenRequest.mockResolvedValue({
      access_token: createAccessToken("acct-2"),
      expires_in: 7200,
      refresh_token: "refresh-2",
    });

    const { refreshOpenAICodex } = await import("@/auth/providers/openai-codex");
    const credentials = await refreshOpenAICodex(
      {
        access: "old-access",
        expires: Date.now() + 1_000,
        providerId: "openai-codex",
        refresh: "old-refresh",
      },
      {
        proxyUrl: "https://proxy.example/proxy",
      },
    );

    expect(credentials).toMatchObject({
      accountId: "acct-2",
      providerId: "openai-codex",
      refresh: "refresh-2",
    });
    expect(postTokenRequest).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/token",
      expect.objectContaining({
        grant_type: "refresh_token",
        refresh_token: "old-refresh",
      }),
      {
        proxyUrl: "https://proxy.example/proxy",
      },
    );
  });

  it("rejects login tokens without an account id", async () => {
    generatePKCE.mockResolvedValue({
      challenge: "challenge-1",
      verifier: "verifier-1",
    });
    generateState.mockReturnValue("state-1");
    postTokenRequest.mockResolvedValue({
      access_token: createAccessTokenWithoutAccountId(),
      expires_in: 3600,
      refresh_token: "refresh-1",
    });

    const { loginOpenAICodex } = await import("@/auth/providers/openai-codex");

    await expect(
      loginOpenAICodex("http://localhost/auth/callback", {
        onManualRedirect: async () =>
          "http://localhost:1455/auth/callback?code=code-1&state=state-1",
      }),
    ).rejects.toThrow("Failed to extract accountId from token");
  });

  it("rejects refreshed tokens without an account id", async () => {
    postTokenRequest.mockResolvedValue({
      access_token: createAccessTokenWithoutAccountId(),
      expires_in: 7200,
      refresh_token: "refresh-2",
    });

    const { refreshOpenAICodex } = await import("@/auth/providers/openai-codex");

    await expect(
      refreshOpenAICodex({
        access: "old-access",
        expires: Date.now() + 1_000,
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
    ).rejects.toThrow("Failed to extract accountId from refreshed token");
  });
});
