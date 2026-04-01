# Multi-Repo Runtime Research

## Why this doc exists

Reason:

- a real user question is not always "what is in repo A?"
- sometimes it is "how do I integrate feature X from repo A into repo B?"
- that requires one session to inspect more than one repo at once
- frontend can stay single-repo for now
- this doc is only about runtime, shell, filesystem, tool, and storage implications

## TL;DR

Short answer:

- `just-github` does **not** block multiple repos in one session
- `just-bash` core shell **does** run in the browser
- the app **currently** hardcodes one repo per session/runtime/tool set
- the cleanest runtime shape is a **single bash instance over a mounted multi-repo filesystem**
- the main blocker is not `GitHubFs`
- the main blockers are:
  - current app runtime types assume one `GitHubFs`
  - current tools assume one "active repository"
  - current bash error plumbing depends on `GitHubFs.consumeLastError()`
  - published `just-bash/browser` does **not** expose `MountableFs`

Best implementation path if we want this:

1. move app runtime from `GitHubFs`-specific to generic `IFileSystem`
2. introduce a browser-safe mounted FS in app code
3. mount each repo under a stable alias like `/repos/a` and `/repos/b`
4. keep one bash runtime + namespaced absolute paths
5. optionally keep `read` path-based, or add an explicit repo alias param

## What the current app assumes

### 1. Session data stores one repo

`SessionData` has one optional `repoSource`, not a list.

```ts
// src/types/storage.ts:31-46
export interface SessionData {
  // ...
  repoSource?: RepoSource
  // ...
}
```

`RepoSource` itself is one `{ owner, repo, ref }` triple.

```ts
// src/types/storage.ts:10-15
export interface RepoSource {
  owner: string
  repo: string
  ref: string
  token?: string
}
```

Implication:

- multi-repo is impossible without changing persisted session shape

### 2. Runtime construction is single-repo

`createRepoRuntime()` constructs exactly one `GitHubFs` and exactly one `Bash`.

```ts
// src/repo/repo-runtime.ts:35-56
export function createRepoRuntime(
  source: RepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime {
  // ...
  const fs = new GitHubFs({
    owner: withToken.owner,
    ref: withToken.ref,
    repo: withToken.repo,
    token: withToken.token,
  })
  const bash = new Bash({
    cwd: "/",
    fs,
  })
```

`RepoRuntime` is typed around one `GitHubFs`.

```ts
// src/repo/repo-types.ts:5-13
export interface RepoRuntime {
  bash: Bash
  fs: GitHubFs
  getCwd(): string
  getWarnings(): string[]
  refresh(): void
  setCwd(next: string): void
  source: RepoSource
}
```

Implication:

- even if a composite FS exists, current runtime types reject it

### 3. Worker runtime holds one repo runtime

`WorkerAgentRunner` creates one runtime from one `session.repoSource`.

```ts
// src/agent/runtime-worker.ts:68-88
this.githubRuntimeTokenSnapshot = options?.githubRuntimeToken
this.repoRuntime = this.createRuntime(session.repoSource)

this.agent = new Agent({
  // ...
  initialState: buildInitialAgentState(
    session,
    messages,
    model,
    this.getAgentTools(this.repoRuntime)
  ),
```

Token refresh also recreates one runtime:

```ts
// src/agent/runtime-worker.ts:176-185
this.githubRuntimeTokenSnapshot = token
this.repoRuntime = this.createRuntime(this.session.repoSource, token)
this.agent.setTools(this.getAgentTools(this.repoRuntime))
```

Implication:

- runtime/session lifecycle is built around one repo snapshot

### 4. Tools assume one active repo

`read`:

```ts
// src/tools/read.ts:25-27
path: Type.String({
  description: "Path to the file to read from the active repository",
}),
```

and:

```ts
// src/tools/read.ts:39-45
function resolveReadPath(runtime: RepoRuntime, path: string): string {
  if (path.startsWith("/")) {
    return path
  }

  return runtime.fs.resolvePath(runtime.getCwd(), path)
}
```

`bash`:

```ts
// src/tools/bash.ts:40-43
"Run a command in the repo's read-only virtual shell (browser snapshot). " +
"Banned: writes, installs, network, git, node/npm/python/sqlite/curl. " +
"OK: pipes + grep/sed/awk/cat/head/tail/ls/find."
```

Implication:

- semantics are single-root, single-cwd, single-active-repo

### 5. Error plumbing is GitHubFs-specific

`bash` error recovery reaches into `runtime.fs.consumeLastError()`:

```ts
// src/tools/bash.ts:25-33
function takeActionableGithubError(runtime: RepoRuntime): GitHubFsError | undefined {
  const error = runtime.fs.consumeLastError()

  if (!error) {
    return undefined
  }

  return error.code === "EACCES" || error.code === "EIO" ? error : undefined
}
```

Implication:

- current runtime does not merely need "an IFileSystem"
- it needs "a GitHubFs with side-channel error state"

That is the largest design smell for multi-repo runtime.

## What `MountableFs` actually does

## Package surface

The package docs describe `MountableFs` as a unified namespace over multiple filesystems.

```ts
// node_modules/just-bash/dist/fs/mountable-fs/mountable-fs.d.ts:21-34
/**
 * A filesystem that supports mounting other filesystems at specific paths.
 *
 * This allows combining multiple filesystem backends into a unified namespace.
 */
export declare class MountableFs implements IFileSystem {
```

It supports:

- `mount()`
- `unmount()`
- path routing
- merged `readdir()`
- `cp()` / `mv()` across mounts
- `realpath()`
- `getAllPaths()`

```ts
// node_modules/just-bash/dist/fs/mountable-fs/mountable-fs.d.ts:39-115
mount(mountPoint: string, filesystem: IFileSystem): void;
unmount(mountPoint: string): void;
readFile(...)
readdir(...)
cp(src: string, dest: string, options?: CpOptions): Promise<void>;
mv(src: string, dest: string): Promise<void>;
resolvePath(base: string, path: string): string;
getAllPaths(): string[];
realpath(path: string): Promise<string>;
```

## Runtime behavior from the published implementation

The npm package does not ship readable TS source for `MountableFs`, but the runtime class can be introspected. Relevant behavior:

### Mount validation

`MountableFs` forbids:

- mounting at `/`
- mounting inside an existing mount
- mounting a path that would contain an existing mount
- mount points containing `.` or `..`

Snippet from the actual runtime class:

```ts
validateMountPath(t) {
  let s = t.split("/");
  for (let r of s)
    if (r === "." || r === "..")
      throw new Error(`Invalid mount point '${t}': contains '.' or '..' segments`);
}

validateMount(t) {
  if (t === "/")
    throw new Error("Cannot mount at root '/'");
  for (let s of this.mounts.keys())
    if (s !== t) {
      if (t.startsWith(`${s}/`))
        throw new Error(`Cannot mount at '${t}': inside existing mount '${s}'`);
      if (s.startsWith(`${t}/`))
        throw new Error(`Cannot mount at '${t}': would contain existing mount '${s}'`);
    }
}
```

Good:

- alias collisions are prevented cleanly

### Path routing

It picks the longest matching mount prefix.

```ts
routePath(t) {
  let s = normalize(t), r = null, n = 0;
  for (let i of this.mounts.values()) {
    let o = i.mountPoint;
    if (s === o)
      return { fs: i.filesystem, relativePath: "/" };
    s.startsWith(`${o}/`) && o.length > n && (r = i, n = o.length);
  }
  if (r) {
    let i = s.slice(n);
    return { fs: r.filesystem, relativePath: i || "/" };
  }
  return { fs: this.baseFs, relativePath: s };
}
```

Good:

- repo mounts like `/repos/a` and `/repos/b` work naturally
- nested absolute paths are routed deterministically

### Directory merging

`readdir()` merges:

- real entries from the routed filesystem
- immediate child mount points

That means:

- `ls /repos` can show `a` and `b` even if `/repos` lives in the base FS

### Cross-mount copy

`cp()` falls back to `crossMountCopy()` when source and destination are different mounted filesystems.

Behavior:

- file copy reads source bytes and writes destination bytes
- directory copy requires `recursive`
- symlink copy recreates the link

Implication:

- cross-mount shell operations are possible in principle
- but destination FS must support writes

For two mounted `GitHubFs` instances:

- repo A -> repo B copy will fail because `GitHubFs.writeFile()` throws `EROFS`
- repo A -> writable workspace mount would work

## Does `GitHubFs` fit under a mounted FS?

Mostly yes.

Why:

- `GitHubFs` implements the `IFileSystem` shape used by `Bash`
- it already supports `readFile`, `readFileBuffer`, `exists`, `stat`, `lstat`, `readdir`, `realpath`, `resolvePath`, `getAllPaths`
- write methods are present and throw `EROFS`, which is valid read-only behavior

Relevant code:

```ts
// just-github/src/github-fs.ts:254-258
getAllPaths(): string[] {
  return this.treeCache.allPaths();
}

resolvePath(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  // ...
}
```

and:

```ts
// just-github/src/github-fs.ts:263-305
async writeFile(): Promise<void> {
  throw new GitHubFsError("EROFS", "Read-only filesystem");
}
// appendFile/mkdir/rm/cp/mv/chmod/symlink/link same pattern
```

Conclusion:

- nothing in `GitHubFs` fundamentally blocks mounting multiple repo filesystems

## What is actually blocking us

### 1. `just-bash/browser` does not expose `MountableFs`

The current app imports `Bash` from `just-bash/browser`.

```ts
// src/repo/repo-runtime.ts:1
import { Bash } from "just-bash/browser"
```

The browser entrypoint explicitly exports `Bash` and `InMemoryFs`, but not `MountableFs`.

```ts
// node_modules/just-bash/dist/browser.d.ts:12-22
export { Bash } from "./Bash.js";
export { InMemoryFs } from "./fs/in-memory-fs/index.js";
// no MountableFs export here
```

Package exports also map browser builds to `dist/bundle/browser.js`.

```json
// node_modules/just-bash/package.json:16-31
"exports": {
  ".": {
    "browser": "./dist/bundle/browser.js",
    "import": {
      "default": "./dist/bundle/index.js"
    }
  },
  "./browser": {
    "import": "./dist/bundle/browser.js"
  }
}
```

Observed locally:

- `import("just-bash")` in Node exposes `MountableFs`
- `import("just-bash/browser")` does not
- grep on `dist/bundle/browser.js` did not find a `MountableFs` symbol

Conclusion:

- off-the-shelf browser mounting is **not available through the current app import surface**

This is a packaging/export problem, not a conceptual shell problem.

### 2. Repo runtime type is too concrete

`RepoRuntime.fs` is `GitHubFs`, not `IFileSystem`.

That blocks:

- `MountableFs`
- any local browser-safe `MultiRepoFs`
- any future wrapper FS that aggregates errors/warnings

### 3. Error plumbing assumes one underlying `GitHubFs`

Current bash error path:

- clear one `GitHubFs` error slot
- run bash
- inspect one `GitHubFs.consumeLastError()`

That does not scale to:

- multiple mounted `GitHubFs`
- mounted `baseFs` + repo mounts
- generic `IFileSystem`

### 4. Rate limiting is per-client instance

Each `GitHubClient` owns its own `GitHubRateLimitController`.

```ts
// just-github/src/github-client.ts:43-50
export class GitHubClient {
  // ...
  private readonly rateLimitController = new GitHubRateLimitController();
  rateLimit: RateLimitInfo | null = null;
```

`GitHubRateLimitController` stores mutable local state:

```ts
// just-github/src/github-rate-limit.ts:17-19
export class GitHubRateLimitController {
  private blockedUntilMs = 0;
  private secondaryBackoffMs = SECONDARY_RATE_LIMIT_FLOOR_MS;
```

Implication:

- two mounted repos using the same PAT would each locally think they own rate-limit state
- GitHub rate limit is really shared by token/IP, not by repo client instance

This is not a blocker for correctness, but it is a runtime-quality issue.

Likely effect:

- one repo client may still fire requests while another has already detected a block

### 5. Warnings are per-runtime, not per-mount

Current runtime warning model:

- `RepoRuntime.getWarnings()` proxies one `GitHubFs.warnings`

That does not fit:

- repo A truncated tree
- repo B healthy

We would need:

- aggregated warnings
- mount-qualified warning source

### 6. `getAllPaths()` is lazy

`GitHubFs.getAllPaths()` only returns loaded tree-cache paths.

If tree has not loaded yet, it returns little or nothing.

This is already true in single-repo mode.

It matters because `just-bash` uses `fs.getAllPaths()` for some wildcard-heavy operations in the browser bundle.

Implication:

- mounted multi-repo FS is compatible
- but wildcard/path-discovery semantics will still inherit GitHubFs laziness

This is not a new blocker. It is an existing property that becomes more visible with multiple mounts.

## Runtime implementation options

## Option A. Multiple independent repo runtimes + namespaced tools

Shape:

- keep `GitHubFs` and `Bash` one-per-repo
- create tools like:
  - `read_repo_a`
  - `bash_repo_a`
  - `read_repo_b`
  - `bash_repo_b`

Pros:

- smallest runtime change
- no dependency on `MountableFs`
- no generic FS refactor required
- repo-specific warnings/errors stay isolated

Cons:

- no single shell namespace
- no direct cross-repo shell commands like `diff -ru /repo-a /repo-b`
- tool surface grows with repo count
- agent planning gets worse

Verdict:

- easiest implementation
- worst shell ergonomics

## Option B. Single bash over mounted multi-repo FS

Shape:

- one shell
- one composite FS
- repo mounts such as:
  - `/repos/a`
  - `/repos/b`
- cwd can move anywhere across mounts

Pros:

- best shell model
- cross-repo shell commands become natural
- only one bash tool
- paths become explicit and deterministic

Cons:

- requires browser-safe mounted FS support
- requires runtime types to stop depending on `GitHubFs`
- requires new error aggregation model
- requires warning aggregation model

Verdict:

- best long-term runtime shape
- preferred if we expect real multi-repo research workflows

## Option C. App-local browser-safe `MultiRepoFs`

Shape:

- implement our own mounted FS in app code
- copy/port the small `MountableFs` algorithm
- use `GitHubFs` mounts under `/repos/<alias>`
- use `InMemoryFs` as base FS if needed

Pros:

- avoids waiting on `just-bash` package export changes
- runtime code is small; the published `MountableFs` behavior is not large
- browser-safe by construction
- we can add error/warning hooks while implementing it

Cons:

- local maintenance burden
- behavior can drift from upstream `just-bash`
- we own testing

Verdict:

- probably the most pragmatic path for this app

## Option D. Patch/fork `just-bash` browser export

Shape:

- update dependency so browser bundle exports `MountableFs`
- use upstream primitive directly

Pros:

- less app-owned FS code
- behavior stays aligned with just-bash

Cons:

- dependency coordination
- maybe slower to land
- still does not solve app-specific error/warning aggregation

Verdict:

- good if we want upstream investment
- not required to prove product value

## What would need to change in the app

### 1. Session shape

Current:

```ts
repoSource?: RepoSource
```

Likely target:

```ts
type MountedRepoSource = RepoSource & {
  alias: string
  mountPoint: string
}

repoSources?: MountedRepoSource[]
activeRepoAlias?: string
```

Need:

- stable alias
- stable mount path
- maybe one "active" repo for convenience

### 2. Runtime types

Current:

```ts
export interface RepoRuntime {
  bash: Bash
  fs: GitHubFs
  source: RepoSource
}
```

Likely target:

```ts
import type { IFileSystem } from "just-bash/browser"

export interface RepoMountInfo {
  alias: string
  mountPoint: string
  source: RepoSource
  fs: GitHubFs
}

export interface RepoRuntime {
  bash: Bash
  fs: IFileSystem
  mounts: RepoMountInfo[]
  getCwd(): string
  setCwd(next: string): void
  getWarnings(): string[]
  refresh(alias?: string): void
}
```

Key change:

- generic `IFileSystem` at the top
- repo-specific metadata stored separately

### 3. Runtime factory

Current `createRepoRuntime()` should split into either:

- `createSingleRepoRuntime()`
- `createMultiRepoRuntime()`

or just one generalized factory.

Mounted shape:

```ts
const fs = new MultiRepoFs({ base: new InMemoryFs() })

for (const repo of repos) {
  fs.mount(`/repos/${repo.alias}`, new GitHubFs(/* ... */))
}

const bash = new Bash({
  cwd: `/repos/${defaultAlias}`,
  fs,
})
```

### 4. Error propagation

This is the main runtime refactor.

Current model:

- bash asks one `GitHubFs` for `consumeLastError()`

Needed model:

- runtime-owned error sink
- mounted FS wrapper reports which mount failed
- tools consume structured runtime errors, not side channels on a concrete FS instance

Possible shape:

```ts
type RepoFsErrorEvent = {
  alias: string
  mountPoint: string
  error: GitHubFsError
}

interface RepoRuntime {
  consumeLastError(): RepoFsErrorEvent | undefined
}
```

How to implement:

- wrap each mounted `GitHubFs` in a tiny adapter that records errors into a shared runtime queue
- or teach `MultiRepoFs` to capture mount-qualified errors when delegating

### 5. Warning aggregation

Need aggregated warnings with source labels.

Possible shape:

```ts
getWarnings(): string[] {
  return mounts.flatMap((mount) =>
    mount.fs.warnings.map((warning) => `[${mount.alias}] ${warning.message}`)
  )
}
```

### 6. Token model

Current runtime refresh logic assumes one runtime token snapshot.

Questions:

- is one global GitHub PAT enough? probably yes for most cases
- do we want per-repo tokens? currently `RepoSource.token` allows it

If we allow per-repo tokens:

- runtime refresh API gets more complex
- rate-limit and auth UX become mount-specific

For v1 runtime simplicity:

- one session-level PAT + optional per-repo override is enough

## What is not blocked

Important:

- multiple `GitHubFs` instances are fine
- one session can hold multiple lazy caches
- one shell can conceptually traverse mounted paths
- cross-repo compare/search commands are possible in a mounted namespace

Example commands that would work with a mounted runtime:

```bash
diff -ru /repos/a/src/feature /repos/b/src/feature
grep -R "useFeatureFlag" /repos/a /repos/b
find /repos/a /repos/b -name "*.ts"
```

What still would **not** work:

- writing back into GitHub repos through bash
- `cp /repos/a/file /repos/b/file` if destination is a `GitHubFs`

Why:

- `GitHubFs` is read-only

If we want writable scratch space:

- add a writable in-memory workspace mount like `/workspace`

Then:

```bash
cp /repos/a/src/foo.ts /workspace/foo.ts
diff -u /workspace/foo.ts /repos/b/src/foo.ts
```

## Recommended path

If we want this feature seriously, my recommendation is:

### Phase 1. Prove the runtime

- add `research-multirepo` spike branch
- implement app-local browser-safe `MultiRepoFs`
- mount two `GitHubFs` repos under `/repos/a` and `/repos/b`
- run one bash tool over that namespace

Do **not** start with storage/UI work.

### Phase 2. Generalize runtime types

- `RepoRuntime.fs` -> `IFileSystem`
- store `mounts: RepoMountInfo[]`
- replace `consumeLastError()` coupling

### Phase 3. Lift session shape

- `repoSource` -> `repoSources`
- add alias/mount metadata

## Best path vs smallest path

Smallest path:

- Option A: multiple repo-specific tools

Best path:

- Option C: app-local browser-safe mounted FS + one shell

Why I prefer C over A:

- user intent is cross-repo research
- shell namespace is the real primitive for that
- tool multiplication is the wrong abstraction
- published `MountableFs` logic is small enough to reproduce safely

## Open questions

- Should `/repos/<alias>` be the only mount scheme, or also `/active` symlink-like convenience?
- Do we want a writable scratch mount in v1 or read-only only?
- Do we want one shared rate-limit controller across all mounted GitHub clients using the same token?
- Should `read` remain path-only, or add an explicit `repo` alias param for convenience?

## Bottom line

There is no deep architectural law saying "one session can only have one repo."

The hard limits are local, not fundamental:

- storage shape
- runtime concreteness
- tool wording/assumptions
- GitHub error side-channel design
- browser export surface for mounting

The shell/filesystem model can support multi-repo work.

The clean version is:

- one session
- one shell
- many mounted repos
- explicit absolute paths

That is feasible, but it is a runtime refactor, not a UI toggle.
