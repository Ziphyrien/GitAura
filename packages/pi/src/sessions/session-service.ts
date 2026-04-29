import {
  getMostRecentSession,
  getSession,
  getSessionMessages,
  getSessionRuntime,
  putSession,
} from "@webaura/db";
import { loadSessionLeaseState } from "@webaura/db/session-leases";
import { normalizeSessionRuntime } from "@webaura/db/session-runtime";
import { getIsoNow } from "@webaura/pi/lib/dates";
import { createId } from "@webaura/pi/lib/ids";
import { getCanonicalProvider } from "@webaura/pi/models/catalog";
import {
  normalizePersistedSessionState,
  normalizeSessionProviderGroup,
} from "@webaura/pi/sessions/session-state-normalization";
import {
  createEmptyUsage,
  type ProviderGroupId,
  type ThinkingLevel,
} from "@webaura/pi/types/models";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@webaura/db";

export {
  aggregateSessionUsage,
  buildPersistedSession,
  normalizeSessionProviderGroup,
  shouldSaveSession,
} from "@webaura/pi/sessions/session-state-normalization";

export function createSession(params: {
  model: string;
  providerGroup: ProviderGroupId;
  thinkingLevel?: ThinkingLevel;
}): SessionData {
  const now = getIsoNow();
  const provider = getCanonicalProvider(params.providerGroup);

  return {
    cost: 0,
    createdAt: now,
    error: undefined,
    id: createId(),
    isStreaming: false,
    messageCount: 0,
    model: params.model,
    preview: "",
    provider,
    providerGroup: params.providerGroup,
    thinkingLevel: params.thinkingLevel ?? "medium",
    title: "New chat",
    updatedAt: now,
    usage: createEmptyUsage(),
  };
}

export async function persistSession(session: SessionData): Promise<void> {
  await putSession(normalizeSessionProviderGroup(session));
}

export async function persistSessionSnapshot(session: SessionData): Promise<void> {
  await persistSession(session);
}

export async function loadSession(id: string): Promise<SessionData | undefined> {
  const session = await getSession(id);
  return session ? normalizeSessionProviderGroup(session) : undefined;
}

export async function loadMostRecentSession(): Promise<SessionData | undefined> {
  const session = await getMostRecentSession();
  return session ? normalizeSessionProviderGroup(session) : undefined;
}

export async function loadSessionWithMessages(
  id: string,
): Promise<
  { messages: MessageRow[]; runtime?: SessionRuntimeRow; session: SessionData } | undefined
> {
  const [session, messages, runtime] = await Promise.all([
    loadSession(id),
    getSessionMessages(id),
    getSessionRuntime(id),
  ]);

  if (!session) {
    return undefined;
  }

  const normalizedRuntime = normalizeSessionRuntime(id, runtime);
  const leaseState = await loadSessionLeaseState(id);
  const hasLiveLease = leaseState.kind === "locked" || leaseState.kind === "owned";

  return normalizePersistedSessionState({
    messages,
    options: {
      allowInterruptedHydration: normalizedRuntime?.phase !== "running" && !hasLiveLease,
    },
    runtime,
    session,
  });
}
