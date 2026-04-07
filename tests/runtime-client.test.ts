import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRunner } from "@/agent/session-runner";
import type { SessionData, SessionLeaseRow } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";

const claimSessionLease = vi.fn(
  async (_sessionId: string): Promise<{ kind: "owned"; lease: SessionLeaseRow }> => ({
    kind: "owned",
    lease: {
      acquiredAt: "2026-03-24T12:00:00.000Z",
      heartbeatAt: "2026-03-24T12:00:00.000Z",
      ownerTabId: "tab-1",
      ownerToken: "lease-1",
      sessionId: "session-1",
    },
  }),
);
const loadSessionLeaseState = vi.fn(async () => ({ kind: "none" as const }));
const releaseOwnedSessionLeases = vi.fn(async () => {});
const releaseSessionLease = vi.fn(async () => {});
const renewSessionLease = vi.fn(async () => undefined);
const loadSession = vi.fn(
  async (_sessionId: string): Promise<SessionData | undefined> => createSession(),
);
const loadSessionViewModel = vi.fn(async () => ({
  displayMessages: [],
  hasPartialAssistantText: false,
  isStreaming: false,
  runtime: undefined,
  session: createSession(),
  transcriptMessages: [],
}));
const reconcileInterruptedSession = vi.fn(async () => {});

type RunnerHarness = {
  resolveWait: () => void;
  runner: SessionRunner;
  startTurn: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>;
  waitForTurn: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

let currentHarness: RunnerHarness | undefined;

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
    usage: createEmptyUsage(),
  };
}

function createRunnerHarness(): RunnerHarness {
  let resolveWait = () => {};
  const waitPromise = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const startTurn = vi.fn(async (_content: string) => {});
  const waitForTurn = vi.fn(async () => {
    await waitPromise;
  });
  const runner: SessionRunner = {
    abort: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    isBusy: vi.fn(() => false),
    setModelSelection: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(async () => {}),
    startTurn,
    waitForTurn,
  };

  return {
    resolveWait,
    runner,
    startTurn,
    waitForTurn,
  };
}

const WorkerBackedAgentHost = vi.fn(function WorkerBackedAgentHostMock(
  _session: SessionData,
): SessionRunner {
  currentHarness = createRunnerHarness();
  return currentHarness.runner;
});

vi.mock("@/agent/runtime-flags", () => ({
  ENABLE_RUNTIME_WORKER: true,
}));

vi.mock("@/agent/worker-backed-agent-host", () => ({
  WorkerBackedAgentHost,
}));

vi.mock("@/db/session-leases", () => ({
  LEASE_HEARTBEAT_MS: 5_000,
  claimSessionLease,
  loadSessionLeaseState,
  releaseOwnedSessionLeases,
  releaseSessionLease,
  renewSessionLease,
}));

vi.mock("@/repo/github-token", () => ({
  getGithubPersonalAccessToken: vi.fn(async () => undefined),
}));

vi.mock("@/sessions/session-service", () => ({
  loadSession,
}));

vi.mock("@/sessions/session-view-model", () => ({
  loadSessionViewModel,
}));

vi.mock("@/sessions/session-notices", () => ({
  reconcileInterruptedSession,
}));

vi.mock("@/sessions/session-view-state", () => ({
  deriveActiveSessionViewState: vi.fn(() => ({ kind: "idle" as const })),
  deriveRecoveryIntent: vi.fn(() => "none" as const),
}));

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushAsyncWork(): Promise<void> {
  await flushMicrotasks();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await flushMicrotasks();
}

describe("RuntimeClient", () => {
  beforeEach(() => {
    vi.resetModules();
    claimSessionLease.mockClear();
    loadSessionLeaseState.mockClear();
    releaseOwnedSessionLeases.mockClear();
    releaseSessionLease.mockClear();
    renewSessionLease.mockClear();
    loadSession.mockClear();
    loadSessionViewModel.mockClear();
    reconcileInterruptedSession.mockClear();
    WorkerBackedAgentHost.mockClear();
    currentHarness = undefined;
  });

  it("registers freeze listeners during construction", async () => {
    const windowSpy = vi.spyOn(window, "addEventListener");
    const documentSpy = vi.spyOn(document, "addEventListener");
    const { RuntimeClient } = await import("@/agent/runtime-client");

    new RuntimeClient();

    expect(windowSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(windowSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(documentSpy).toHaveBeenCalledWith("freeze", expect.any(Function));
  });

  it("forwards active-session model changes to the worker-backed runner", async () => {
    const { RuntimeClient } = await import("@/agent/runtime-client");
    const client = new RuntimeClient();

    await client.startTurn("session-1", "hello");
    await client.setModelSelection("session-1", "openai-codex", "gpt-5.4");

    expect(WorkerBackedAgentHost).toHaveBeenCalledTimes(1);
    expect(currentHarness?.startTurn).toHaveBeenCalledWith("hello");
    expect(currentHarness?.runner.setModelSelection).toHaveBeenCalledWith(
      "openai-codex",
      "gpt-5.4",
    );

    currentHarness?.resolveWait();
    await flushMicrotasks();
  });

  it("disposes worker-backed runners on releaseAll and on turn completion", async () => {
    const { RuntimeClient } = await import("@/agent/runtime-client");
    const client = new RuntimeClient();

    await client.startTurn("session-1", "hello");
    await client.releaseAll();

    expect(currentHarness?.runner.dispose).toHaveBeenCalledTimes(1);
    expect(releaseOwnedSessionLeases).toHaveBeenCalledTimes(1);

    currentHarness?.resolveWait();
    await flushMicrotasks();

    releaseSessionLease.mockClear();
    await client.startTurn("session-1", "hello again");

    currentHarness?.resolveWait();
    await flushMicrotasks();

    await flushAsyncWork();
    expect(releaseSessionLease).toHaveBeenCalledWith("session-1");
  });
});
