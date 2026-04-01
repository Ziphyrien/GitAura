# Repo Model Simplification Plan

## Goal

Massively reduce LOC and moving parts around repository selection, URL parsing,
session persistence, and runtime creation.

The main simplification is:

- unresolved repo input is allowed only at the UI boundary
- everything persisted or passed to runtime is already resolved
- runtime never needs to "make sense of" a repo ref
- there is one repo path pipeline for all entry points

This is not a cosmetic cleanup. It changes the model so the app stops carrying
three versions of the same thing.

## Recommendation

Internalize `just-github` into the app for now.

Why:

- today it is only half-externalized
- the app imports deep internals like `../../just-github/src/...`
- app error typing mirrors library typing
- ref resolution lives outside the package while FS/client live inside it

That is the highest-LOC version of the design.

Do this now:

- move `just-github/src/*` to `src/lib/github/*`
- stop importing package internals directly
- keep the code local until the API stabilizes

Do **not** spend time making `just-github` a "real package" yet unless another
repo is actively depending on it.

## End State

### One boundary type for input

```ts
export interface RepoTarget {
  owner: string
  repo: string
  ref?: string
  refPathTail?: string
  token?: string
}
```

This is only for:

- route params
- pasted GitHub URLs
- repo combobox text input
- landing-page input

It is never stored in Dexie and never passed to the runtime.

### One canonical type for app state

```ts
export type ResolvedRepoRef =
  | {
      kind: "branch"
      name: string
      apiRef: `heads/${string}`
      fullRef: `refs/heads/${string}`
    }
  | {
      kind: "tag"
      name: string
      apiRef: `tags/${string}`
      fullRef: `refs/tags/${string}`
    }
  | {
      kind: "commit"
      sha: string
    }

export interface ResolvedRepoSource {
  owner: string
  repo: string
  ref: string
  refOrigin: "default" | "explicit"
  resolvedRef: ResolvedRepoRef
  token?: string
}
```

This is the only repo type stored in:

- `SessionData.repoSource`
- recent repositories
- runtime input
- markdown export
- header / empty state / chat UI

### One resolver

```ts
export async function resolveRepoTarget(
  target: RepoTarget
): Promise<ResolvedRepoSource>
```

This becomes the only entry to online repo/ref normalization.

### One path builder

```ts
export function repoSourceToPath(source: ResolvedRepoSource): string {
  return buildRepoPathname(
    source.owner,
    source.repo,
    source.refOrigin === "default" ? undefined : source.ref
  )
}
```

### One runtime contract

```ts
export function createRepoRuntime(
  source: ResolvedRepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime
```

No fallback checks. No "must be resolved before creating a runtime" guard. The
type already guarantees it.

## What We Delete

The point of this plan is not just to add a cleaner layer. It is to delete the
current mixed model.

Delete after migration:

- `RepoSource` as an optionally-resolved shape
- `hasResolvedRepoSource(...)`
- `repoSourceNeedsResolution(...)`
- `ensureSessionRepoSourceResolved(...)`
- lazy `resolveRepoSource(...)` effects inside chat/session/runtime flows
- runtime-side repo resolution checks
- any route/UI code that builds repo URLs from `owner/repo/ref` manually
- deep imports from `../../just-github/src/...`

## Architectural Rule

If repo data is in app state, it is already resolved.

That single rule removes most of the current defensive LOC.

## Implementation Plan

### Phase 0: Move GitHub Runtime Code In-Repo

Goal:

- eliminate the fake package boundary before changing behavior

Files:

- move `just-github/src/cache.ts` -> `src/lib/github/cache.ts`
- move `just-github/src/github-client.ts` -> `src/lib/github/github-client.ts`
- move `just-github/src/github-fs.ts` -> `src/lib/github/github-fs.ts`
- move `just-github/src/github-http.ts` -> `src/lib/github/github-http.ts`
- move `just-github/src/github-rate-limit.ts` -> `src/lib/github/github-rate-limit.ts`
- move `just-github/src/refs.ts` -> `src/lib/github/refs.ts`
- move `just-github/src/types.ts` -> `src/lib/github/types.ts`

Then replace imports like:

```ts
import {
  readGitHubErrorMessage,
  toGitHubFsError,
} from "../../just-github/src/github-http"
```

with:

```ts
import {
  readGitHubErrorMessage,
  toGitHubFsError,
} from "@/lib/github/github-http"
```

After this phase:

- remove the `just-github` dependency from `package.json`
- keep the moved code API-compatible for now

Why this first:

- it shortens import paths
- removes cross-package type duplication
- makes the real refactor easier to do safely

### Phase 1: Introduce `ResolvedRepoSource`

Goal:

- make resolved repo state explicit in the type system

Update [src/types/storage.ts](/Users/jeremy/Developer/gitinspect/src/types/storage.ts):

```ts
export interface ResolvedRepoSource {
  owner: string
  repo: string
  ref: string
  refOrigin: "default" | "explicit"
  resolvedRef: ResolvedRepoRef
  token?: string
}

export interface RepoTarget {
  owner: string
  repo: string
  ref?: string
  refPathTail?: string
  token?: string
}
```

Then update:

- `SessionData.repoSource?: ResolvedRepoSource`
- `RepositoryRow` to always include `refOrigin`

Example:

```ts
export interface RepositoryRow {
  lastOpenedAt: string
  owner: string
  repo: string
  ref: string
  refOrigin: "default" | "explicit"
}
```

Result:

- unresolved shapes disappear from session and recent-repo storage

### Phase 2: Rename Resolver Around the Real Boundary

Goal:

- make it obvious what is raw input and what is canonical output

Current:

```ts
export async function resolveRepoSource(
  source: RepoTarget | RepoSource
): Promise<RepoSource>
```

Replace with:

```ts
export async function resolveRepoTarget(
  target: RepoTarget
): Promise<ResolvedRepoSource>
```

And add a small identity helper for already-resolved values only if needed:

```ts
export function normalizeResolvedRepoSource(
  source: ResolvedRepoSource
): ResolvedRepoSource
```

Important:

- `resolveRepoTarget` should not accept `ResolvedRepoSource`
- if a callsite already has resolved data, it should not call the resolver

That separation alone will remove a lot of accidental complexity.

### Phase 3: Resolve Before Navigation or Session Creation

Goal:

- eliminate lazy resolution from runtime and session flows

All repo entry points must do:

```ts
const target = parseRepoQuery(input)
const repoSource = await resolveRepoTarget(target)
const to = repoSourceToPath(repoSource)
```

Apply that rule to:

- landing page
- repo combobox
- route loaders / route components
- deep-link restore if needed

#### Route shape recommendation

Keep route components dumb. Resolve before rendering `Chat`.

Current route code is too raw:

```ts
function RepoChatRoute() {
  const params = Route.useParams()
  const repoSource: RepoSource = {
    owner: params.owner,
    ref: params._splat ?? "",
    repo: params.repo,
  }

  return <Chat repoSource={repoSource} />
}
```

Target:

```ts
function RepoChatRoute() {
  const params = Route.useParams()
  const parsed = parsedPathToRepoSource({
    owner: params.owner,
    repo: params.repo,
    ref: params._splat || undefined,
  })

  return <ResolvedRepoChat repoTarget={parsed} />
}

function ResolvedRepoChat({ repoTarget }: { repoTarget: RepoTarget }) {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "ready"; repoSource: ResolvedRepoSource }
  >({ kind: "loading" })

  React.useEffect(() => {
    void resolveRepoTarget(repoTarget).then((repoSource) => {
      setState({ kind: "ready", repoSource })
    })
  }, [repoTarget])

  if (state.kind !== "ready") return <LoadingState label="Loading repository..." />
  return <Chat repoSource={state.repoSource} />
}
```

Better still:

- resolve in a route loader once TanStack Router ergonomics are clean here

### Phase 4: Make `Chat` and Session Code Resolved-Only

Goal:

- remove the biggest "extra FSM" layer

Current `Chat` owns too much repo state:

- input repo target
- async repo resolution
- resolution failure
- active session repo source
- lazy re-resolution of persisted sessions

Target `ChatProps`:

```ts
export interface ChatProps {
  repoSource?: ResolvedRepoSource
  sessionId?: string
}
```

Delete from [src/components/chat.tsx](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx):

- `resolvedRepoSource` local state
- `repoResolutionFailed`
- `resolveRepoSource(...)` effect
- `ensureSessionRepoSourceResolved(...)` effect
- imports for `repoSourceNeedsResolution`

The component should become:

```ts
const displayRepoSource = activeSession?.repoSource ?? props.repoSource
```

and nothing more.

This is one of the biggest LOC wins in the whole refactor.

### Phase 5: Make Session Persistence Resolved-Only

Goal:

- stop storing partial repo state

Current `createSession(...)` accepts a loose `RepoSource`.

Target:

```ts
export function createSession(params: {
  model: string
  providerGroup: ProviderGroupId
  repoSource?: ResolvedRepoSource
  thinkingLevel?: ThinkingLevel
}): SessionData
```

Delete from [src/sessions/session-service.ts](/Users/jeremy/Developer/gitinspect/src/sessions/session-service.ts):

- `ensureSessionRepoSourceResolved(...)`
- `repoSourceNeedsResolution(...)` usage

Current:

```ts
export async function ensureSessionRepoSourceResolved(
  session: SessionData
): Promise<SessionData> {
  const repoSource = session.repoSource

  if (!repoSource || !repoSourceNeedsResolution(repoSource)) {
    return session
  }

  const nextSession = {
    ...session,
    repoSource: await resolveRepoSource(repoSource),
  }

  await persistSessionSnapshot(nextSession)

  return nextSession
}
```

Delete it entirely.

Then make `createSessionForRepo(...)` require resolved input:

```ts
export async function createSessionForRepo(params: {
  base?: SessionCreationBase
  repoSource: ResolvedRepoSource
}): Promise<SessionData>
```

### Phase 6: Make Runtime Resolved-Only

Goal:

- remove runtime-side repo FSM glue

Current runtime contract:

```ts
export function createRepoRuntime(
  source: RepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime
```

Target:

```ts
export function createRepoRuntime(
  source: ResolvedRepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime
```

Then delete from [src/repo/repo-runtime.ts](/Users/jeremy/Developer/gitinspect/src/repo/repo-runtime.ts):

- `normalizeRepoSource(...)`
- `hasResolvedRepoSource(...)`
- runtime guard `"Repository ref must be resolved before creating a runtime"`

Target code shape:

```ts
export function createRepoRuntime(
  source: ResolvedRepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime {
  const withToken = mergeRepoSourceWithRuntimeToken(source, options?.runtimeToken)

  const fs = new GitHubFs({
    owner: withToken.owner,
    repo: withToken.repo,
    ref: withToken.resolvedRef,
    token: withToken.token,
  })

  // ...
}
```

Then update `runtime-client.ts`:

- remove `ensureSessionRepoSourceResolved(...)` calls in `startInitialTurn(...)`
- remove `ensureSessionRepoSourceResolved(...)` calls in `loadMutationSession(...)`

The runtime client should trust persisted sessions.

### Phase 7: Collapse URL Helpers to One Public Surface

Goal:

- stop re-encoding repo URL rules in multiple places

Public API should be just:

```ts
export function parseRepoQuery(raw: string): RepoTarget | undefined
export function parseRepoPathname(pathname: string): ParsedRepoPath | undefined
export function parsedPathToRepoTarget(parsed: ParsedRepoPath): RepoTarget
export function repoSourceToPath(source: ResolvedRepoSource): string
```

Everything else should be private helpers.

Delete manual calls like:

```ts
buildRepoPathname(owner, repo, ref)
```

from app code unless they are inside `repoSourceToPath(...)`.

Reason:

- this is where drift keeps being reintroduced

### Phase 8: Simplify Recent Repos and UI Presentation

Goal:

- remove more conditional display logic

Because recent repos will always be resolved:

- `GithubRepo` can assume `refOrigin` exists
- markdown export can assume `refOrigin` exists
- `touchRepository(...)` stops accepting partial repo shapes

Target:

```ts
export async function touchRepository(
  source: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin">
): Promise<void>
```

Then simplify display code:

```ts
const refSuffix = source.refOrigin === "explicit" ? `@${source.ref}` : ""
```

No fallback branches based on missing `refOrigin`.

## Optional Follow-Up: Reduce Ref Resolution Calls

After the model is simplified, you can still shrink code further by reducing the
resolver logic.

Two valid directions:

### Option A: Keep current rich resolver

Pros:

- best UX for pasted GitHub URLs
- supports branch/tag/commit disambiguation explicitly

Cons:

- more code in `ref-resolver.ts`

### Option B: Resolve mostly with `/commits/:ref`

Pros:

- smaller code

Cons:

- loses some explicit branch-vs-tag typing
- can be ambiguous for same-name branch and tag

Recommendation:

- keep current rich resolver for now
- simplify the **state model** first

That change removes more complexity than shrinking `ref-resolver.ts` by 40 lines.

## Concrete Code Changes By File

### `src/types/storage.ts`

- add `ResolvedRepoSource`
- remove unresolved `RepoSource` from session/runtime storage contracts
- require `refOrigin` in `RepositoryRow`

### `src/repo/ref-resolver.ts`

- rename `resolveRepoSource(...)` -> `resolveRepoTarget(...)`
- change input to `RepoTarget`
- change output to `ResolvedRepoSource`
- remove special-case support for "already resolved" input

### `src/repo/refs.ts`

- keep constructors for `ResolvedRepoRef`
- delete helpers that only exist because sources may be half-resolved

Expected surviving API:

```ts
export function createBranchRepoRef(name: string): ResolvedRepoRef
export function createTagRepoRef(name: string): ResolvedRepoRef
export function createCommitRepoRef(sha: string): ResolvedRepoRef
export function displayResolvedRepoRef(ref: ResolvedRepoRef): string
```

Delete:

- `hasResolvedRepoSource(...)`
- `repoSourceNeedsResolution(...)`

### `src/components/chat.tsx`

- make `repoSource` prop resolved-only
- delete internal resolution effects and failure state

### `src/sessions/session-service.ts`

- accept/store resolved repo sources only
- delete `ensureSessionRepoSourceResolved(...)`

### `src/agent/runtime-client.ts`

- stop resolving repo state on mutation paths
- trust loaded sessions

### `src/repo/repo-runtime.ts`

- accept `ResolvedRepoSource`
- remove resolution guards

### `src/components/landing-page.tsx`

- keep using resolver before navigation
- pass resolved repo source through `repoSourceToPath(...)`

### `src/components/repo-combobox.tsx`

- keep using the same resolver
- no separate repo validation path

### `src/routes/$owner.$repo.index.tsx`
### `src/routes/$owner.$repo.$.tsx`

- stop passing raw unresolved repo objects directly into `Chat`
- introduce a resolved boundary wrapper or loader

## Migration Strategy

Do this in order to keep the app working at each step.

### Step 1

Internalize `just-github` into `src/lib/github`.

### Step 2

Introduce `ResolvedRepoSource` and update storage types.

### Step 3

Rename resolver to `resolveRepoTarget(...)` and make it output only resolved sources.

### Step 4

Update landing page and combobox to use resolved output.

### Step 5

Update route components to resolve before rendering `Chat`.

### Step 6

Update session creation and persistence to accept resolved repo sources only.

### Step 7

Update runtime to accept resolved sources only.

### Step 8

Delete dead code and old helpers.

This order keeps the changes understandable and makes it easy to stop after any
phase if the tests expose a problem.

## Detailed TODO

### Phase 0: Internalize GitHub Runtime Code

- [x] Internalized the GitHub runtime sources into `src/lib/github/`
- [x] Repointed app/test imports away from `just-github/src/*`
- [x] Removed the `just-github` dependency from `package.json` and `bun.lock`
- [x] Deleted the `@/repo/github-fs` compatibility layer after direct imports landed
- [x] Confirmed there are no remaining deep imports from `just-github/src/*`

### Phase 1: Introduce Canonical Resolved Types

- [x] Added `ResolvedRepoSource` and kept `RepoTarget` as the raw input boundary
- [x] Updated `SessionData.repoSource` and `RepositoryRow.refOrigin` to the resolved-only model
- [x] Split consumers into `RepoTarget` vs `ResolvedRepoSource`
- [x] Documented the raw-input vs resolved-state boundary in `src/types/storage.ts`

### Phase 2: Narrow the Resolver Boundary

- [x] Renamed the resolver to `resolveRepoTarget(...)`
- [x] Narrowed the contract to `RepoTarget -> ResolvedRepoSource`
- [x] Removed the already-resolved special case
- [x] Kept `resolveGitHubRef(...)` and `resolveTreeOrBlobTail(...)` internal
- [x] Updated resolver imports across the app
- [x] Added resolver coverage for default refs, explicit refs, commits, and deep tree/blob tails

### Phase 3: Simplify Repo Ref Helpers

- [x] Reduced `src/repo/refs.ts` to constructors plus `displayResolvedRepoRef(...)`
- [x] Removed `hasResolvedRepoSource(...)` and `repoSourceNeedsResolution(...)`
- [x] Updated callsites to rely on resolved-only types instead of runtime guards

### Phase 4: Resolve Before Navigation

- [x] Kept landing-page navigation on the resolve-before-navigate path
- [x] Kept combobox navigation on the same resolve-before-navigate path
- [x] Kept suggested/recent repositories in resolved-row shapes only
- [x] Removed manual URL construction outside `repoSourceToPath(...)`
- [x] Added landing-page coverage for deep-ref navigation and suggested explicit refs

### Phase 5: Resolve Before Rendering Chat

- [x] Changed `ChatProps.repoSource` to `ResolvedRepoSource`
- [x] Moved route resolution into a single shared wrapper component
- [x] Updated both repo route modules to resolve before rendering `Chat`
- [x] Added route coverage for repo root, explicit splat refs, and deep tree refs

### Phase 6: Remove Lazy Resolution From Chat

- [x] Removed repo resolution state/effects from `src/components/chat.tsx`
- [x] Simplified display repo selection to `activeSession?.repoSource ?? props.repoSource`
- [x] Preserved empty-state/composer behavior without repo-loading state
- [x] Updated chat tests to pass resolved repo sources only

### Phase 7: Make Session Persistence Resolved-Only

- [x] Updated session creation/persistence to accept resolved repo sources only
- [x] Preserved resolved repo sources in `buildPersistedSession(...)`
- [x] Deleted `ensureSessionRepoSourceResolved(...)` and removed all callsites
- [x] Updated session tests/mocks to use resolved repo data
- [x] Added compatibility-repair coverage for legacy stored sessions missing `resolvedRef`

### Phase 8: Make Runtime Resolved-Only

- [x] Changed `createRepoRuntime(...)` and `RepoRuntime.source` to `ResolvedRepoSource`
- [x] Removed runtime normalization/guard code
- [x] Kept runtime token merge behavior on resolved repo sources
- [x] Updated runtime-worker, agent-host, and runtime-client to trust resolved sessions
- [x] Updated runtime tests to use resolved repo sources only

### Phase 9: Clean Up URL and Path Helpers

- [x] Kept `parseRepoQuery(...)` and `parseRepoPathname(...)` on raw input only
- [x] Renamed `parsedPathToRepoSource(...)` to `parsedPathToRepoTarget(...)`
- [x] Narrowed `repoSourceToPath(...)` to resolved sources
- [x] Audited remaining repo URL construction
- [x] Added path helper coverage for default, explicit branch/tag, and commit paths

### Phase 10: Simplify Recent Repos, Header, and Presentation

- [x] Narrowed `touchRepository(...)` and recent repo writes to resolved source fields
- [x] Simplified `GithubRepo`, `ChatEmptyState`, `AppHeader`, and markdown export to resolved-only repo presentation
- [x] Removed presentation fallbacks that only existed for half-resolved repo state

### Phase 11: Dexie Migration for Existing Data

- [x] Bumped Dexie to version 3 for the repo-shape migration
- [x] Added a repository-row migration that backfills `refOrigin`
- [x] Added a one-time load repair path for legacy sessions missing `resolvedRef`
- [x] Kept the repair path isolated to old persisted data instead of the runtime architecture
- [x] Added migration/repair coverage for old repository rows and old session rows

### Phase 12: Verification and Dead-Code Removal

- [x] Removed the old `RepoSource`/lazy-resolution surface from app code and tests
- [x] Cleared remaining imports/usages of the deleted helpers and old resolver name
- [x] Ran dead-pattern `rg` checks for repo-resolution helpers and deep `just-github` imports
- [x] Ran `bun run typecheck`
- [x] Added/updated resolver, route, chat, runtime, and storage-migration tests for the new model
- [x] Confirmed final naming consistency around `RepoTarget`, `ResolvedRepoSource`, and `ResolvedRepoRef`
- [x] Verified the local Vitest runner is still affected by the pre-existing hang, so full runtime execution remains blocked outside typecheck/local static verification

### Optional Phase 13: Smaller Resolver After Model Cleanup

- [x] Deferred resolver-internals simplification until after the state-model cleanup
- [x] Kept the richer resolver behavior in place for correctness and deep-link UX

## Tests To Add Or Update

### Resolver tests

- [x] `owner/repo` resolves to the default branch with `refOrigin: "default"`
- [x] `tree/feature/foo/...` resolves to branch `feature/foo`
- [x] `blob/...` deep tails resolve through slash-ref matching
- [x] `commit/<sha>` resolves to `kind: "commit"`

### Route/input tests

- [x] landing page resolves before navigating
- [x] combobox continues to resolve before navigating
- [x] route deep links with slash refs render the intended repo target before resolution

### Session/runtime tests

- [x] persisted sessions are repaired to resolved sources on load
- [x] runtime creation accepts only resolved sources
- [x] chat no longer shows a repo-loading intermediate state for resolved repo props

### Type-level cleanup checks

- no callsites still pass `RepoTarget` into runtime/session creation
- no remaining imports of `ensureSessionRepoSourceResolved`
- no remaining imports of `repoSourceNeedsResolution`

## Risks

### Dexie shape migration

Risk:

- old rows may be missing `refOrigin` or `resolvedRef`

Mitigation:

- add a migration that backfills `refOrigin`
- for existing session rows without `resolvedRef`, run a one-time migration on load
- after that migration completes, delete lazy resolution code

Suggested migration helper:

```ts
async function migrateSessionRepoSource(
  session: SessionData
): Promise<SessionData> {
  if (!session.repoSource) return session
  if ("resolvedRef" in session.repoSource && session.repoSource.resolvedRef) {
    return session
  }

  return {
    ...session,
    repoSource: await resolveRepoTarget(session.repoSource),
  }
}
```

Important:

- this migration helper is temporary
- it exists only for old stored data
- it should not become the new app architecture

### Route resolution latency

Risk:

- repo routes may briefly show "Loading repository..."

Mitigation:

- that is acceptable at the route boundary
- it is much cheaper than carrying resolution state through the full app

## Success Criteria

This refactor is complete when all of these are true:

- `SessionData.repoSource` is always a `ResolvedRepoSource`
- `createRepoRuntime(...)` accepts only `ResolvedRepoSource`
- `Chat` no longer resolves repos itself
- `runtime-client` no longer resolves repos itself
- `session-service` no longer resolves repos itself
- all navigation paths use the same resolver and path builder
- there are no deep imports from `just-github/src/*`

## Anti-Goals

Do not do these during this pass:

- do not redesign the chat session FSM itself unless a repo-state dependency requires it
- do not split this into a new reusable package
- do not add server-side resolution
- do not keep "temporary compatibility helpers" longer than one migration phase

## Short Version

The clean version of this feature is:

1. Parse raw input into `RepoTarget`
2. Resolve once into `ResolvedRepoSource`
3. Persist only `ResolvedRepoSource`
4. Pass only `ResolvedRepoSource` to runtime
5. Delete every lazy resolution layer

That is the direction that meaningfully shrinks LOC.
