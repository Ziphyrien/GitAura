import { MissingSessionRuntimeError } from "@webaura/pi/agent/runtime-command-errors";
import { SessionWorkerCoordinator } from "@webaura/pi/agent/session-worker-coordinator";
import type {
  AppendSessionNoticeInput,
  ConfigureSessionInput,
  ReconcileInterruptedSessionInput,
  SetThinkingLevelInput,
  StartTurnInput,
  TurnCompletionResult,
} from "@webaura/pi/agent/runtime-worker-types";
import type { SessionData } from "@webaura/db";

const COORDINATOR_STALE_MS = 20 * 60_000;

const coordinators = new Map<string, SessionWorkerCoordinator>();
const coordinatorLoads = new Map<string, Promise<SessionWorkerCoordinator | undefined>>();

function logCoordinatorDisposeError(sessionId: string, error: unknown): void {
  console.error(`Failed to dispose runtime coordinator for session ${sessionId}`, error);
}

function disposeCoordinatorInBackground(
  sessionId: string,
  coordinator: SessionWorkerCoordinator,
): void {
  if (coordinators.get(sessionId) !== coordinator) {
    return;
  }

  coordinators.delete(sessionId);
  void coordinator.dispose().catch((error) => {
    logCoordinatorDisposeError(sessionId, error);
  });
}

function disposeStaleCoordinators(now = Date.now()): void {
  for (const [sessionId, coordinator] of coordinators) {
    if (coordinator.isStale(now, COORDINATOR_STALE_MS)) {
      disposeCoordinatorInBackground(sessionId, coordinator);
    }
  }
}

function createCoordinatorLoad(params: {
  sessionId: string;
  fallbackSession?: SessionData;
}): Promise<SessionWorkerCoordinator | undefined> {
  const loadPromise = loadCoordinator(params).finally(() => {
    if (coordinatorLoads.get(params.sessionId) === loadPromise) {
      coordinatorLoads.delete(params.sessionId);
    }
  });
  coordinatorLoads.set(params.sessionId, loadPromise);
  return loadPromise;
}

async function loadCoordinator(params: {
  sessionId: string;
  fallbackSession?: SessionData;
}): Promise<SessionWorkerCoordinator | undefined> {
  const coordinator = await SessionWorkerCoordinator.load({
    fallbackSession: params.fallbackSession,
    sessionId: params.sessionId,
  });

  if (coordinator) {
    coordinators.set(params.sessionId, coordinator);
  }

  return coordinator;
}

async function getOrCreateCoordinator(
  sessionId: string,
  options?: { fallbackSession?: SessionData },
): Promise<SessionWorkerCoordinator | undefined> {
  disposeStaleCoordinators();
  const existing = coordinators.get(sessionId);

  if (existing) {
    return existing;
  }

  let loadPromise = coordinatorLoads.get(sessionId);

  if (!loadPromise) {
    loadPromise = createCoordinatorLoad({
      fallbackSession: options?.fallbackSession,
      sessionId,
    });
  }

  const loaded = await loadPromise;

  if (loaded || !options?.fallbackSession) {
    return loaded;
  }

  const loadedAfterWait = coordinators.get(sessionId);

  if (loadedAfterWait) {
    return loadedAfterWait;
  }

  const retryPromise =
    coordinatorLoads.get(sessionId) ??
    createCoordinatorLoad({
      fallbackSession: options.fallbackSession,
      sessionId,
    });
  return await retryPromise;
}

async function getLoadedCoordinator(
  sessionId: string,
): Promise<SessionWorkerCoordinator | undefined> {
  disposeStaleCoordinators();
  const existing = coordinators.get(sessionId);

  if (existing) {
    return existing;
  }

  const pending = coordinatorLoads.get(sessionId);
  return pending ? await pending : undefined;
}

async function disposeIdleCoordinator(
  sessionId: string,
  coordinator: SessionWorkerCoordinator | undefined,
): Promise<void> {
  if (!coordinator || coordinators.get(sessionId) !== coordinator) {
    return;
  }

  if (!coordinator.isIdle()) {
    if (coordinator.isStale(Date.now(), COORDINATOR_STALE_MS)) {
      disposeCoordinatorInBackground(sessionId, coordinator);
    }
    return;
  }

  try {
    await coordinator.dispose();
  } catch (error) {
    logCoordinatorDisposeError(sessionId, error);
  } finally {
    if (coordinators.get(sessionId) === coordinator) {
      coordinators.delete(sessionId);
    }
  }
}

export async function startTurn(input: StartTurnInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.session.id, {
    fallbackSession: input.session,
  });

  if (!coordinator) {
    throw new MissingSessionRuntimeError(input.session.id);
  }

  await coordinator.startTurn(input);
}

export async function waitForTurn(sessionId: string): Promise<TurnCompletionResult | undefined> {
  return await (await getLoadedCoordinator(sessionId))?.waitForTurn();
}

export async function abortTurn(sessionId: string): Promise<void> {
  await (await getLoadedCoordinator(sessionId))?.abortTurn();
}

export async function disposeSession(sessionId: string): Promise<void> {
  const coordinator = await getLoadedCoordinator(sessionId);

  if (!coordinator) {
    return;
  }

  try {
    await coordinator.dispose();
  } catch (error) {
    logCoordinatorDisposeError(sessionId, error);
  } finally {
    if (coordinators.get(sessionId) === coordinator) {
      coordinators.delete(sessionId);
    }
  }
}

export async function setModelSelection(input: ConfigureSessionInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.setModelSelection(input);
  await disposeIdleCoordinator(input.sessionId, coordinator);
}

export async function setThinkingLevel(input: SetThinkingLevelInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.setThinkingLevel(input);
  await disposeIdleCoordinator(input.sessionId, coordinator);
}

export async function appendSessionNotice(input: AppendSessionNoticeInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.appendSessionNotice(new Error(input.error));
  await disposeIdleCoordinator(input.sessionId, coordinator);
}

export async function reconcileInterruptedSession(
  input: ReconcileInterruptedSessionInput,
): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.reconcileInterruptedSession(input);
  await disposeIdleCoordinator(input.sessionId, coordinator);
}
