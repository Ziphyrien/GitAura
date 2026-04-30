import { describe, expect, it } from "vite-plus/test";
import { normalizePersistedSessionState } from "@/sessions/session-state-normalization";
import type { SessionData } from "@/types/storage";

function createSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.4",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: {
      totalTokens: 0,
      output: 0,
      input: 0,
      cost: {
        total: 0,
        output: 0,
        input: 0,
        cacheWrite: 0,
        cacheRead: 0,
      },
      cacheWrite: 0,
      cacheRead: 0,
    },
  };
}

describe("normalizePersistedSessionState", () => {
  it("does not mark semantically equal sessions changed when object keys differ", () => {
    const result = normalizePersistedSessionState({
      messages: [],
      runtime: undefined,
      session: createSession(),
    });

    expect(result.changed).toBe(false);
  });
});
