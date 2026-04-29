import Dexie, { type EntityTable } from "dexie";
import dexieCloud, { type DexieCloudTable } from "dexie-cloud-addon";
import { DB_NAME, registerAppDbSchema } from "./schema";
import type {
  DailyCostAggregate,
  ProviderKeyRecord,
  SessionLeaseRow,
  SessionRuntimeRow,
  SettingsRow,
  SyncedMessageRow,
  SyncedSessionRow,
} from "./types";

export class AppDb extends Dexie {
  dailyCosts!: EntityTable<DailyCostAggregate, "date">;
  messages!: DexieCloudTable<SyncedMessageRow, "id">;
  providerKeys!: EntityTable<ProviderKeyRecord, "provider">;
  sessionLeases!: EntityTable<SessionLeaseRow, "sessionId">;
  sessionRuntime!: EntityTable<SessionRuntimeRow, "sessionId">;
  sessions!: DexieCloudTable<SyncedSessionRow, "id">;
  settings!: EntityTable<SettingsRow, "key">;

  constructor(name = DB_NAME) {
    super(name, { addons: [dexieCloud] });

    registerAppDbSchema(this);

    this.dailyCosts = this.table("daily_costs");
    this.messages = this.table("messages");
    this.providerKeys = this.table("provider-keys");
    this.sessionLeases = this.table("session_leases");
    this.sessionRuntime = this.table("session_runtime");
    this.sessions = this.table("sessions");
    this.settings = this.table("settings");
  }
}

export const db = new AppDb();
