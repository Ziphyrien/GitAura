import { beforeEach, describe, expect, it, vi } from "vitest";

const betterAuth = vi.fn(() => ({
  api: {},
  handler: vi.fn(),
}));
const tanstackStartCookies = vi.fn(() => ({ id: "tanstack-start-cookies" }));

vi.mock("@gitinspect/env/server", () => ({
  env: {
    BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    BETTER_AUTH_URL: "https://gitinspect.com",
    CORS_ORIGIN: "https://gitinspect.com",
    GITHUB_CLIENT_ID: "github-client-id",
    GITHUB_CLIENT_SECRET: "github-client-secret",
  },
}));

vi.mock("better-auth", () => ({
  betterAuth,
}));

vi.mock("better-auth/tanstack-start", () => ({
  tanstackStartCookies,
}));

describe("auth config", () => {
  beforeEach(() => {
    vi.resetModules();
    betterAuth.mockClear();
    tanstackStartCookies.mockClear();
  });

  it("aligns stateless cookie cache lifetime with the product session lifetime", async () => {
    await import("../packages/auth/src/index.ts");

    expect(tanstackStartCookies).toHaveBeenCalledTimes(1);
    expect(betterAuth).toHaveBeenCalledTimes(1);
    expect(betterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://gitinspect.com",
        secret: "12345678901234567890123456789012",
        session: expect.objectContaining({
          expiresIn: 60 * 60 * 24 * 30,
          updateAge: 60 * 60 * 24,
          cookieCache: {
            enabled: true,
            maxAge: 60 * 60 * 24 * 30,
            refreshCache: true,
            strategy: "jwe",
          },
        }),
        trustedOrigins: ["https://gitinspect.com"],
      }),
    );
  });
});
