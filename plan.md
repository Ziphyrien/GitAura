# Thin Comlink Runtime Worker Plan

Goal: add a `DedicatedWorker` per tab, via `Comlink`, without reintroducing worker-owned session truth, cross-tab coordination, or a new FSM.

Keep this mental model:

- main thread owns session truth
- main thread owns Dexie session/message/runtime/lease writes
- main thread owns tab identity + lease heartbeat + recovery
- worker owns agent execution only
- worker is best-effort for hidden tabs, not a correctness primitive

## Verified facts. repo truth first.

### 1. Vite already supports `ComlinkWorker`

`vite.config.ts:16-29`

```ts
const config = defineConfig({
  plugins: [
    comlink(),
    devtools(),
    nitro(),
    createTsConfigPathsPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  worker: {
    plugins: () => [createTsConfigPathsPlugin(), comlink()],
  },
})
```

Local plugin docs in `node_modules/vite-plugin-comlink/README.md` confirm the expected API:

```ts
const instance = new ComlinkWorker<typeof import("./worker")>(
  new URL("./worker", import.meta.url),
  { /* Worker options */ }
)
```

Important: do not hand-roll `wrap()` / `expose()` unless plugin behavior forces it. current stack already chose the plugin path.

### 2. Runtime authority is on main thread today

`src/agent/runtime-client.ts:57-160`

```ts
export class RuntimeClient {
  private readonly activeTurns = new Map<string, AgentHost>()
  private readonly leaseHeartbeats = new Map<
    string,
    ReturnType<typeof setInterval>
  >()

  private installListeners(): void {
    const release = () => {
      void this.releaseAll()
    }

    window.addEventListener("beforeunload", release)
    window.addEventListener("pagehide", release)
  }
}
```

This is already the right authority layer. keep it.

### 3. Lease truth depends on tab identity. cannot move this into worker.

`src/db/session-leases.ts:7-8`

```ts
export const LEASE_HEARTBEAT_MS = 5_000
export const LEASE_STALE_MS = 20_000
```

`src/agent/tab-id.ts:7-16`

```ts
export function getCurrentTabId(): string {
  if (typeof window === "undefined") {
    throw new Error("Tab identity requires a browser environment")
  }

  const existing = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY)
```

`src/db/session-runtime.ts:38-51`

```ts
export async function markTurnStarted(params: {
  assistantMessageId: string
  sessionId: string
  turnId: string
}): Promise<SessionRuntimeRow> {
  const now = getIsoNow()
  return await putRuntimeUpdate(params.sessionId, "streaming", {
    ownerTabId: getCurrentTabId(),
```

Conclusion: worker must not become the owner of lease/runtime rows. the main thread is the only place with stable tab identity.

### 4. Recovery is already UI/main-thread driven

`src/components/chat.tsx:461-479`

```ts
React.useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      return
    }

    if (!activeSession || recoveryIntent !== "run-now") {
      return
    }

    void maybeRecoverInterruptedSession("visibility")
  }

  document.addEventListener("visibilitychange", handleVisibilityChange)
```

Do not move this to worker land.

### 5. `AgentHost` currently mixes execution + persistence + recovery bookkeeping

`src/agent/agent-host.ts:97-120`

```ts
export class AgentHost {
  readonly agent: Agent

  private assignedAssistantIds = new Map<string, string>()
  private persistedMessageIds = new Set<string>()
  private recordedAssistantMessageIds = new Set<string>()
  private currentAssistantMessageId?: string
  private currentTurnId?: string
  private lastDraftAssistant?: AssistantMessage
  private lastTerminalStatus: TerminalAssistantStatus = undefined
  private disposed = false
  private promptPending = false
  private runningTurn?: Promise<void>
  private persistQueue = Promise.resolve()
  private eventQueue = Promise.resolve()
```

Persistence code is embedded in the same class:

`src/agent/agent-host.ts:690-699`

```ts
private snapshotAgentState(): AgentStateSnapshot {
  return {
    error: this.agent.state.error,
    isStreaming: this.agent.state.isStreaming,
    messages: cloneValue(this.agent.state.messages),
    streamMessage:
      this.agent.state.streamMessage === null
        ? null
        : cloneValue(this.agent.state.streamMessage),
  }
}
```

`src/agent/agent-host.ts:890-928`

```ts
private async persistStreamingProgress(
  currentAssistantRow: MessageRow | undefined,
  newlyCompletedRows: Array<MessageRow>
): Promise<void> {
  this.persistQueue = this.persistQueue.then(async () => {
    if (newlyCompletedRows.length > 0) {
      await putMessages(newlyCompletedRows)
    }

    if (currentAssistantRow) {
      await putMessage(currentAssistantRow)
    }

    await markTurnProgress({
      sessionId: this.session.id,
      turnId: this.currentTurnId,
    })
  })
}
```

This is the seam to split. do not try to lift the whole class into a worker in one move.

### 6. Existing tests already pin the persistence contract

`tests/agent-host-persistence.test.ts:304-346`

```ts
it("persists optimistic user and streaming assistant rows before completion", async () => {
  const { AgentHost } = await import("@/agent/agent-host")
  const host = new AgentHost(createSession(), [])

  await host.prompt("read the repo")

  expect(putSessionAndMessages).toHaveBeenCalledWith(
    expect.objectContaining({
      isStreaming: true,
    }),
```

Use these tests. do not throw them away.

### 7. README is stale. code wins.

`README.md:16`

```md
- **Local first** — Agent in a SharedWorker; durable state in IndexedDB.
```

Current code does not do that. trust code, not README.

## Verified facts. browser/platform truth.

External sources checked before writing this plan:

- `Comlink` official README: functions/callbacks are not structured-cloneable; use `Comlink.proxy(...)` for callbacks.
  - source: [GoogleChromeLabs/comlink README](https://github.com/GoogleChromeLabs/comlink)
- Chrome Page Lifecycle: hidden tabs can be frozen/discarded; in frozen state, timers and fetch callbacks do not run.
  - source: [Page Lifecycle API](https://developer.chrome.com/articles/page-lifecycle-api)
- MDN Page Visibility: background tabs get timer throttling; `requestAnimationFrame` stops; IndexedDB is not throttled the same way.
  - source: [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- Chrome timer throttling: hidden pages can be checked as slowly as once per second, and in some conditions once per minute.
  - source: [Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/)

Conclusion:

- `DedicatedWorker` is worth using for off-main-thread work and some hidden-tab continuity
- not a guarantee against freeze/discard
- plan must preserve interrupted-turn recovery as the hard safety net

## Architecture decision

Use:

- one `DedicatedWorker` per tab
- created lazily
- reused for all sessions in that tab
- `ComlinkWorker`, not `SharedWorker`, not `ServiceWorker`

Why:

- `SharedWorker` would reintroduce cross-tab runtime ownership. wrong direction.
- `ServiceWorker` is the wrong execution model for long-lived chat turns. browser may terminate when idle.
- per-session workers also works, but a single tab worker is lower overhead and still keeps authority on the main thread.

## Non-goals

- no worker-owned lease FSM
- no worker writes to `session_leases`
- no worker writes to `session_runtime`
- no worker writes `sessions` / `messages`
- no `BroadcastChannel`
- no `SharedWorker`
- no attempt to guarantee immortal hidden-tab execution

## Implementation shape

### High-level split

Main thread:

- claim/release lease
- heartbeat interval
- create optimistic user row + assistant placeholder
- persist progress / completion to Dexie
- drive recovery on `visibilitychange`
- own `turnId`, `assistantMessageId`, `userMessageId`

Worker:

- create `Agent`
- create repo runtime/tools
- run provider stream
- emit coarse snapshots
- keep local abort controller(s)
- keep local watchdog for "agent stopped making progress"

## Step 0. preflight spike. prove worker-safe imports.

Before the refactor, do 1 tiny spike PR or draft commit.

Target: instantiate these in a worker and make one happy-path call:

- `createRepoRuntime()` from `src/repo/repo-runtime.ts`
- `streamChatWithPiAgent()` from `src/agent/provider-stream.ts`
- `resolveApiKeyForProvider()` from `src/auth/resolve-api-key.ts`

Reason:

- `getCurrentTabId()` is not worker-safe. already known.
- repo/runtime code mostly looks worker-safe.
- auth code uses Dexie + fetch. likely okay, but validate.

One real wrinkle already found:

- `src/repo/github-fetch.ts:101-113` uses `window.location`, `history`, `PopStateEvent`
- that file is UI-only today, and not used by `createRepoRuntime()`
- keep it that way. do not import it from worker paths.

Spike snippet:

```ts
// src/agent/runtime-worker-smoke.ts
export async function smokeRepoRuntime(source: RepoSource) {
  const runtime = createRepoRuntime(source)
  const text = await runtime.fs.readFile("/README.md")
  return text.slice(0, 40)
}
```

If this spike fails because of a worker-unsafe import chain:

- first choice: fix the import boundary
- fallback: keep only provider stream in worker, repo tools on main thread via proxied callbacks

Do not guess. prove it first.

## Step 1. extract persistence engine from `AgentHost`

Create a new main-thread-only class.

Suggested file:

- `src/agent/agent-turn-persistence.ts`

Purpose:

- move all Dexie/session/message/runtime-row behavior here
- keep the exact persistence semantics currently tested in `tests/agent-host-persistence.test.ts`
- feed it snapshots from either:
  - current in-thread `AgentHost`
  - future worker-backed runner

Suggested API:

```ts
export type AgentStateSnapshot = {
  error: string | undefined
  isStreaming: boolean
  messages: AgentMessage[]
  streamMessage: AgentMessage | null
}

export type SnapshotEnvelope = {
  snapshot: AgentStateSnapshot
  terminalStatus?: "aborted" | "error"
}

export type TurnEnvelope = {
  assistantMessageId: string
  turnId: string
  userMessage: Message & { id: string }
}

export class AgentTurnPersistence {
  constructor(session: SessionData, seededMessages: MessageRow[])

  isBusy(): boolean
  async beginTurn(turn: TurnEnvelope): Promise<void>
  async applySnapshot(envelope: SnapshotEnvelope): Promise<void>
  async updateModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void>
  async updateThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void>
  async repairTurnFailure(error: Error | string): Promise<void>
  async flush(): Promise<void>
  dispose(): void
}
```

Move, mostly unchanged, from `src/agent/agent-host.ts`:

- `assignedAssistantIds`
- `persistedMessageIds`
- `recordedAssistantMessageIds`
- `currentAssistantMessageId`
- `currentTurnId`
- `lastDraftAssistant`
- `lastTerminalStatus`
- `persistQueue`
- `eventQueue`
- `snapshotAgentState()` consumers that are snapshot-only
- `buildCompletedRows()`
- `buildCurrentAssistantRow()`
- `buildCurrentRows()`
- `getNewlyCompletedRows()`
- `persistPromptStart()`
- `persistStreamingProgress()`
- `persistCurrentTurnBoundaryFromSnapshot()`
- `persistSessionBoundary()`
- `recordAssistantUsage()`

Do not move:

- actual `Agent`
- repo runtime
- provider stream
- worker/watchdog execution loop

Why this step first:

- isolates the exact logic that must remain main-thread authoritative
- derisks the worker refactor
- lets existing tests stay useful

## Step 2. keep current `AgentHost` working, but route through persistence engine

Refactor `AgentHost` to become:

- execution wrapper around `Agent`
- event producer
- user of `AgentTurnPersistence`

Target shape:

```ts
export class AgentHost {
  readonly agent: Agent
  private readonly persistence: AgentTurnPersistence

  constructor(session: SessionData, messages: MessageRow[], options?: ...) {
    this.persistence = new AgentTurnPersistence(session, messages)
    this.agent = new Agent(...)
  }
}
```

`handleEvent()` becomes thinner:

```ts
private async handleEvent(event: AgentEvent): Promise<void> {
  const snapshot = this.snapshotAgentState()
  const terminalStatus =
    !snapshot.isStreaming && this.agent.state.error
      ? (this.lastTerminalStatus ?? "error")
      : this.lastTerminalStatus

  await this.persistence.applySnapshot({
    snapshot,
    terminalStatus,
  })
}
```

End of step 2 should be zero behavior change. all tests green.

## Step 3. define the worker contract

Create:

- `src/agent/runtime-worker-types.ts`

Keep it coarse. do not tunnel raw DOM events or every token.

Suggested types:

```ts
import type { Message } from "@mariozechner/pi-ai"
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { MessageRow, SessionData } from "@/types/storage"

export type WorkerSnapshot = {
  error: string | undefined
  isStreaming: boolean
  messages: AgentMessage[]
  streamMessage: AgentMessage | null
}

export type WorkerSnapshotEnvelope = {
  sessionId: string
  snapshot: WorkerSnapshot
  terminalStatus?: "aborted" | "error"
}

export interface RuntimeWorkerEvents {
  pushSnapshot(envelope: WorkerSnapshotEnvelope): Promise<void>
}

export type StartTurnInput = {
  session: SessionData
  messages: MessageRow[]
  turn: {
    assistantMessageId: string
    turnId: string
    userMessage: Message & { id: string }
  }
  githubRuntimeToken?: string
}

export type ConfigureSessionInput = {
  sessionId: string
  providerGroup: ProviderGroupId
  modelId: string
}
```

Notes:

- include `sessionId` on every envelope. simpler debugging.
- do not pass `AbortSignal` through `Comlink`. use explicit `abortTurn(sessionId)`.
- functions in `RuntimeWorkerEvents` must cross boundary via `Comlink.proxy(...)`.

## Step 4. add the worker module

Create:

- `src/agent/runtime-worker.ts`

Pattern: module-level maps + named exports.

Why named exports:

- matches `vite-plugin-comlink` docs
- no need to hand-roll `expose()`

Suggested worker skeleton:

```ts
import { Agent } from "@mariozechner/pi-agent-core"
import type { MessageRow, SessionData } from "@/types/storage"
import { buildInitialAgentState } from "@/agent/session-adapter"
import { webMessageTransformer } from "@/agent/message-transformer"
import { streamChatWithPiAgent } from "@/agent/provider-stream"
import { createRepoRuntime } from "@/repo/repo-runtime"
import { createRepoTools } from "@/tools"
import type {
  RuntimeWorkerEvents,
  StartTurnInput,
  WorkerSnapshotEnvelope,
} from "@/agent/runtime-worker-types"

const runners = new Map<string, WorkerAgentRunner>()

export async function startTurn(
  input: StartTurnInput,
  events: RuntimeWorkerEvents
): Promise<void> {
  let runner = runners.get(input.session.id)

  if (!runner) {
    runner = new WorkerAgentRunner(input.session, input.messages, events, {
      githubRuntimeToken: input.githubRuntimeToken,
    })
    runners.set(input.session.id, runner)
  }

  await runner.startTurn(input.turn)
}

export async function abortTurn(sessionId: string): Promise<void> {
  runners.get(sessionId)?.abort()
}

export async function disposeSession(sessionId: string): Promise<void> {
  runners.get(sessionId)?.dispose()
  runners.delete(sessionId)
}
```

`WorkerAgentRunner` is roughly current `AgentHost` minus:

- Dexie session/message/runtime writes
- lease writes
- tab-id usage

Keep inside worker:

- `Agent`
- `repoRuntime`
- `getApiKey` path
- `refreshGithubToken`
- `setModelSelection`
- `setThinkingLevel`
- watchdog / abort logic
- `snapshotAgentState()`

## Step 5. buffer snapshots inside the worker

Do not send one RPC per token chunk. too chatty.

Plan:

- on every `agent.subscribe(...)` event, update `latestSnapshot`
- flush at most every `50ms`
- flush immediately on:
  - `message_end`
  - `turn_end`
  - abort
  - error

Suggested code:

```ts
class WorkerAgentRunner {
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private latestTerminalStatus: "aborted" | "error" | undefined

  private queueSnapshotFlush(force = false) {
    if (force) {
      this.flushSnapshotNow()
      return
    }

    if (this.flushTimer) {
      return
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flushSnapshotNow()
    }, 50)
  }

  private async flushSnapshotNow() {
    const envelope: WorkerSnapshotEnvelope = {
      sessionId: this.session.id,
      snapshot: this.snapshotAgentState(),
      terminalStatus: this.latestTerminalStatus,
    }

    await this.events.pushSnapshot(envelope)
  }
}
```

This is enough. do not invent stream diff protocols unless profiling proves RPC pressure is real.

## Step 6. main-thread worker client

Create:

- `src/agent/runtime-worker-client.ts`

Singleton worker. lazy init.

```ts
import * as Comlink from "comlink"
import type { RuntimeWorkerEvents } from "@/agent/runtime-worker-types"

let workerApi:
  | Comlink.Remote<typeof import("./runtime-worker")>
  | undefined

export function getRuntimeWorker() {
  workerApi ??= new ComlinkWorker<typeof import("./runtime-worker")>(
    new URL("./runtime-worker", import.meta.url),
    { name: "gitinspect-runtime-worker", type: "module" }
  )
  return workerApi
}

export function createRuntimeWorkerEvents(
  sink: RuntimeWorkerEvents
): RuntimeWorkerEvents {
  return Comlink.proxy(sink)
}
```

Reason for explicit `Comlink.proxy`:

- official Comlink docs say callbacks/functions are not structured-cloneable
- this is exactly what the sink is

## Step 7. add a worker-backed session controller on main thread

Create:

- `src/agent/worker-backed-agent-host.ts`

This is not a real host. it is a bridge. name can vary.

Suggested shape:

```ts
export class WorkerBackedAgentHost {
  private readonly persistence: AgentTurnPersistence
  private readonly worker = getRuntimeWorker()
  private readonly session: SessionData

  constructor(session: SessionData, messages: MessageRow[]) {
    this.session = session
    this.persistence = new AgentTurnPersistence(session, messages)
  }

  async startTurn(content: string): Promise<void> {
    const turn = this.persistence.createTurnEnvelope(content)
    await this.persistence.beginTurn(turn)

    await this.worker.startTurn(
      {
        session: this.session,
        messages: await this.persistence.getSeedMessages(),
        turn,
        githubRuntimeToken: await getGithubPersonalAccessToken(),
      },
      createRuntimeWorkerEvents({
        pushSnapshot: async (envelope) => {
          await this.persistence.applySnapshot({
            snapshot: envelope.snapshot,
            terminalStatus: envelope.terminalStatus,
          })
        },
      })
    )
  }

  abort() {
    return this.worker.abortTurn(this.session.id)
  }
}
```

Important detail:

- generate `turnId`, `userMessageId`, `assistantMessageId`, timestamp on main thread
- persist optimistic rows before starting the worker
- pass those IDs into the worker

Why:

- ids remain deterministic
- session history shape does not depend on worker timing
- retries/recovery stay identical

## Step 8. switch `RuntimeClient` to a host interface

Current `RuntimeClient` uses `Map<string, AgentHost>`.

`src/agent/runtime-client.ts:57-62`

```ts
private readonly activeTurns = new Map<string, AgentHost>()
private readonly leaseHeartbeats = new Map<
  string,
  ReturnType<typeof setInterval>
>()
```

Change to:

```ts
interface SessionRunner {
  isBusy(): boolean
  startTurn(content: string): Promise<void>
  waitForTurn(): Promise<void>
  abort(): void | Promise<void>
  dispose(): void | Promise<void>
  setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void>
  setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void>
  refreshGithubToken(): Promise<void>
}
```

Then:

```ts
private readonly activeTurns = new Map<string, SessionRunner>()
```

Now `RuntimeClient` can choose:

- main-thread `AgentHost` behind a feature flag at first
- worker-backed runner once stable

Suggested temporary flag:

- `src/agent/runtime-flags.ts`

```ts
export const ENABLE_RUNTIME_WORKER = true
```

Use the flag for rollout + rollback. delete later.

## Step 9. add `freeze` listener. release early, recover later.

Current `RuntimeClient.installListeners()` listens to:

- `beforeunload`
- `pagehide`

Add:

- `document.addEventListener("freeze", release)` when available

Suggested code:

```ts
private installListeners(): void {
  if (this.listenersInstalled || typeof window === "undefined") {
    return
  }

  const release = () => {
    void this.releaseAll()
  }

  window.addEventListener("beforeunload", release)
  window.addEventListener("pagehide", release)
  document.addEventListener("freeze", release as EventListener)
  this.listenersInstalled = true
}
```

Reason:

- if Chrome freezes the hidden page, release lease earlier than waiting for `LEASE_STALE_MS`
- if that event never fires in some browser, stale-lease logic still covers it
- recovery already exists on visibility/mount

Do not do anything fancy on `resume`. existing recovery path is enough.

## Step 10. model changes and token refresh

Keep these on main thread entrypoints in `RuntimeClient`:

- `setModelSelection()`
- `setThinkingLevel()`
- `refreshGithubToken()`

But implementation changes:

- if session has active worker runner, forward config change to worker
- also update `AgentTurnPersistence` session snapshot on main thread

Suggested pattern:

```ts
async setModelSelection(sessionId: string, providerGroup: ProviderGroupId, modelId: string) {
  const host = this.activeTurns.get(sessionId)

  if (host) {
    await host.setModelSelection(providerGroup, modelId)
    return
  }

  // existing persisted-session path stays unchanged
}
```

Worker side:

```ts
export async function setModelSelection(
  sessionId: string,
  providerGroup: ProviderGroupId,
  modelId: string
) {
  await runners.get(sessionId)?.setModelSelection(providerGroup, modelId)
}
```

## Step 11. test plan

### Unit tests. keep and extend.

1. Keep `tests/agent-host-persistence.test.ts`.
2. After extraction, either:
   - rename to `tests/agent-turn-persistence.test.ts`, or
   - keep old file and point it at the new persistence engine through the host wrapper.
3. Add `tests/runtime-worker-client.test.ts`:
   - worker created lazily
   - `Comlink.proxy` sink used
   - `abortTurn(sessionId)` is called, no `AbortSignal` crossing boundary
4. Add `tests/runtime-client.test.ts` or extend current runtime tests:
   - lease claim/release semantics unchanged
   - stale lock handling unchanged
   - `releaseAll()` clears worker-backed runners too
5. Add `tests/runtime-worker.test.ts`:
   - snapshot buffering coalesces high-frequency updates
   - terminal events flush immediately
   - abort emits `terminalStatus: "aborted"`

### Manual QA. browser truth, not theory.

Use Chrome desktop first.

1. Start a long response in tab A.
2. Switch away for 30s.
3. Confirm:
   - UI remains responsive on return
   - session rows persisted during stream
   - no duplicate assistant/tool rows
4. Open same session in tab B while tab A owns lease.
5. Confirm tab B still sees locked/remote state.
6. In Chrome, use `chrome://discards` to freeze tab A.
7. Confirm:
   - lease is released quickly if `freeze` fired, else within `LEASE_STALE_MS`
   - returning to tab A/B triggers interrupted-turn recovery
8. Start a turn, hide tab, then abort from UI on return.
9. Confirm `aborted` state is preserved exactly once.

Manual QA here matters. workers + hidden tab lifecycle is browser behavior, not just code behavior.

## Migration order. safest path.

PR 1:

- extract `AgentTurnPersistence`
- zero behavior change
- keep `AgentHost` on main thread

PR 2:

- add worker contract + worker spike
- no default runtime switch yet
- tests for worker client + snapshot buffering

PR 3:

- add `WorkerBackedAgentHost`
- gate with `ENABLE_RUNTIME_WORKER`
- keep fallback to old `AgentHost`

PR 4:

- switch default on
- soak
- remove old in-thread execution path if no regressions

PR 5:

- update stale docs, especially `README.md` shared-worker claim

## Detailed todo

### Phase 0. preflight + truth gathering

- [x] Confirm current branch state and preserve unrelated user changes.
- [x] Re-read `src/agent/runtime-client.ts` before coding. this remains authority.
- [x] Re-read `src/agent/agent-host.ts` and mark exact execution vs persistence seams.
- [x] Re-read `tests/agent-host-persistence.test.ts` and treat it as the persistence contract.
- [x] Re-read `src/db/session-leases.ts` and `src/db/session-runtime.ts` and keep their ownership semantics unchanged.
- [x] Verify `vite-plugin-comlink` usage against local package docs in `node_modules/vite-plugin-comlink/README.md`.
- [x] Verify `Comlink.proxy(...)` callback rules against local `comlink` docs if needed during implementation.
- [x] Decide whether to keep `type: "module"` on the worker constructor in production. current plan assumes yes.

### Phase 1. worker-safety spike

- [x] Add a temporary worker smoke file, e.g. `src/agent/runtime-worker-smoke.ts`.
- [x] In the smoke worker, instantiate `createRepoRuntime()` from `src/repo/repo-runtime.ts`.
- [x] In the smoke worker, perform one repo fs read using the runtime.
- [x] In the smoke worker, verify `resolveApiKeyForProvider()` from `src/auth/resolve-api-key.ts` can run in worker context.
- [x] In the smoke worker, verify `streamChatWithPiAgent()` imports cleanly in worker context.
- [x] Confirm no worker import path reaches `src/repo/github-fetch.ts` UI-only `window` code.
- [x] If a worker-unsafe import path appears, document the exact chain in the plan or commit message before fixing.
- [x] If needed, split DOM/UI helpers out of shared modules rather than weakening the worker boundary.
- [x] Remove the smoke-only code or convert it into a retained test helper after the spike is done.

### Phase 2. extract main-thread persistence engine

- [x] Create `src/agent/agent-turn-persistence.ts`.
- [ ] Move persistence state fields out of `AgentHost` into the new class:
  - [x] `assignedAssistantIds`
  - [x] `persistedMessageIds`
  - [x] `recordedAssistantMessageIds`
  - [x] `currentAssistantMessageId`
  - [x] `currentTurnId`
  - [x] `lastDraftAssistant`
  - [x] `lastTerminalStatus`
  - [x] `persistQueue`
  - [x] `eventQueue` if still needed on the persistence side
- [ ] Move row-building helpers into the new class:
  - [x] `buildCompletedRows()`
  - [x] `buildCurrentAssistantRow()`
  - [x] `buildCurrentRows()`
  - [x] `getNewlyCompletedRows()`
- [ ] Move persistence writers into the new class:
  - [x] `persistPromptStart()`
  - [x] `persistStreamingProgress()`
  - [x] `persistCurrentTurnBoundaryFromSnapshot()`
  - [x] `persistSessionBoundary()`
  - [x] `recordAssistantUsage()`
  - [x] repair/failure persistence path
- [x] Define stable snapshot types in the new file or a shared types file.
- [x] Add a small API for creating turn envelopes on the main thread.
- [x] Add a small API for applying snapshots from any execution source.
- [x] Keep session/message/runtime writes in the persistence class only.
- [x] Do not move `Agent`, repo runtime, or provider streaming into this class.

### Phase 3. refactor `AgentHost` to use extracted persistence

- [x] Update `src/agent/agent-host.ts` to construct `AgentTurnPersistence`.
- [x] Keep current public behavior of `AgentHost` unchanged.
- [x] Keep current `Agent` setup unchanged.
- [x] Change `startTurn()` so optimistic rows are created through persistence.
- [x] Change event handling to translate `Agent` state into snapshots and send them to persistence.
- [x] Keep abort/error/watchdog behavior unchanged while routing final state through persistence.
- [x] Keep `setModelSelection()` and `setThinkingLevel()` behavior intact.
- [x] Keep `refreshGithubToken()` behavior intact.
- [x] Remove duplicate persistence fields from `AgentHost` after the refactor is stable.
- [x] Verify `AgentHost` no longer directly writes Dexie session/message/runtime rows except via the new persistence layer.

### Phase 4. stabilize tests after persistence extraction

- [x] Run the existing persistence tests against the refactored main-thread path.
- [x] Decide whether to rename `tests/agent-host-persistence.test.ts` or keep the filename unchanged.
- [x] Add or update tests for the extracted persistence class directly if helpful.
- [ ] Ensure these behaviors remain covered:
  - [x] optimistic user + streaming assistant rows persist before completion
  - [x] completion boundary finalizes cleanly
  - [x] error repair path rewrites streaming assistant rows correctly
  - [x] orphan tool results are dropped on repair
  - [x] matching tool results survive repair
  - [x] usage is recorded once per assistant message
- [x] Ensure refactor does not break unrelated route/UI tests that mock `runtimeClient`.

### Phase 5. define worker contract

- [x] Create `src/agent/runtime-worker-types.ts`.
- [x] Add `WorkerSnapshot` type.
- [x] Add `WorkerSnapshotEnvelope` type.
- [x] Add `RuntimeWorkerEvents` callback interface.
- [x] Add `StartTurnInput` type.
- [x] Add config/update input types for model/thinking/token refresh as needed.
- [x] Keep all worker contract payloads structured-clone-safe.
- [x] Do not put `AbortSignal` in the worker contract.
- [x] Do not put Dexie row mutation commands in the worker contract.
- [x] Include `sessionId` in every event envelope for sanity/debugging.

### Phase 6. implement runtime worker module

- [x] Create `src/agent/runtime-worker.ts`.
- [x] Use named exports so the file matches `vite-plugin-comlink` expectations.
- [x] Add a module-level `Map<string, WorkerAgentRunner>`.
- [x] Implement `startTurn(...)`.
- [x] Implement `abortTurn(sessionId)`.
- [x] Implement `disposeSession(sessionId)`.
- [x] Implement `setModelSelection(sessionId, providerGroup, modelId)`.
- [x] Implement `setThinkingLevel(sessionId, thinkingLevel)`.
- [x] Implement `refreshGithubToken(sessionId, token?)`.
- [x] Keep one worker-side runner per active session inside the tab worker.
- [x] Ensure runner reuse is correct when the same session receives multiple turns over time.
- [x] Ensure disposal removes stale runners from the map.

### Phase 7. implement `WorkerAgentRunner`

- [x] Add a worker-only runner class inside `src/agent/runtime-worker.ts` or split into its own file if it grows.
- [x] Port execution-only state from `AgentHost`.
- [x] Keep `Agent` construction inside the worker.
- [x] Keep repo runtime creation inside the worker if Phase 1 proved it safe.
- [x] Keep repo tools creation inside the worker if Phase 1 proved it safe.
- [x] Keep provider stream creation inside the worker.
- [x] Keep worker-local abort controller / abort state.
- [x] Keep worker-local watchdog / progress timer.
- [x] Add `snapshotAgentState()` in the worker.
- [x] Add event subscription from `Agent`.
- [x] Remove all Dexie writes from this runner.
- [x] Remove all lease writes from this runner.
- [x] Remove all `getCurrentTabId()` / `sessionStorage` assumptions from this runner.
- [x] Ensure worker runner can be recreated from persisted session + message seed state.

### Phase 8. add snapshot buffering

- [x] Add `latestSnapshot` storage in worker runner.
- [x] Add `flushTimer`.
- [x] Add `latestTerminalStatus`.
- [x] Buffer frequent stream events.
- [x] Flush snapshots at most every `50ms` initially.
- [ ] Flush immediately on:
  - [x] `message_end`
  - [x] `turn_end`
  - [x] abort
  - [x] terminal error
- [x] Ensure final flush happens before worker runner settles/disposes.
- [x] Ensure buffered flush does not emit stale snapshots after dispose.
- [x] Add debug logging only if necessary; keep it easy to remove.

### Phase 9. add main-thread worker client

- [x] Create `src/agent/runtime-worker-client.ts`.
- [x] Add lazy singleton worker creation with `new ComlinkWorker(...)`.
- [x] Type the worker API with `typeof import("./runtime-worker")`.
- [x] Add helper to wrap event sinks with `Comlink.proxy(...)`.
- [x] Decide whether to expose a `releaseProxy`/dispose path for app shutdown.
- [x] Ensure the worker is not eagerly created on app boot.
- [x] Ensure the worker client stays browser-only and is not imported from SSR-sensitive code paths.

### Phase 10. add worker-backed main-thread runner

- [x] Create `src/agent/worker-backed-agent-host.ts`.
- [x] Make it implement the same runner interface expected by `RuntimeClient`.
- [x] Construct `AgentTurnPersistence` on the main thread.
- [x] Generate `turnId`, `userMessageId`, `assistantMessageId`, and timestamp on the main thread.
- [x] Persist optimistic rows before invoking the worker.
- [x] Pass seeded session/messages + turn envelope into worker `startTurn(...)`.
- [x] Pass proxied event sink into worker `startTurn(...)`.
- [x] On each worker snapshot, call `persistence.applySnapshot(...)`.
- [x] Implement `abort()` by forwarding to worker `abortTurn(sessionId)`.
- [x] Implement `dispose()` by forwarding to worker `disposeSession(sessionId)` and disposing main-thread persistence.
- [x] Implement `setModelSelection(...)` and `setThinkingLevel(...)`.
- [x] Implement `refreshGithubToken()` by fetching token on main thread and forwarding it to worker.
- [x] Ensure no persistence work is duplicated between the bridge and persistence class.

### Phase 11. generalize `RuntimeClient` around a runner interface

- [x] Introduce a `SessionRunner` interface in `src/agent/runtime-client.ts` or a shared file.
- [x] Change `activeTurns` map from `Map<string, AgentHost>` to `Map<string, SessionRunner>`.
- [x] Keep all lease and recovery logic in `RuntimeClient`.
- [x] Keep `claimOwnership()` behavior unchanged.
- [x] Keep `startLeaseHeartbeat()` behavior unchanged initially.
- [x] Keep `watchActiveTurn()` logic, but make it runner-interface based.
- [x] Add host/runner factory method.
- [x] Add a runtime feature flag, e.g. `src/agent/runtime-flags.ts`.
- [x] Default the flag conservatively during rollout if desired.
- [x] Keep fallback path to old in-thread `AgentHost` until worker path is proven.
- [x] Ensure `releaseSession()` works for both implementations.
- [x] Ensure `releaseAll()` disposes worker-backed runners too.
- [x] Ensure `startInitialTurn()` works for both implementations.
- [x] Ensure `resumeInterruptedTurn()` still flows through the same mutation/ownership gate.

### Phase 12. lifecycle hooks and hidden-tab behavior

- [x] Extend `RuntimeClient.installListeners()` to handle `freeze` where supported.
- [x] Keep `beforeunload` and `pagehide` listeners.
- [x] Confirm `releaseAll()` is safe to call from `freeze`.
- [x] Do not add complex `resume` logic unless tests/manual QA prove it is necessary.
- [x] Keep `src/components/chat.tsx` visibility-driven recovery behavior intact.
- [x] Consider whether `LEASE_STALE_MS` should be increased before claiming reliable hidden-tab continuity.
- [x] Decide whether stale lease timing changes belong in the same PR or a follow-up PR.
- [ ] Document the behavioral tradeoff if `LEASE_STALE_MS` is changed:
  - [x] longer background continuity
  - [x] slower failover after crash

### Phase 13. token/auth/repo-runtime details

- [x] Verify worker-side `resolveApiKeyForProvider()` refresh path is safe with Dexie from worker.
- [x] If worker-side auth refresh is unsafe or awkward, proxy auth/token lookup from main thread instead.
- [x] Verify `getGithubPersonalAccessToken()` access from worker is safe if used there directly.
- [x] Prefer main-thread token fetch + explicit worker `refreshGithubToken(...)` if that keeps boundaries cleaner.
- [x] Verify repo runtime refresh after token change works in worker without recreating unrelated state.
- [x] Verify model changes mid-session still update subsequent provider calls correctly.
- [x] Verify thinking-level changes mid-session still update subsequent provider calls correctly.

### Phase 14. tests for worker integration

- [x] Add worker client tests.
- [x] Add worker runner tests.
- [x] Add `RuntimeClient` tests for worker-backed path.
- [x] Add buffering tests for snapshot coalescing.
- [x] Add abort tests for worker-backed path.
- [x] Add disposal tests for worker-backed path.
- [x] Add hidden-route/intra-app switching tests if feasible.
- [x] Ensure existing component tests that mock `runtimeClient` still pass.
- [x] Ensure no test depends on actual browser worker execution unless deliberately written as such.

### Phase 15. manual QA

- [ ] Stream response in one session, navigate to another session inside the app, return, confirm stream continuity.
- [ ] Stream response, switch to another browser tab for a short interval, return, confirm whether stream continued.
- [ ] Repeat browser-tab switch for a longer interval, observe whether lease staleness interrupts.
- [ ] Open the same session in another browser tab while first tab is active, verify lock semantics remain correct.
- [ ] Freeze/discard the tab in Chrome via `chrome://discards`, confirm recovery path remains correct.
- [ ] Abort a running worker-backed turn, confirm assistant row status is exactly `aborted`.
- [ ] Trigger an error during a worker-backed turn, confirm repair path is identical to current behavior.
- [ ] Refresh GitHub token during an active session, confirm repo tools continue to function.
- [ ] Change model mid-session between turns, confirm next turn uses the new model.
- [ ] Observe UI responsiveness during heavy streaming compared with baseline.

Manual browser QA was not executed in this environment; automated coverage was completed instead.

### Phase 16. cleanup + docs

- [x] Remove spike-only files/helpers left from Phase 1.
- [x] Remove dead code from old in-thread path once worker path is stable.
- [x] Remove feature flag only after soak period if desired.
- [x] Update `README.md` to remove stale SharedWorker claim.
- [x] Update any internal docs/comments that still imply worker-owned runtime truth.
- [x] Keep docs explicit that workers improve off-main-thread execution, not hidden-tab guarantees.
- [x] Add a short note about lease/recovery behavior under freeze/discard.

### Phase 17. optional follow-up tasks. not required for initial ship.

- [ ] Evaluate whether `LEASE_STALE_MS` should be made configurable.
- [ ] Evaluate whether worker-side liveness signaling with main-thread tab id is worth the complexity.
- [ ] Evaluate whether repo-only background warmup jobs should also move into the same worker.
- [ ] Evaluate whether snapshot diffing is needed if cross-thread payload volume becomes measurable.
- [ ] Evaluate whether the old main-thread `AgentHost` should remain as an explicit fallback path for unsupported browsers.

## Expected code changes

Likely new files:

- `src/agent/agent-turn-persistence.ts`
- `src/agent/runtime-worker-types.ts`
- `src/agent/runtime-worker.ts`
- `src/agent/runtime-worker-client.ts`
- `src/agent/worker-backed-agent-host.ts`
- `src/agent/runtime-flags.ts`

Likely edited files:

- `src/agent/agent-host.ts`
- `src/agent/runtime-client.ts`
- `src/components/chat.tsx` maybe none, maybe tiny recovery hook touch only
- `tests/agent-host-persistence.test.ts`
- new worker/runtime tests

## Risks and mitigations

Risk: worker import chain accidentally touches DOM-only code.

- mitigation: do Step 0 spike first

Risk: too many cross-thread callbacks during streaming.

- mitigation: snapshot batching, 50ms max flush, immediate terminal flush

Risk: freeze/discard still interrupts work.

- mitigation: keep lease + recovery as truth; add `freeze` release

Risk: duplicate persistence logic after refactor.

- mitigation: extract persistence first; make both implementations consume the same class

Risk: worker-side auth refresh writes Dexie from worker.

- mitigation: acceptable if spike proves safe; if not, proxy auth lookup from main thread

## Acceptance criteria

- `RuntimeClient` remains the authority for ownership and retries
- worker does not write session/message/runtime/lease rows
- hidden-tab work can continue when browser allows it
- freeze/discard still degrades into interrupted-turn recovery, not corruption
- existing optimistic persistence semantics stay intact
- no duplicate assistant IDs
- no orphan tool-result regressions
- no reintroduction of `SharedWorker` complexity

## Bottom line

This should be implemented as a refactor of boundaries, not a rewrite of behavior.

Bad plan:

- "move AgentHost to worker"
- "let worker own runtime rows"
- "let worker own leases"

Good plan:

- extract persistence
- keep main thread authoritative
- add thin `ComlinkWorker`
- send snapshots, not token spam
- treat worker as execution engine only
