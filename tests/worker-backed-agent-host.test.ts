import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";
import { TEST_REPO_SOURCE } from "./repo-test-utils";

const workerStartTurn = vi.fn(async (_input: unknown): Promise<void> => {});
const workerWaitForTurn = vi.fn(async (_sessionId: string) => ({
  sessionId: "session-1",
  status: "completed" as const,
}));
const workerAbortTurn = vi.fn(async (_sessionId: string): Promise<void> => {});
const workerDisposeSession = vi.fn(async (_sessionId: string): Promise<void> => {});
const workerSetModelSelection = vi.fn(async (_input: unknown): Promise<void> => {});
const workerSetThinkingLevel = vi.fn(async (_input: unknown): Promise<void> => {});
const getCurrentTabId = vi.fn(() => "tab-1");

vi.mock("@/agent/runtime-worker-client", () => ({
  getRuntimeWorker: () => ({
    abortTurn: workerAbortTurn,
    disposeSession: workerDisposeSession,
    setModelSelection: workerSetModelSelection,
    setThinkingLevel: workerSetThinkingLevel,
    startTurn: workerStartTurn,
    waitForTurn: workerWaitForTurn,
  }),
}));

vi.mock("@/agent/tab-id", () => ({
  getCurrentTabId,
}));

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
    repoSource: TEST_REPO_SOURCE,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("WorkerBackedAgentHost", () => {
  beforeEach(() => {
    vi.resetModules();
    workerStartTurn.mockClear();
    workerWaitForTurn.mockClear();
    workerAbortTurn.mockClear();
    workerDisposeSession.mockClear();
    workerSetModelSelection.mockClear();
    workerSetThinkingLevel.mockClear();
    getCurrentTabId.mockClear();
  });

  it("forwards high-level startTurn commands to the worker", async () => {
    const { WorkerBackedAgentHost } = await import("@/agent/worker-backed-agent-host");
    const host = new WorkerBackedAgentHost(createSession());

    await host.startTurn("hello");
    await host.waitForTurn();

    expect(workerStartTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerTabId: "tab-1",
        session: expect.objectContaining({ id: "session-1" }),
        turn: expect.objectContaining({
          turnId: expect.any(String),
          userMessage: expect.objectContaining({
            content: "hello",
            role: "user",
          }),
        }),
      }),
    );
    expect(workerWaitForTurn).toHaveBeenCalledWith("session-1");
  });

  it("forwards worker maintenance commands", async () => {
    const { WorkerBackedAgentHost } = await import("@/agent/worker-backed-agent-host");
    const host = new WorkerBackedAgentHost(createSession());

    await host.setModelSelection("openai-codex", "gpt-5.5");
    await host.setThinkingLevel("high");
    await host.abort();
    await host.dispose();

    expect(workerSetModelSelection).toHaveBeenCalledWith({
      modelId: "gpt-5.5",
      providerGroup: "openai-codex",
      sessionId: "session-1",
    });
    expect(workerSetThinkingLevel).toHaveBeenCalledWith({
      sessionId: "session-1",
      thinkingLevel: "high",
    });
    expect(workerAbortTurn).not.toHaveBeenCalled();
    expect(workerDisposeSession).toHaveBeenCalledWith("session-1");
  });

  it("does not start a worker turn after the host is disposed mid-start", async () => {
    let resolveStart: (() => void) | undefined;
    workerStartTurn.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );

    const { WorkerBackedAgentHost } = await import("@/agent/worker-backed-agent-host");
    const host = new WorkerBackedAgentHost(createSession());

    const startPromise = host.startTurn("hello");
    await flushMicrotasks();
    const disposePromise = host.dispose();
    resolveStart?.();

    await Promise.all([startPromise, disposePromise]);

    expect(workerStartTurn).toHaveBeenCalledTimes(1);
    expect(workerAbortTurn).not.toHaveBeenCalled();
    expect(workerDisposeSession).toHaveBeenCalledWith("session-1");
  });
});
