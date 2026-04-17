import { initDbCloud, isDbCloudConfigured, syncDb } from "@gitinspect/db";
import { env } from "@gitinspect/env/web";
import { fetchDexieCloudTokens } from "@/lib/fetch-dexie-cloud-tokens";

const SYNC_BOOT_ERROR_MESSAGE = "Could not initialize Dexie sync";

export const SYNC_PENDING_RELOAD_STORAGE_KEY = "gitinspect.sync.pendingReload";

export function markSyncReloadPending(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SYNC_PENDING_RELOAD_STORAGE_KEY, "true");
}

export function clearSyncReloadPending(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SYNC_PENDING_RELOAD_STORAGE_KEY);
}

export async function bootstrapDexieCloud(syncEnabled: boolean): Promise<boolean> {
  const databaseUrl = syncEnabled ? env.VITE_DEXIE_CLOUD_DB_URL : undefined;

  if (!isDbCloudConfigured()) {
    initDbCloud({
      databaseUrl,
      fetchTokens: fetchDexieCloudTokens,
    });
  }

  if (syncEnabled && databaseUrl) {
    void syncDb({ wait: false }).catch((error) => {
      console.error(SYNC_BOOT_ERROR_MESSAGE, error);
    });
  }

  clearSyncReloadPending();
  return Boolean(syncEnabled && databaseUrl);
}
