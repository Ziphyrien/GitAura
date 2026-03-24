import type { Table } from "dexie"
import type Dexie from "dexie"
import type { DailyCostAggregate, ProviderKeyRecord, SessionData, SessionMetadata, SettingsRow } from "@/types/storage"

export type AppDbTables = {
  dailyCosts: Table<DailyCostAggregate, string>
  providerKeys: Table<ProviderKeyRecord, string>
  sessions: Table<SessionData, string>
  settings: Table<SettingsRow, string>
}

export function applyMigrations(db: Dexie): void {
  db.version(1).stores({
    daily_costs: "date",
    "provider-keys": "provider, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model",
    "sessions-metadata": "id, lastModified, provider, model",
    settings: "key, updatedAt",
  })
}

export function getSessionsMetadataTable(
  db: Dexie
): Table<SessionMetadata, string> {
  return db.table<SessionMetadata, string>("sessions-metadata")
}
