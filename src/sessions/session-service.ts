import { getMostRecentSession, getSession, getSessionMessages, putSession } from "@/db/schema"
import { getIsoNow } from "@/lib/dates"
import { createId } from "@/lib/ids"
import { getCanonicalProvider, getDefaultProviderGroup } from "@/models/catalog"
import {
  createBranchRepoRef,
  createCommitRepoRef,
  createTagRepoRef,
  displayResolvedRepoRef,
} from "@/repo/refs"
import { resolveRepoTarget } from "@/repo/ref-resolver"
import {
  buildPreview,
  generateTitle,
  hasPersistableExchange,
} from "@/sessions/session-metadata"
import type { ChatMessage } from "@/types/chat"
import {
  createEmptyUsage,
  type ProviderGroupId,
  type ThinkingLevel,
  type Usage,
} from "@/types/models"
import type {
  MessageRow,
  RepoRefOrigin,
  ResolvedRepoRef,
  ResolvedRepoSource,
  SessionData,
} from "@/types/storage"

type LegacyRepoSource = {
  owner?: string
  ref?: string
  refOrigin?: RepoRefOrigin
  repo?: string
  resolvedRef?: ResolvedRepoRef
  token?: string
}

type LegacySessionData = Omit<SessionData, "repoSource"> & {
  repoSource?: LegacyRepoSource
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeResolvedRepoRef(
  ref: ResolvedRepoRef | undefined
): ResolvedRepoRef | undefined {
  if (!ref) {
    return undefined
  }

  if (ref.kind === "commit") {
    const sha = trimToUndefined(ref.sha)
    return sha ? createCommitRepoRef(sha) : undefined
  }

  const name = trimToUndefined(ref.name)

  if (!name) {
    return undefined
  }

  return ref.kind === "branch"
    ? createBranchRepoRef(name)
    : createTagRepoRef(name)
}

function areResolvedRepoRefsEqual(
  left: ResolvedRepoRef | undefined,
  right: ResolvedRepoRef | undefined
): boolean {
  if (!left || !right) {
    return left === right
  }

  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === "commit" && right.kind === "commit") {
    return left.sha === right.sha
  }

  if (left.kind === "commit" || right.kind === "commit") {
    return false
  }

  return (
    left.name === right.name &&
    left.apiRef === right.apiRef &&
    left.fullRef === right.fullRef
  )
}

function areResolvedRepoSourcesEqual(
  left: ResolvedRepoSource | undefined,
  right: ResolvedRepoSource | undefined
): boolean {
  if (!left || !right) {
    return left === right
  }

  return (
    left.owner === right.owner &&
    left.repo === right.repo &&
    left.ref === right.ref &&
    left.refOrigin === right.refOrigin &&
    left.token === right.token &&
    areResolvedRepoRefsEqual(left.resolvedRef, right.resolvedRef)
  )
}

async function repairPersistedRepoSource(
  source: LegacyRepoSource | undefined
): Promise<ResolvedRepoSource | undefined> {
  if (!source) {
    return undefined
  }

  const owner = trimToUndefined(source.owner)
  const repo = trimToUndefined(source.repo)
  const ref = trimToUndefined(source.ref)
  const token = trimToUndefined(source.token)
  const resolvedRef = normalizeResolvedRepoRef(source.resolvedRef)

  if (owner && repo && ref && resolvedRef) {
    return {
      owner,
      ref: displayResolvedRepoRef(resolvedRef),
      refOrigin: source.refOrigin ?? "explicit",
      repo,
      resolvedRef,
      token,
    }
  }

  if (!owner || !repo || !ref) {
    return undefined
  }

  return await resolveRepoTarget({
    owner,
    ref,
    repo,
    token,
  })
}

async function normalizeLoadedSession(
  session: LegacySessionData
): Promise<SessionData> {
  const normalizedSession = normalizeSessionProviderGroup(session as SessionData)
  const repoSource = await repairPersistedRepoSource(session.repoSource)
  const nextSession: SessionData = {
    ...normalizedSession,
    repoSource,
  }

  const providerChanged =
    nextSession.provider !== session.provider ||
    nextSession.providerGroup !== session.providerGroup
  const repoChanged = !areResolvedRepoSourcesEqual(
    session.repoSource as ResolvedRepoSource | undefined,
    nextSession.repoSource
  )

  if (providerChanged || repoChanged) {
    await putSession(nextSession)
  }

  return nextSession
}

function mergeUsage(left: Usage, right: Usage): Usage {
  return {
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: {
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      total: left.cost.total + right.cost.total,
    },
    input: left.input + right.input,
    output: left.output + right.output,
    totalTokens: left.totalTokens + right.totalTokens,
  }
}

function toChatMessage(message: ChatMessage | MessageRow): ChatMessage {
  const { sessionId: _sessionId, status: _status, ...chatMessage } =
    message as MessageRow
  return chatMessage as ChatMessage
}

export function createSession(params: {
  model: string
  providerGroup: ProviderGroupId
  repoSource?: ResolvedRepoSource
  thinkingLevel?: ThinkingLevel
}): SessionData {
  const now = getIsoNow()
  const provider = getCanonicalProvider(params.providerGroup)

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
    repoSource: params.repoSource,
    thinkingLevel: params.thinkingLevel ?? "medium",
    title: "New chat",
    updatedAt: now,
    usage: createEmptyUsage(),
  }
}

export async function persistSession(session: SessionData): Promise<void> {
  await putSession(normalizeSessionProviderGroup(session))
}

export async function persistSessionSnapshot(
  session: SessionData
): Promise<void> {
  await persistSession(session)
}

export async function loadSession(id: string): Promise<SessionData | undefined> {
  const session = await getSession(id)
  return session ? await normalizeLoadedSession(session as LegacySessionData) : undefined
}

export async function loadMostRecentSession(): Promise<SessionData | undefined> {
  const session = await getMostRecentSession()
  return session ? await normalizeLoadedSession(session as LegacySessionData) : undefined
}

export async function loadSessionWithMessages(
  id: string
): Promise<{ messages: MessageRow[]; session: SessionData } | undefined> {
  const session = await loadSession(id)

  if (!session) {
    return undefined
  }

  return {
    messages: await getSessionMessages(id),
    session,
  }
}

export function aggregateSessionUsage(
  messages: Array<ChatMessage | MessageRow>
): Usage {
  return messages.reduce((usage, message) => {
    if (message.role !== "assistant") {
      return usage
    }

    return mergeUsage(usage, message.usage)
  }, createEmptyUsage())
}

export function buildPersistedSession(
  session: SessionData,
  messages: Array<ChatMessage | MessageRow>
): SessionData {
  const normalizedSession = normalizeSessionProviderGroup(session)
  const chatMessages = messages.map(toChatMessage)
  const usage = aggregateSessionUsage(chatMessages)

  return {
    ...normalizedSession,
    cost: usage.cost.total,
    error: normalizedSession.error,
    isStreaming: normalizedSession.isStreaming,
    messageCount: chatMessages.length,
    preview: buildPreview(chatMessages),
    repoSource: normalizedSession.repoSource,
    title: generateTitle(chatMessages),
    updatedAt: normalizedSession.updatedAt,
    usage,
  }
}

export function shouldSaveSession(
  messages: Array<ChatMessage | MessageRow>
): boolean {
  return hasPersistableExchange(messages.map(toChatMessage))
}

export function normalizeSessionProviderGroup(session: SessionData): SessionData {
  const providerGroup =
    session.providerGroup ?? getDefaultProviderGroup(session.provider)

  return {
    ...session,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  }
}
