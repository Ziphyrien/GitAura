import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@/db/schema"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

const resolveRepoTargetMock = vi.fn()

vi.mock("@/repo/ref-resolver", () => ({
  resolveRepoTarget: (target: {
    owner: string
    ref?: string
    refPathTail?: string
    repo: string
    token?: string
  }) => resolveRepoTargetMock(target),
}))

function buildLegacySession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-legacy",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: {
      owner: "acme",
      ref: "main",
      refOrigin: "explicit",
      repo: "demo",
    } as SessionData["repoSource"],
    thinkingLevel: "medium",
    title: "Legacy chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

describe("session-service", () => {
  beforeEach(async () => {
    resolveRepoTargetMock.mockReset()
    await db.messages.clear()
    await db.sessions.clear()
  })

  it("repairs old session rows that are missing resolved refs", async () => {
    const resolvedRepoSource = {
      owner: "acme",
      ref: "main",
      refOrigin: "explicit" as const,
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/main" as const,
        fullRef: "refs/heads/main" as const,
        kind: "branch" as const,
        name: "main",
      },
    }
    resolveRepoTargetMock.mockResolvedValue(resolvedRepoSource)

    await db.sessions.put(buildLegacySession())

    const { loadSession } = await import("@/sessions/session-service")
    const session = await loadSession("session-legacy")

    expect(resolveRepoTargetMock).toHaveBeenCalledWith({
      owner: "acme",
      ref: "main",
      repo: "demo",
      token: undefined,
    })
    expect(session?.repoSource).toEqual(resolvedRepoSource)

    const persisted = await db.sessions.get("session-legacy")
    expect(persisted?.repoSource).toEqual(resolvedRepoSource)
  })
})
