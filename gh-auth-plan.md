# GitHub Auth & Proxy Refactor Plan

## Summary

Refactor the GitHub auth / transport path so that:

1. **`githubApiFetch(...)` becomes the single app-level GitHub transport helper**.
2. **Direct GitHub auth is resolved inside that helper**, not threaded through callers as raw tokens.
3. **Proxy mode is added to the helper for public GitHub reads only in v1**.
4. **`just-github` stays direct-only** and does **not** learn about proxy mode.
5. **Repo parsing / ref resolution becomes pure again** (no `token` fields in repo intent/location types).
6. **Long-lived runtime repo access resolves direct auth lazily** instead of snapshotting a GitHub token at worker start.
7. **The long-term plan removes the stateful client-side rate limiter**. Keep only pure rate-limit parsing/classification helpers.

### Final API shape to aim for

```ts
export type GitHubRequestAccess = "public" | "repo";
export type GitHubTransport = "auto" | "direct" | "proxy";

export async function githubApiFetch(
  path: string,
  options?: {
    access?: GitHubRequestAccess;
    transport?: GitHubTransport;
    signal?: AbortSignal;
  },
): Promise<Response>;
```

`transport` is **optional** and should default to `"auto"`. In normal app call sites, prefer:

```ts
githubApiFetch(path, { access: "public" });
githubApiFetch(path, { access: "repo" });
```

Only pass `transport` when forcing behavior in tests, debugging, or a narrow specialized path.

### Transport matrix to implement

| access   | transport | result                                                                                            |
| -------- | --------- | ------------------------------------------------------------------------------------------------- |
| `public` | `auto`    | direct authenticated if auth is available; otherwise proxy if enabled; otherwise direct anonymous |
| `public` | `direct`  | direct GitHub request; use auth if available, otherwise anonymous                                 |
| `public` | `proxy`   | proxy GitHub request                                                                              |
| `repo`   | `auto`    | direct authenticated if auth is available; otherwise direct anonymous                             |
| `repo`   | `direct`  | direct GitHub request; use auth if available, otherwise anonymous                                 |
| `repo`   | `proxy`   | **throw**: not supported in v1                                                                    |

### Important decisions

- **Proxy mode belongs only in the app helper**, not in `just-github`.
- **Proxy mode is public-only in v1**.
- **In `auto`, direct auth wins when available. Proxy is only a public fallback.**
- **No long-term stateful client-side request blocking / rate-limit memory**.
- **If any ambiguity remains while implementing, stop and use `ask_user` before proceeding.**

---

## Context

## Problem being solved

A real bug occurred where:

- Better Auth successfully obtained a GitHub OAuth token.
- Some GitHub request paths still behaved as anonymous.
- Repo resolution / helper code did not consistently use the available token.
- Anonymous traffic could hit GitHub rate limits.
- Client-side state and token threading made the behavior brittle.

The hotfix fixed the immediate issue, but the architecture is still more fragile than it should be.

## What is wrong with the current shape

### 1) Raw GitHub tokens leak through unrelated layers

Current repo-related types carry `token?: string`:

- `packages/pi/src/repo/path-intent.ts`
- `packages/db/src/storage-types.ts` via `ResolvedRepoSource`
- `packages/pi/src/repo/ref-resolver.ts` helper signatures

That forces route/UI callers to explicitly thread auth through pure repo-parsing APIs.

### 2) The app helper currently owns too much state

`packages/pi/src/repo/github-fetch.ts` currently mixes:

- GitHub request execution
- auth resolution
- cache behavior
- stateful rate-limit behavior
- error/toast concerns

The long-term problem is the **stateful rate-limit behavior**, not header parsing itself.

### 3) Runtime repo access snapshots auth too early

The runtime currently snapshots GitHub auth via:

- `githubRuntimeToken` on worker inputs
- `refreshGithubToken(...)` worker plumbing
- repo runtime construction with static token merging

That means auth freshness depends on manual refresh flows.

## Scope boundaries

### In scope

- `githubApiFetch(...)` helper refactor
- generic public GitHub proxy route
- removal of token threading from repo parsing / resolution
- lazy direct auth for runtime repo reads
- tests and env updates required to support the above

### Out of scope

- rewriting Better Auth
- moving proxy behavior into `just-github`
- private-repo proxying via the user’s Better Auth token in v1
- redesigning unrelated session/model/chat architecture

## Relevant files

### Direct auth + helper transport

- `apps/web/src/lib/github-access.ts`
- `packages/pi/src/repo/github-access.ts`
- `packages/pi/src/repo/github-fetch.ts`

### Repo parsing / repo resolution

- `packages/pi/src/repo/path-intent.ts`
- `packages/pi/src/repo/ref-resolver.ts`
- `apps/web/src/routes/$owner.$repo.index.tsx`
- `apps/web/src/routes/$owner.$repo.$.tsx`
- `packages/ui/src/components/landing-page.tsx`
- `packages/ui/src/components/repo-combobox.tsx`

### Direct runtime repo access

- `packages/just-github/src/types.ts`
- `packages/just-github/src/github-client.ts`
- `packages/just-github/src/github-fs.ts`
- `packages/pi/src/repo/repo-runtime.ts`
- `packages/pi/src/agent/runtime-worker-types.ts`
- `packages/pi/src/agent/runtime-worker.ts`
- `packages/pi/src/agent/session-worker-coordinator.ts`
- `packages/pi/src/agent/worker-backed-agent-host.ts`
- `packages/pi/src/agent/runtime-client.ts`

### Env and proxy route

- `packages/env/src/server.ts`
- `packages/env/src/web.ts`
- `apps/web/.env.example`
- new route under `apps/web/src/routes/api/github/$` (match existing TanStack Start route style)

### Existing tests that will likely need updates

- `tests/github-fetch.test.ts`
- `tests/ref-resolver.test.ts`
- `tests/landing-page.test.tsx`
- `tests/worker-backed-agent-host.test.ts`
- any tests covering runtime worker types / repo runtime / public GitHub metadata readers

## Concrete implementation targets

### Target direct auth resolver

Keep direct auth centralized with a typed helper.

```ts
export type GitHubResolvedRequestAuth =
  | { mode: "anon" }
  | { mode: "oauth"; token: string; scopes: string[] }
  | { mode: "pat"; token: string };

export async function resolveRegisteredGitHubRequestAuth(
  access: GitHubRequestAccess = "repo",
): Promise<GitHubResolvedRequestAuth> {
  const result = await resolveRegisteredGitHubAccess({
    requireRepoScope: access === "repo",
  });

  if (!result.ok) {
    return { mode: "anon" };
  }

  if (result.source === "oauth") {
    return {
      mode: "oauth",
      token: result.token,
      scopes: result.scopes ?? [],
    };
  }

  return {
    mode: "pat",
    token: result.token,
  };
}
```

### Target helper transport resolution

```ts
type GitHubExecutionPlan =
  | { transport: "proxy" }
  | { transport: "direct"; auth: GitHubResolvedRequestAuth };

async function resolveGitHubExecutionPlan(input: {
  access: GitHubRequestAccess;
  transport?: GitHubTransport;
  proxyEnabled: boolean;
}): Promise<GitHubExecutionPlan> {
  const access = input.access;
  const transport = input.transport ?? "auto";

  if (transport === "proxy") {
    if (access === "repo") {
      throw new Error("Proxy transport only supports public GitHub requests in v1.");
    }

    return { transport: "proxy" };
  }

  const auth = await resolveRegisteredGitHubRequestAuth(access);

  if (transport === "direct") {
    return { transport: "direct", auth };
  }

  // auto
  if (auth.mode !== "anon") {
    return { transport: "direct", auth };
  }

  if (access === "public" && input.proxyEnabled) {
    return { transport: "proxy" };
  }

  return { transport: "direct", auth };
}
```

This is the intended `auto` behavior:

- try direct authenticated first
- if no auth exists and the request is public, use proxy when available
- otherwise fall back to direct anonymous

### Target proxy route shape

Use **one generic route**, not endpoint-specific routes like `/api/github-stars`.

Preferred route:

```txt
GET /api/github/repos/:owner/:repo
GET /api/github/repos/:owner/:repo/languages
GET /api/github/repos/:owner/:repo/readme
```

### Target env names

Use these exact names unless blocked by an existing convention:

- server: `GITHUB_PROXY_TOKEN`
- web: `VITE_GITHUB_PROXY_ENABLED`

If env naming becomes ambiguous during implementation, use `ask_user` before changing names.

### Target allowlist for proxy v1

Keep proxy v1 intentionally narrow:

- `/repos/:owner/:repo`
- `/repos/:owner/:repo/languages`
- `/repos/:owner/:repo/readme`

Do **not** start with “proxy any GitHub API path”.

### Target direct runtime auth shape

`just-github` remains direct, but gains lazy token resolution:

```ts
export interface GitHubFsOptions {
  owner: string;
  repo: string;
  ref: GitHubResolvedRef;
  token?: string;
  getToken?: () => Promise<string | undefined>;
  baseUrl?: string;
  cache?: CacheOptions;
}
```

And runtime construction should move toward:

```ts
const fs = new GitHubFs({
  owner: source.owner,
  repo: source.repo,
  ref: source.resolvedRef,
  getToken: async () => {
    const access = await resolveRegisteredGitHubAccess({ requireRepoScope: true });
    return access.ok ? access.token : undefined;
  },
});
```

---

## Guidelines

1. **Do not implement proxy mode inside `just-github`.**
   - `just-github` must remain direct-only.
   - Proxy transport is only an app/helper concern.

2. **Do not keep or add long-term stateful client-side rate-limit memory.**
   - Remove global blocked-until logic from the plan.
   - Keep only pure rate-limit parsing and response classification helpers.

3. **Repo parsing and repo resolution must remain pure.**
   - No auth/token fields in `RepoPathIntent` or `ResolvedRepoLocation` after the refactor.
   - Route/UI callers must stop threading tokens into repo resolution.

4. **Proxy v1 is public-only.**
   - `access: "repo"` + `transport: "proxy"` must throw.
   - Private/user-scoped repo requests remain direct in v1.

5. **`auto` is auth-first, not proxy-first.**
   - When direct auth is available, `auto` must choose direct authenticated requests.
   - Proxy is only a fallback for public requests when direct auth is unavailable.

6. **Keep direct auth resolution centralized.**
   - Direct mode must resolve auth inside the helper using `resolveRegisteredGitHubAccess(...)`.
   - Callers should express `access`, and usually omit `transport` unless they need to force behavior.

7. **Prefer request-local fallback behavior over cross-request memory.**
   - Request-local “retry unauthenticated” fallback is okay if still useful.
   - Cross-request/global in-memory blocking is not.

8. **Do not broaden the proxy allowlist without asking.**
   - Start with the exact allowlist listed above.
   - If implementation reveals a missing endpoint, use `ask_user` before expanding.

9. **Do not redesign unrelated systems in this pass.**
   - Do not refactor unrelated chat/session/model code.
   - Keep the blast radius focused on GitHub auth/transport/repo access.

10. **Keep backward compatibility where it reduces migration risk.**

- `ResolvedRepoSource.token` can be deprecated first before being removed.
- `GitHubFsOptions.token` should remain supported even after adding `getToken`.

11. **Test each phase before moving on.**
    - Run targeted tests after each phase.
    - Run the full test suite before considering the work complete.

12. **If any ambiguity appears during implementation, stop and use `ask_user`.**
    Use `ask_user` instead of guessing if any of the following become unclear:
    - env variable naming
    - proxy route path format
    - whether to migrate a specific public GitHub consumer now or later
    - whether to expand the proxy allowlist
    - whether to remove `ResolvedRepoSource.token` in the same PR or defer it

---

## Detailed Todo List

## Phase 0 — Preparation and guardrails

### Goal

Lock down the exact boundaries before code changes start.

- [x] Re-read this plan and keep scope limited to GitHub auth / transport / repo access.
- [x] Confirm the following names are the implementation targets:
  - [x] `GitHubRequestAccess = "public" | "repo"`
  - [x] `GitHubTransport = "auto" | "direct" | "proxy"`
  - [x] server env: `GITHUB_PROXY_TOKEN`
  - [x] web env: `VITE_GITHUB_PROXY_ENABLED`
  - [x] proxy route: `apps/web/src/routes/api/github/$`
- [x] If any of those names cannot fit the existing project conventions, stop and use `ask_user` before renaming them.
- [x] Do **not** implement any proxy behavior in `just-github`.
- [x] Do **not** preserve the old global rate-limit controller design as part of the final architecture.

## Phase 1 — Refactor the app-level GitHub helper boundary

### Goal

Make `githubApiFetch(...)` own direct auth resolution + transport choice, with `auto` behaving as auth-first and `transport` remaining optional.

### Files

- `packages/pi/src/repo/github-access.ts`
- `packages/pi/src/repo/github-fetch.ts`
- `tests/github-fetch.test.ts`
- any shared helper tests covering auth classification

### Tasks

- [x] Add `GitHubRequestAccess` type.
- [x] Add `GitHubTransport` type.
- [x] Add `GitHubResolvedRequestAuth` type.
- [x] Add `resolveRegisteredGitHubRequestAuth(access)` to `packages/pi/src/repo/github-access.ts`.
- [x] Keep `resolveRegisteredGitHubAccess(...)` as the lower-level direct auth source.
- [x] Update `githubApiFetch(...)` signature to:
  - [x] accept `access?: GitHubRequestAccess`
  - [x] accept `transport?: GitHubTransport`
  - [x] accept `signal?: AbortSignal`
- [x] Make `transport` optional with a default of `"auto"`.
- [x] Implement transport resolution with the exact matrix from the Summary section.
- [x] In `auto`, resolve direct auth first before deciding whether to proxy.
- [x] Implement direct-mode request execution inside `githubApiFetch(...)`.
- [x] In direct mode, resolve auth internally via `resolveRegisteredGitHubRequestAuth(...)`.
- [x] Preserve request-local unauthenticated fallback behavior only if it still helps and does not add global state.
- [x] Remove / simplify the stateful global rate-limit controller logic from `packages/pi/src/repo/github-fetch.ts`.
- [x] Keep pure rate-limit parsing/classification helpers available.
- [x] Ensure `githubApiFetch(..., { access: "repo", transport: "proxy" })` throws the exact v1 unsupported error.

### Tests for Phase 1

- [x] Add/update test: omitting `transport` behaves the same as `transport: "auto"`.
- [x] Add/update test: `public + auto` uses direct authenticated requests when auth is available.
- [x] Add/update test: `public + auto` uses proxy when no auth is available and proxy is enabled.
- [x] Add/update test: `public + auto` falls back to direct anonymous when no auth is available and proxy is disabled.
- [x] Add/update test: `repo + auto` uses direct authenticated requests when auth is available.
- [x] Add/update test: `repo + auto` falls back to direct anonymous when no auth is available.
- [x] Add/update test: `repo + proxy` throws.
- [x] Add/update test: helper no longer keeps cross-request blocked-until state.
- [x] Add/update test: direct auth still supports OAuth/PAT/anon resolution correctly.

## Phase 2 — Add the generic public GitHub proxy route

### Goal

Support reusable public GitHub reads via one generic proxy route.

### Files

- `apps/web/src/routes/api/github/$`
- `packages/env/src/server.ts`
- `packages/env/src/web.ts`
- `apps/web/.env.example`
- new tests for the proxy route

### Tasks

- [x] Add `GITHUB_PROXY_TOKEN` to `packages/env/src/server.ts` as optional or required per current env style.
- [x] Add `VITE_GITHUB_PROXY_ENABLED` to `packages/env/src/web.ts`.
- [x] Add both env vars to `apps/web/.env.example` with clear comments.
- [x] Create the generic proxy route under `apps/web/src/routes/api/github/$`.
- [x] Restrict the route to `GET` and `HEAD` only.
- [x] Reject non-GET/HEAD methods with the appropriate status.
- [x] Validate the requested proxy path against the v1 allowlist.
- [x] Reject disallowed paths with `403`.
- [x] Proxy only to `https://api.github.com`.
- [x] Attach `Authorization: Bearer ${env.GITHUB_PROXY_TOKEN}` server-side.
- [x] Forward appropriate GitHub headers (`Accept`, API version, etc.).
- [x] Return upstream body/status/statusText.
- [x] Set cache headers appropriate for public GitHub metadata.
- [x] Ensure missing proxy token/config returns a clear server error response.

### Tests for Phase 2

- [x] Add test: allowed path proxies successfully.
- [x] Add test: disallowed path is rejected.
- [x] Add test: non-GET method is rejected.
- [x] Add test: missing `GITHUB_PROXY_TOKEN` produces a clear error.
- [x] Add test: cache headers are present on successful proxy responses.

## Phase 3 — Migrate public GitHub consumers to helper + proxy

### Goal

Use the new helper/proxy path for public GitHub metadata instead of bespoke routes/helpers.

### Files

- any public GitHub metadata readers (stars, repo metadata, etc.)
- any dedicated public GitHub routes/helpers that become redundant
- corresponding tests

### Tasks

- [x] Identify every existing public GitHub consumer in the app (stars, repo metadata, etc.).
- [x] For each public consumer, replace direct bespoke fetch logic with:
  - [x] `githubApiFetch(path, { access: "public" })`
  - [x] only pass `transport` explicitly if a test or debug-only path truly needs to force behavior
- [x] Remove any dedicated public GitHub route/helper that is now redundant.
- [x] Keep the migration scoped to public endpoints only.
- [x] If any public consumer needs a GitHub endpoint outside the v1 allowlist, stop and use `ask_user` before expanding the allowlist.

### Tests for Phase 3

- [x] Add/update stars test to verify it uses the generic helper.
- [x] Add/update public repo metadata test to verify it uses the generic helper.
- [x] Remove/update tests that referenced old bespoke public GitHub routes if they are deleted.

## Phase 4 — Make repo parsing and ref resolution pure again

### Goal

Remove token threading from repo path / ref resolution code.

### Files

- `packages/pi/src/repo/path-intent.ts`
- `packages/pi/src/repo/ref-resolver.ts`
- `packages/db/src/storage-types.ts`
- `apps/web/src/routes/$owner.$repo.index.tsx`
- `apps/web/src/routes/$owner.$repo.$.tsx`
- `packages/ui/src/components/landing-page.tsx`
- `packages/ui/src/components/repo-combobox.tsx`
- `tests/ref-resolver.test.ts`
- `tests/landing-page.test.tsx`

### Tasks

- [x] Remove `token?: string` from `RepoPathIntent`.
- [x] Remove `token?: string` from `ResolvedRepoLocation`.
- [x] Update `toResolvedRepoSource(...)` to stop copying a token from resolved location.
- [x] In `packages/db/src/storage-types.ts`, decide whether to:
  - [x] keep `ResolvedRepoSource.token` temporarily as deprecated, or
  - [x] remove it now if safe
- [x] Default to **deprecated but still present** unless there is clear evidence it can be removed safely in the same pass.
- [x] Remove `token` parameters from all ref-resolver helper signatures.
- [x] Update ref resolver internals to call:
  - [x] `githubApiFetch(path, { access: "repo" })`
  - [x] do not pass `transport` explicitly unless a narrow test requires forcing behavior
- [x] Remove `resolveRegisteredGitHubToken(...)` usage from route loaders.
- [x] Remove token-passing from landing-page repo submission.
- [x] Remove token-passing from repo-combobox submission.
- [x] Ensure `resolveRepoIntent(...)` and `resolveGitHubRef(...)` are pure again.

### Tests for Phase 4

- [x] Update `tests/ref-resolver.test.ts` to expect access/transport options instead of raw token threading.
- [x] Update `tests/landing-page.test.tsx` so repo intent assertions no longer include `token`.
- [x] Add/keep test verifying route/UI repo flows no longer fetch/pass raw GitHub tokens.

## Phase 5 — Make direct runtime GitHub auth lazy

### Goal

Keep `just-github` direct-only, but ensure direct runtime repo access sees fresh auth automatically.

### Files

- `packages/just-github/src/types.ts`
- `packages/just-github/src/github-client.ts`
- `packages/just-github/src/github-fs.ts`
- `packages/pi/src/repo/repo-runtime.ts`
- `packages/pi/src/agent/runtime-worker-types.ts`
- `packages/pi/src/agent/runtime-worker.ts`
- `packages/pi/src/agent/session-worker-coordinator.ts`
- `packages/pi/src/agent/worker-backed-agent-host.ts`
- `packages/pi/src/agent/runtime-client.ts`
- runtime tests

### Tasks

- [x] Add `getToken?: () => Promise<string | undefined>` to `GitHubFsOptions`.
- [x] Add `getToken?: () => Promise<string | undefined>` to `GitHubClientOptions`.
- [x] Keep `token?: string` in those types for backward compatibility.
- [x] Implement lazy token resolution inside `GitHubClient`.
- [x] Ensure each direct request resolves the latest token before building headers.
- [x] Keep existing direct fallback behavior request-local if still needed.
- [x] Update `GitHubFs` construction to pass through `getToken`.
- [x] Update `createRepoRuntime(...)` to stop merging a static `runtimeToken` into repo source.
- [x] Use a lazy `getToken` callback in `createRepoRuntime(...)` that resolves via `resolveRegisteredGitHubAccess({ requireRepoScope: true })`.
- [x] Remove `githubRuntimeToken` from `StartTurnInput` in `packages/pi/src/agent/runtime-worker-types.ts`.
- [x] Delete `RefreshGithubTokenInput` if no longer needed.
- [x] Delete worker/runtime refresh methods if they become unnecessary.
- [x] Remove `resolveGithubRuntimeToken()` from `WorkerBackedAgentHost`.
- [x] Remove manual runtime token refresh calls from the settings/UI path if they are no longer needed.

### Tests for Phase 5

- [x] Update `tests/worker-backed-agent-host.test.ts` for the removed `githubRuntimeToken` path.
- [x] Add/update runtime tests proving auth changes are picked up on the next direct repo read without manual refresh.
- [x] Add/update `repo-runtime` / `just-github` tests for lazy token resolution.

## Phase 6 — Cleanup and deprecation removal

### Goal

Remove dead plumbing and tighten the final shape.

### Files

- any files still referencing deprecated token-threading helpers/fields
- any stale tests or comments

### Tasks

- [x] Remove `resolveRegisteredGitHubToken(...)` if it is no longer used anywhere.
- [x] Remove stale comments that describe token-threading behavior.
- [x] Remove stale comments that describe stateful rate-limit blocking behavior.
- [x] If safe, remove deprecated `ResolvedRepoSource.token` entirely.
- [x] Remove or simplify any tests that only existed to support the old token-threading path.
- [x] Search for remaining `token?: string` usage in repo intent / repo resolution code and eliminate it.
- [x] Search for remaining `githubRuntimeToken` / `refreshGithubToken` plumbing and eliminate it.

## Phase 7 — Verification and final pass

### Goal

Prove the refactor works end-to-end and leaves the codebase simpler.

### Tasks

- [x] Run targeted tests for helper, proxy route, ref resolver, landing page, runtime, and any migrated public metadata readers.
- [x] Run the full test suite.
- [x] Confirm signed-in public metadata reads use direct authenticated requests in `auto` mode.
- [x] Confirm signed-out public metadata reads use proxy in `auto` mode when proxy is enabled.
- [x] Confirm signed-out public metadata reads fall back to direct anonymous requests in `auto` mode when proxy is disabled.
- [x] Confirm signed-in/private repo flows use direct authenticated requests in `auto` mode.
- [x] Confirm signed-out/private repo flows use direct anonymous requests in `auto` mode.
- [x] Confirm repo resolution no longer depends on raw token threading.
- [x] Confirm runtime repo reads pick up auth changes without manual refresh plumbing.
- [x] Confirm no stateful client-side rate-limit controller remains in the final architecture.
- [x] Confirm `just-github` contains no proxy-mode logic.
- [x] If any of these checks fail and the next step is unclear, use `ask_user` before making a scope-changing decision.

---

## Definition of done

The plan is complete when all of the following are true:

- [x] `githubApiFetch(...)` is the single app-level GitHub transport helper.
- [x] direct auth is resolved internally by the helper from `access`, not from raw token arguments.
- [x] `transport` is optional and defaults to `auto`.
- [x] omitting `transport` behaves exactly like `transport: "auto"`.
- [x] in `auto`, direct authenticated requests win when auth is available.
- [x] proxy mode exists in the helper and is public-only in v1.
- [x] one generic public GitHub proxy route exists and is allowlisted.
- [x] public GitHub metadata reads use the helper/proxy instead of bespoke routes where appropriate.
- [x] `just-github` remains direct-only.
- [x] `RepoPathIntent` and `ResolvedRepoLocation` no longer carry `token`.
- [x] route/UI repo-entry flows no longer fetch/pass raw GitHub tokens.
- [x] runtime direct repo access resolves auth lazily.
- [x] worker/runtime token snapshot plumbing is deleted or clearly deprecated and unused.
- [x] no long-term stateful client-side rate-limit controller remains.
- [x] full test suite passes.

---

## If a question comes up during implementation

Do **not** guess. Use `ask_user` if any of these happen:

- a needed proxy endpoint is not in the v1 allowlist
- the env variable names conflict with project conventions
- a public GitHub consumer is ambiguous about whether it should migrate now
- removing `ResolvedRepoSource.token` in the same PR looks risky
- proxy route path shape needs to change from `/api/github/$`
- private-repo proxy support becomes tempting during implementation

That is the full implementation plan. Do **not** implement from this file directly without checking off tasks phase by phase.
