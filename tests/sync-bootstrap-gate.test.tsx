import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";

const bootstrapDexieCloudMock = vi.fn();
const markSyncReloadPendingMock = vi.fn();
const isDbCloudConfiguredMock = vi.fn(() => false);
const isDbCloudSyncConfiguredMock = vi.fn(() => true);

vi.mock("@/lib/bootstrap-dexie-cloud", () => ({
  bootstrapDexieCloud: bootstrapDexieCloudMock,
  markSyncReloadPending: markSyncReloadPendingMock,
}));

vi.mock("@gitinspect/db", () => ({
  isDbCloudConfigured: isDbCloudConfiguredMock,
  isDbCloudSyncConfigured: isDbCloudSyncConfiguredMock,
}));

vi.mock("@gitinspect/env/web", () => ({
  env: {
    VITE_DEXIE_CLOUD_DB_URL: "https://dexie.example",
  },
}));

describe("SyncBootstrapGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDbCloudConfiguredMock.mockReturnValue(false);
    isDbCloudSyncConfiguredMock.mockReturnValue(true);
  });

  it("renders the app even if bootstrap throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    bootstrapDexieCloudMock.mockRejectedValueOnce(new Error("sync failed"));

    const { SyncBootstrapGate } = await import("../apps/web/src/components/sync-bootstrap-gate");

    render(
      <SyncBootstrapGate syncEnabled>
        <div>app ready</div>
      </SyncBootstrapGate>,
    );

    expect(screen.getByText("Preparing workspace...")).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByText("app ready")).not.toBeNull();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith("Could not prepare workspace", expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it("boots local-only mode before rendering free users", async () => {
    bootstrapDexieCloudMock.mockResolvedValueOnce(false);

    const { SyncBootstrapGate } = await import("../apps/web/src/components/sync-bootstrap-gate");

    render(
      <SyncBootstrapGate syncEnabled={false}>
        <div>local app ready</div>
      </SyncBootstrapGate>,
    );

    await waitFor(() => {
      expect(screen.getByText("local app ready")).not.toBeNull();
    });

    expect(bootstrapDexieCloudMock).toHaveBeenCalledWith(false);
  });

  it("reloads when the desired sync mode changes after the db is already configured", async () => {
    isDbCloudConfiguredMock.mockReturnValue(true);
    isDbCloudSyncConfiguredMock.mockReturnValue(false);
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        reload: reloadSpy,
      },
    });

    const { SyncBootstrapGate } = await import("../apps/web/src/components/sync-bootstrap-gate");

    render(
      <SyncBootstrapGate syncEnabled>
        <div>app ready</div>
      </SyncBootstrapGate>,
    );

    await waitFor(() => {
      expect(markSyncReloadPendingMock).toHaveBeenCalledTimes(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    expect(bootstrapDexieCloudMock).not.toHaveBeenCalled();
  });
});
