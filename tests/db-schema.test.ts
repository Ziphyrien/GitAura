import Dexie from "dexie"
import { describe, expect, it } from "vitest"
import { AppDb } from "@/db/schema"
import { createEmptyUsage } from "@/types/models"
import {
  getCostsByModelFromAggregates,
  getCostsByProviderFromAggregates,
  getTotalCostFromAggregates,
  mergeDailyCostAggregate,
} from "@/db/schema"

describe("db schema helpers", () => {
  it("merges daily cost aggregates by provider and model", () => {
    const usage = createEmptyUsage()
    usage.cost.total = 1.25

    expect(
      mergeDailyCostAggregate(undefined, usage, "openai-codex", "gpt-5.1", "2026-03-23")
    ).toEqual({
      byProvider: {
        "openai-codex": {
          "gpt-5.1": 1.25,
        },
      },
      date: "2026-03-23",
      total: 1.25,
    })
  })

  it("exposes total, provider, and model cost queries", () => {
    const dailyCosts = [
      {
        byProvider: {
          anthropic: {
            "claude-sonnet-4-6": 2,
          },
          "openai-codex": {
            "gpt-5.1": 3,
          },
        },
        date: "2026-03-23",
        total: 5,
      },
    ]

    expect(getTotalCostFromAggregates(dailyCosts)).toBe(5)
    expect(getCostsByProviderFromAggregates(dailyCosts)).toMatchObject({
      anthropic: 2,
      "openai-codex": 3,
    })
    expect(getCostsByModelFromAggregates(dailyCosts)).toMatchObject({
      "claude-sonnet-4-6": 2,
      "gpt-5.1": 3,
    })
  })

  it("migrates repository rows missing refOrigin", async () => {
    const name = `gitinspect-migration-${Date.now()}`
    const legacyDb = new Dexie(name)

    legacyDb.version(2).stores({
      daily_costs: "date",
      messages:
        "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      session_leases: "sessionId, ownerTabId, heartbeatAt",
      session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    })

    await legacyDb.open()
    await legacyDb.table("repositories").put({
      lastOpenedAt: "2026-03-24T12:00:00.000Z",
      owner: "acme",
      ref: "main",
      repo: "demo",
    })
    legacyDb.close()

    const migratedDb = new AppDb(name)
    await migratedDb.open()

    expect(await migratedDb.repositories.toArray()).toEqual([
      {
        lastOpenedAt: "2026-03-24T12:00:00.000Z",
        owner: "acme",
        ref: "main",
        refOrigin: "explicit",
        repo: "demo",
      },
    ])

    migratedDb.close()
    await Dexie.delete(name)
  })
})
