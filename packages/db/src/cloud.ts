import type { DexieCloudOptions, DexieCloudSyncOptions } from "dexie-cloud-addon";
import { db } from "./db";

export const DB_CLOUD_UNSYNCED_TABLES = [
  "provider-keys",
  "settings",
  "daily_costs",
  "session_runtime",
  "session_leases",
] as const;

export type DbCloudMode = "local-only" | "sync" | "unconfigured";

let cloudMode: DbCloudMode = "unconfigured";

export type InitDbCloudInput = {
  databaseUrl?: string;
  fetchTokens: NonNullable<DexieCloudOptions["fetchTokens"]>;
};

export function initDbCloud(input: InitDbCloudInput): DbCloudMode {
  if (cloudMode !== "unconfigured") {
    return cloudMode;
  }

  const options: Omit<DexieCloudOptions, "databaseUrl"> & {
    databaseUrl?: DexieCloudOptions["databaseUrl"];
  } = {
    fetchTokens: input.fetchTokens,
    nameSuffix: false,
    requireAuth: true,
    unsyncedTables: [...DB_CLOUD_UNSYNCED_TABLES],
  };

  if (input.databaseUrl) {
    options.databaseUrl = input.databaseUrl;
  }

  db.cloud.configure(options as DexieCloudOptions);

  cloudMode = input.databaseUrl ? "sync" : "local-only";
  return cloudMode;
}

export function getDbCloudMode(): DbCloudMode {
  return cloudMode;
}

export function isDbCloudConfigured(): boolean {
  return cloudMode !== "unconfigured";
}

export function isDbCloudSyncConfigured(): boolean {
  return cloudMode === "sync";
}

const TABLES_REQUIRING_UNDELETE = ["publicSessions", "publicMessages"] as const;

function clearStaleDeletedFlags(): void {
  const schema = db.cloud.schema;
  if (!schema) return;
  for (const table of TABLES_REQUIRING_UNDELETE) {
    if (schema[table]?.deleted) {
      delete schema[table].deleted;
    }
  }
}

export async function syncDb(options?: Partial<DexieCloudSyncOptions>): Promise<void> {
  if (!isDbCloudSyncConfigured()) {
    return;
  }

  clearStaleDeletedFlags();

  await db.cloud.sync({
    purpose: options?.purpose ?? "pull",
    wait: options?.wait ?? true,
  });
}
