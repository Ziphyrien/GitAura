import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const initDbCloudMock = vi.fn();
const isDbCloudConfiguredMock = vi.fn(() => false);
const syncDbMock = vi.fn();

vi.mock("@gitinspect/db", () => ({
  initDbCloud: initDbCloudMock,
  isDbCloudConfigured: isDbCloudConfiguredMock,
  syncDb: syncDbMock,
}));

vi.mock("@gitinspect/env/web", () => ({
  env: {
    VITE_DEXIE_CLOUD_DB_URL: "https://dexie.example",
  },
}));

vi.mock("@/lib/fetch-dexie-cloud-tokens", () => ({
  fetchDexieCloudTokens: vi.fn(),
}));

function createDeferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve: () => resolve?.(),
  };
}

describe("bootstrapDexieCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDbCloudConfiguredMock.mockReturnValue(false);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(),
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
    });
  });

  it("configures local-only cloud tables for free users", async () => {
    const { bootstrapDexieCloud } = await import("../apps/web/src/lib/bootstrap-dexie-cloud");

    await expect(bootstrapDexieCloud(false)).resolves.toBe(false);

    expect(initDbCloudMock).toHaveBeenCalledWith({
      databaseUrl: undefined,
      fetchTokens: expect.any(Function),
    });
    expect(syncDbMock).not.toHaveBeenCalled();
  });

  it("starts sync in the background without blocking bootstrap for paid users", async () => {
    const syncDeferred = createDeferred();
    syncDbMock.mockImplementation(() => syncDeferred.promise);

    const { bootstrapDexieCloud } = await import("../apps/web/src/lib/bootstrap-dexie-cloud");

    await expect(bootstrapDexieCloud(true)).resolves.toBe(true);

    expect(initDbCloudMock).toHaveBeenCalledWith({
      databaseUrl: "https://dexie.example",
      fetchTokens: expect.any(Function),
    });
    expect(syncDbMock).toHaveBeenCalledWith({ wait: false });

    syncDeferred.resolve();
    await syncDeferred.promise;
  });
});
