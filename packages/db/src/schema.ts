import Dexie from "dexie";

export const DB_NAME = "webaura-store";

export function registerAppDbSchema(db: Dexie): void {
  db.version(10).stores({
    daily_costs: "date",
    messages:
      "id, sessionId, [sessionId+order], [sessionId+timestamp], [sessionId+status], order, timestamp, status",
    "provider-keys": "provider, updatedAt",
    session_leases: "sessionId, ownerTabId, heartbeatAt",
    session_runtime: "sessionId, phase, status, ownerTabId, lastProgressAt, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
  });
}
