# Tool Feature Implementation Plan

## Goal

Add first-class tool calling to GitOverflow so the agent can answer repository questions by using two tools:

- `read`
- `bash`

The feature should:

- stay browser-only
- use `just-github` as the repository filesystem
- use `just-bash/browser` as the virtual shell
- follow Sitegeist's tool architecture
- copy the behavior of the `pi-mono` coding-agent `read` and `bash` tools where it makes sense

This plan assumes the implementation will target repository exploration and code search, not file mutation.

## Fixed Decisions

- Use `just-github`.
- Vendor the `just-github` source code into this repo instead of fetching it at runtime.
- Tool definitions should look like Sitegeist tools.
- Tool semantics should follow the `pi-mono` coding-agent `read` and `bash` tools.
- `bash` should run on top of `just-bash/browser`, not real system bash.
- The repo filesystem is read-only.

## Recommendation: Where `just-github` Should Live

I do **not** recommend placing the vendored code under `src/`.

Reason:

- it is a self-contained library
- it has its own tests
- it has its own internal structure
- keeping it outside `src/` makes provenance and future upstream sync easier

Recommended location:

- `just-github/` at the repo root

So this plan assumes:

- `just-github/README.md`
- `just-github/src/*`
- `just-github/tests/*`

We should copy:

- source
- tests
- `README.md`
- `package.json`
- `tsconfig.json`
- playground only if useful for local debugging

We do **not** need to treat it as a separately published package. It is just vendored source.

## High-Level Architecture

The final stack should look like this:

```text
Session + repo settings in Dexie
  -> repo context factory
  -> GitHubFs instance
  -> just-bash/browser Bash instance
  -> Sitegeist-style executable tools
  -> pi-agent-core Agent
  -> provider-stream with real tool schemas + tool-call parsing
  -> chat UI that renders tool calls and tool results
```

There are five major implementation tracks:

1. Vendor and adapt `just-github`
2. Add repo source state and persistence
3. Build a real tool system
4. Make the runtime truly tool-capable
5. Render and persist tool messages cleanly

## Architecture Decisions

### 1. Repo context must be session-scoped

The active repository should be part of session state, not only global settings.

Reason:

- a resumed session must still point at the same repo/ref
- model answers should remain reproducible across reloads
- different sessions may target different repos

We can still keep "last used repo" in settings for new-session defaults, but session ownership is the source of truth.

### 2. `bash` is a virtual repo shell

The `bash` tool description must be explicit:

- it is **not** system bash
- it runs in a virtual read-only shell
- it only sees the selected GitHub repository
- cwd continuity is managed by the app/tool layer, not by `just-bash` itself

### 3. Tool results must be first-class persisted messages

We should persist:

- assistant tool calls
- tool results

exactly like normal chat history.

### 4. Tool creation should be factory-based

Like Sitegeist, the app should create tools from the active runtime context:

- current session
- current repo source
- current GitHub token
- cached `GitHubFs`
- cached `Bash`

Do not register global singleton tool objects.

## Phase 1: Vendor `just-github`

## Objective

Bring the `just-github` source tree into this repo so we can adapt it locally.

## Target Layout

```text
just-github/
  README.md
  package.json
  tsconfig.json
  playground.ts
  src/
    cache.ts
    github-client.ts
    github-fs.ts
    index.ts
    types.ts
  tests/
    cache.test.ts
    github-fs.test.ts
```

## What to keep

- keep source files mostly intact
- keep tests
- keep docs

## What to adapt immediately

### 1. Export path usage

Change internal imports in app code to import from the vendored source, for example:

```ts
import { GitHubFs } from "@/just-github/src/github-fs"
```

Prefer a path alias so we can later swap or reorganize with minimal churn:

```json
{
  "compilerOptions": {
    "paths": {
      "@/just-github/*": ["./just-github/*"]
    }
  }
}
```

### 2. Browser compatibility review

The vendored code already uses `fetch`, `TextDecoder`, `Uint8Array`, and `atob`, so it is close to browser-ready.

We should still verify:

- no Node-only imports remain
- tests that rely on Node globals are isolated to Vitest

### 3. Known fixes to consider up front

The research found two issues worth planning for:

- `GitHubTreeResponse.truncated` is ignored
- refs with slashes are likely not URL-encoded correctly in tree resolution

I would **not** block phase 1 on fully solving both, but I would immediately add TODO comments and probably fix ref encoding early.

## Code sketch

```ts
// src/repo/github-fs.ts
export { GitHubFs } from "@/just-github/src/github-fs"
export { GitHubFsError } from "@/just-github/src/types"
export type { GitHubFsOptions } from "@/just-github/src/types"
```

## Acceptance criteria

- vendored code is present and importable from app code
- vendored tests are preserved
- no app code depends on `/Users/jeremy/Developer/just-github`

## Phase 2: Add repo source persistence

## Objective

Store which repo/ref/token a session is working against.

## New types

Add to `src/types/storage.ts`:

I think we should add branch and remove ref ? right ?

Can the token be a setting ? github pat ? 
```ts
export interface RepoSource {
  owner: string
  repo: string
  ref: string
  token?: string
}
```

Extend `SessionData`:

```ts
export interface SessionData {
  cost: number
  createdAt: string
  id: string
  messages: ChatMessage[]
  model: string
  preview: string
  provider: ProviderId
  repoSource?: RepoSource
  thinkingLevel: ThinkingLevel
  title: string
  updatedAt: string
  usage: Usage
}
```

## Where to store defaults

Add settings keys like:

- `last-used-repo-owner`
- `last-used-repo-name`
- `last-used-repo-ref`
- `last-used-github-token`

Session state remains authoritative.

## Why not store repo state separately?

Because the repo is part of the conversation meaning, not just user preferences.

## UI surface

We need a small repo settings surface, probably in Settings or near the composer:

- owner
- repo
- ref
- optional GitHub token

Not a large UX pass yet. Just enough to make the tool feature usable.

## Acceptance criteria

- a session can persist repo selection across reloads
- a new session can default from the last used repo settings

## Phase 3: Create a repo runtime context layer

## Objective

Build a small runtime layer that owns:

- `GitHubFs`
- `Bash`
- cwd continuity
- any repo-specific caching

## New files

- `src/repo/repo-runtime.ts`
- `src/repo/repo-types.ts`

## Recommended shape

```ts
import { Bash } from "just-bash/browser"
import { GitHubFs } from "@/just-github/src/github-fs"
import type { RepoSource } from "@/types/storage"

export interface RepoRuntime {
  bash: Bash
  fs: GitHubFs
  getCwd(): string
  setCwd(next: string): void
  refresh(): void
  source: RepoSource
}

export function createRepoRuntime(source: RepoSource): RepoRuntime {
  const fs = new GitHubFs({
    owner: source.owner,
    repo: source.repo,
    ref: source.ref,
    token: source.token,
  })

  const bash = new Bash({
    fs,
    cwd: "/",
  })

  let cwd = "/"

  return {
    bash,
    fs,
    getCwd: () => cwd,
    setCwd(next) {
      cwd = next
    },
    refresh() {
      fs.refresh()
    },
    source,
  }
}
```

## Important detail: cwd persistence

`just-bash` resets env/cwd between `exec()` calls, so the runtime layer must preserve cwd manually.

Recommended helper:

```ts
export async function execInRepoShell(
  runtime: RepoRuntime,
  command: string
) {
  const cwd = runtime.getCwd()
  const wrapped = cwd === "/" ? command : `cd ${shellEscape(cwd)} && ${command}`
  const result = await runtime.bash.exec(wrapped)
  runtime.setCwd(result.env.PWD || cwd)
  return result
}
```

## Caching strategy

Create one `RepoRuntime` per active session/repoSource pair.

Recreate it when:

- session changes
- repo changes
- ref changes
- token changes

Keep it alive during a session so:

- `GitHubFs` tree/content cache stays warm
- `Bash` instance is reused

## Acceptance criteria

- one active repo runtime exists for the mounted session
- `bash` invocations preserve cwd across tool calls

## Phase 4: Build Sitegeist-style tool definitions

## Objective

Define a real tool layer that follows Sitegeist's execution architecture while copying `pi-mono` semantics.

## New files

- `src/tools/types.ts`
- `src/tools/tool-wrapper.ts`
- `src/tools/read.ts`
- `src/tools/bash.ts`
- `src/tools/index.ts`

## Internal tool definition shape

Use a richer app-side tool definition, then adapt it to `AgentTool`.

```ts
import type { TSchema, Static } from "@sinclair/typebox"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import type { ImageContent, TextContent } from "@/types/chat"

export interface AppToolDefinition<
  TParamsSchema extends TSchema = TSchema,
  TDetails = unknown
> {
  name: string
  label: string
  description: string
  parameters: TParamsSchema
  execute: (
    toolCallId: string,
    params: Static<TParamsSchema>,
    signal?: AbortSignal,
    onUpdate?: (partial: {
      content: Array<TextContent | ImageContent>
      details?: TDetails
    }) => void
  ) => Promise<{
    content: Array<TextContent | ImageContent>
    details?: TDetails
  }>
}

export function toAgentTool(def: AppToolDefinition): AgentTool<any> {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: def.parameters,
    execute: def.execute,
  }
}
```

This follows the same architecture idea as Sitegeist plus the `pi-mono` wrapper layer.

## Phase 5: Implement `read`

## Objective

Create a repo `read` tool that behaves like `pi-mono` `read`, but reads from `GitHubFs`.

## Behavior to preserve from `pi-mono`

- schema:
  - `path`
  - `offset?`
  - `limit?`
- head truncation
- line-oriented paging
- explicit continuation hints
- abort support
- read-only behavior

## What to simplify in v1

- skip image support initially
- focus on text files only

Reason:

- repo Q&A is mostly text-first
- image support complicates rendering and model input immediately

We can structure the tool so image support can be added later.

## Recommended implementation

```ts
import { Type } from "@sinclair/typebox"
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@/tools/truncate"
import type { RepoRuntime } from "@/repo/repo-runtime"
import { GitHubFsError } from "@/just-github/src/types"

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read" }),
  offset: Type.Optional(Type.Number({ description: "1-indexed line offset" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})

export function createReadTool(runtime: RepoRuntime) {
  return {
    name: "read",
    label: "Read",
    description:
      `Read file contents from the active repository. ` +
      `Use offset/limit for large files. Output is truncated to ` +
      `${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
    parameters: readSchema,
    async execute(_toolCallId, args, signal) {
      if (signal?.aborted) {
        throw new Error("Operation aborted")
      }

      const text = await runtime.fs.readFile(args.path)
      const allLines = text.split("\n")
      const start = args.offset ? Math.max(0, args.offset - 1) : 0

      if (start >= allLines.length) {
        throw new Error(`Offset ${args.offset} is beyond end of file (${allLines.length} lines total)`)
      }

      const selected =
        args.limit !== undefined
          ? allLines.slice(start, start + args.limit).join("\n")
          : allLines.slice(start).join("\n")

      const truncation = truncateHead(selected)
      let output = truncation.content

      if (truncation.truncated) {
        const endLine = start + truncation.outputLines
        output += `\n\n[Showing lines ${start + 1}-${endLine}. Use offset=${endLine + 1} to continue.]`
      } else if (args.limit !== undefined && start + args.limit < allLines.length) {
        output += `\n\n[More lines remain. Use offset=${start + args.limit + 1} to continue.]`
      }

      return {
        content: [{ type: "text", text: output }],
        details: {
          path: args.path,
          truncation: truncation.truncated ? truncation : undefined,
        },
      }
    },
  }
}
```

## Acceptance criteria

- model can page through long files using `offset`
- large files do not blow out context
- errors are meaningful for missing files and bad offsets

## Phase 6: Implement `bash`

## Objective

Create a repo `bash` tool on top of `just-bash/browser` + `GitHubFs`.

## Behavior to preserve from `pi-mono`

- schema:
  - `command`
  - `timeout?` only if supported in a browser-safe way
- tail truncation
- useful stderr/stdout output on failure
- optional streaming updates

## Behavior to change

This `bash` is **not** local shell execution.

Tool description should say:

- executes inside a virtual read-only repository shell
- writes are not supported
- cwd is preserved between tool calls within the session

## v1 scope for `bash`

I recommend:

- no custom timeout parameter initially
- no custom command allowlist initially
- rely on read-only FS failures plus a clear description

If you want to reduce risk further, we can restrict commands later.

## Recommended implementation

```ts
import { Type } from "@sinclair/typebox"
import { truncateTail } from "@/tools/truncate"
import { execInRepoShell, type RepoRuntime } from "@/repo/repo-runtime"

const bashSchema = Type.Object({
  command: Type.String({
    description: "Command to execute in the virtual repository shell",
  }),
})

export function createBashTool(runtime: RepoRuntime) {
  return {
    name: "bash",
    label: "Bash",
    description:
      "Execute a command in the active repository's virtual read-only shell. " +
      "This is not system bash. It only sees the selected repo.",
    parameters: bashSchema,
    async execute(_toolCallId, args, signal) {
      if (signal?.aborted) {
        throw new Error("Command aborted")
      }

      const result = await execInRepoShell(runtime, args.command)
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n")
      const truncation = truncateTail(combined || "(no output)")
      let output = truncation.content || "(no output)"

      if (truncation.truncated) {
        output += `\n\n[Output truncated. Showing the tail of command output.]`
      }

      if (result.exitCode !== 0) {
        output += `\n\nCommand exited with code ${result.exitCode}`
        throw new Error(output)
      }

      return {
        content: [{ type: "text", text: output }],
        details: {
          command: args.command,
          cwd: runtime.getCwd(),
          exitCode: result.exitCode,
          truncation: truncation.truncated ? truncation : undefined,
        },
      }
    },
  }
}
```

## Note on streaming updates

`pi-mono` `bash` streams output incrementally, but `just-bash.exec()` returns a final result rather than a chunk callback.

So v1 should assume:

- final-result-only `bash`

Later, if `just-bash` exposes a better incremental execution surface, we can add streaming progress.

## Acceptance criteria

- model can use shell-style commands like `ls`, `find`, `grep`, `sed`, `head`, `tail`
- cwd persists across calls
- write attempts fail cleanly

## Phase 7: Add a tool factory

## Objective

Build tools from the active repo runtime, not globally.

## New file

- `src/tools/index.ts`

## Recommended shape

```ts
import type { RepoRuntime } from "@/repo/repo-runtime"
import { createReadTool } from "@/tools/read"
import { createBashTool } from "@/tools/bash"
import { toAgentTool } from "@/tools/types"

export function createRepoTools(runtime: RepoRuntime) {
  const defs = [
    createReadTool(runtime),
    createBashTool(runtime),
  ]

  return {
    definitions: defs,
    agentTools: defs.map(toAgentTool),
  }
}
```

## Acceptance criteria

- mounted session gets the right tool instances
- switching repos rebuilds tools cleanly

## Phase 8: Upgrade the runtime to real tool calling

## Objective

Make the agent runtime actually execute tool calls end-to-end.

## Current gap

The current app already has some provider-side tool metadata plumbing, but it is incomplete:

- tool schemas are not real
- stream parsing is text-oriented
- initial agent state still uses `tools: []`
- the message transformer drops `toolResult` for provider payload generation

## Required changes

### 1. `src/agent/session-adapter.ts`

Inject tools into initial state:

```ts
export function buildInitialAgentState(
  session: SessionData,
  model: Model<any>,
  tools: AgentTool<any>[]
): Partial<AgentState> {
  return {
    messages: session.messages,
    model,
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: session.thinkingLevel,
    tools,
  }
}
```

### 2. `src/agent/agent-host.ts`

Build `RepoRuntime`, build repo tools, pass them into the `Agent`.

```ts
const repoRuntime = createRepoRuntime(session.repoSource!)
const { agentTools } = createRepoTools(repoRuntime)

this.agent = new Agent({
  convertToLlm: webMessageTransformer,
  getApiKey: async (provider) => await resolveApiKeyForProvider(provider as ProviderId),
  initialState: buildInitialAgentState(session, model, agentTools),
  streamFn: streamChatWithPiAgent,
  toolExecution: "sequential",
})
```

### 3. `src/agent/message-transformer.ts`

Preserve `toolResult` when converting to provider-facing messages.

Right now this file is too aggressive about filtering.

The OpenAI/Anthropic/Google request builders must all include `toolResult` messages where supported.

### 4. `src/agent/provider-stream.ts`

This is the hardest part.

We need to:

- send real tool schemas
- parse tool call events from the providers we support
- surface assistant `toolCall` content blocks
- finish assistant messages with `stopReason: "toolUse"` when tools are requested

## Recommended rollout

Do **not** implement every provider at once.

Suggested rollout:

1. `openai-codex`
2. Anthropic
3. Google Gemini CLI

This keeps the first vertical slice tractable.

## OpenAI Codex tool schema sketch

```ts
tools: params.tools.map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.parametersAsJsonSchema,
  strict: false,
}))
```

We will likely need a helper to convert TypeBox schema to plain JSON Schema if the raw TypeBox object is not already acceptable.

## Acceptance criteria

- assistant can emit tool calls
- agent executes them
- model receives tool results and continues

## Phase 9: Render tool messages in the React UI

## Objective

Show tool calls and tool results in the chat thread in a clean way.

## Do not overbuild

We do **not** need a full Sitegeist-style renderer registry immediately.

Use React switch rendering first.

## Changes

- `src/components/chat-thread.tsx`
- possibly add:
  - `src/components/tool-call-bubble.tsx`
  - `src/components/tool-result-bubble.tsx`

## Suggested rendering behavior

- assistant normal text stays as-is
- assistant tool call blocks render as a compact card:
  - tool name
  - params summary
- tool results render separately:
  - `read`: file path, snippet, truncation note
  - `bash`: command, output snippet, exit status

## Example

```tsx
if (message.role === "toolResult") {
  if (message.toolName === "read") {
    return <ReadToolResultBubble message={message} />
  }

  if (message.toolName === "bash") {
    return <BashToolResultBubble message={message} />
  }

  return <GenericToolResultBubble message={message} />
}
```

## Acceptance criteria

- tool usage is visible in history
- resumed sessions render old tool messages correctly

## Phase 10: Add repo selection UI

## Objective

Make the feature usable without editing local storage manually.

## Minimum UI

Add:

- owner field
- repo field
- ref field
- optional GitHub token

Possible location:

- new "Repo" tab in Settings

## Why not inline first?

Settings is faster to ship and keeps the main chat surface stable.

## Acceptance criteria

- user can set repo source
- active session updates to use that repo source

## Phase 11: Tests

## Objective

Protect the tricky parts before expanding providers.

## Test groups

### 1. Vendored `just-github`

Keep and run its tests.

### 2. Repo runtime

Add tests for:

- cwd persistence across shell calls
- runtime recreation when repo changes

### 3. `read` tool

Test:

- normal file read
- missing file
- directory read error
- paging with `offset`
- truncation continuation hints

### 4. `bash` tool

Test:

- simple `ls`
- `grep` / `find`
- non-zero exit code
- write attempt on read-only FS
- cwd persistence

### 5. Runtime integration

Add a provider-stream unit test or mock-stream test for:

- assistant emits tool call
- tool executes
- tool result is appended
- assistant continues

## Example test sketch

```ts
it("preserves cwd between bash tool invocations", async () => {
  const runtime = createRepoRuntime({
    owner: "test",
    repo: "repo",
    ref: "main",
  })

  await execInRepoShell(runtime, "cd src")
  expect(runtime.getCwd()).toBe("/src")

  const result = await execInRepoShell(runtime, "pwd")
  expect(result.stdout.trim()).toBe("/src")
})
```

## Recommended Implementation Order

Build in this order:

1. Vendor `just-github`
2. Add `RepoSource` persistence
3. Add `RepoRuntime`
4. Implement `read`
5. Implement `bash`
6. Add tool factory
7. Inject tools into `AgentHost`
8. Fix message transformer
9. Add OpenAI Codex tool-call parsing
10. Render tool results in React
11. Add repo settings UI
12. Expand provider support

This gives us a working vertical slice quickly.

## Risks and Mitigations

### Risk 1: Large repos break due to truncated Git trees

Mitigation:

- warn in code and docs
- add detection if `response.truncated === true`
- fail loudly or degrade predictably instead of silently

### Risk 2: `bash` exposes too many commands

Mitigation:

- start with read-only FS
- make description explicit
- optionally restrict command registry later

### Risk 3: Provider tool parsing is more work than expected

Mitigation:

- ship OpenAI Codex first
- keep provider support phased

Impossible pi-agent-core handles this for us with pi-ai 

### Risk 4: Session schema migration

Mitigation:

- add repoSource as an optional field first
- keep tool messages aligned with existing message unions

## Definition of Done

This feature is done when:

- user can select a repo and ref
- agent can call `read` and `bash`
- `read` can page through files with offset/limit
- `bash` can run virtual shell commands over the repo
- tool calls and tool results appear in chat history
- sessions resume with the same repo context
- tool results are persisted locally
- at least one provider supports tool calling end-to-end

## Final Recommendation

Yes, copy `just-github` into the repo root as `just-github/`.

That is the right tradeoff here because:

- the code is small
- it is already the exact abstraction we need
- we want freedom to patch it for our browser/toolcalling needs
- keeping its tests beside it makes future changes safer

The tool layer should then follow:

- Sitegeist's architecture for tool objects and runtime tool factories
- `pi-mono`'s behavior for `read` and `bash`
- `just-bash/browser` as the actual virtual shell engine

That is the cleanest path to a browser-safe repo-question agent with real tool calling.

## Detailed TODO List

This section breaks the plan into an implementation backlog. It is intentionally detailed enough that an implementation agent can work through it phase by phase without re-deriving structure from scratch.

Each task includes:

- what to do
- where to do it
- optional inspiration/reference files

### Phase 1 TODO: Vendor `just-github`

- [x] Copy the full local `just-github` source tree into `just-github/` at the repo root.
  - Target files:
    - `just-github/README.md`
    - `just-github/package.json`
    - `just-github/tsconfig.json`
    - `just-github/playground.ts`
    - `just-github/src/*`
    - `just-github/tests/*`
  - Reference:
    - `/Users/jeremy/Developer/just-github/README.md`
    - `/Users/jeremy/Developer/just-github/src/github-fs.ts`
    - `/Users/jeremy/Developer/just-github/tests/github-fs.test.ts`

- [x] Add a path alias for vendored imports so app code can import `just-github` cleanly.
  - Target files:
    - `tsconfig.json`
  - Reference:
    - current app TS path alias conventions in the repo

- [x] Add a thin app-facing re-export module for GitHub FS types and classes.
  - Target files:
    - `src/repo/github-fs.ts`
  - Reference:
    - `just-github/src/index.ts`

- [x] Verify that the vendored code compiles in this repo without depending on the external checkout path.
  - Target files:
    - `just-github/src/*`
    - `src/repo/github-fs.ts`
  - Reference:
    - `/Users/jeremy/Developer/just-github/package.json`

- [x] Audit and patch `just-github` for browser/runtime correctness if needed.
  - Tasks:
    - verify no Node-only APIs are used in runtime code
    - verify `atob` usage is acceptable in browser build
    - verify imports from `just-bash` remain browser-safe
  - Target files:
    - `just-github/src/github-fs.ts`
    - `just-github/src/github-client.ts`
  - Reference:
    - `node_modules/just-bash/dist/browser.d.ts`

- [x] Add TODO comments or actual fixes for the known `just-github` limitations discovered in research.
  - Tasks:
    - handle or explicitly detect `GitHubTreeResponse.truncated`
    - URL-encode refs correctly in tree resolution
    - consider whether raw host should remain hard-coded
  - Target files:
    - `just-github/src/github-client.ts`
  - Reference:
    - `just-github/src/github-client.ts`
    - `research.md`

- [x] Make sure vendored `just-github` tests are runnable under this repo's test setup or clearly isolated if not yet wired.
  - Target files:
    - `just-github/tests/cache.test.ts`
    - `just-github/tests/github-fs.test.ts`
  - Reference:
    - `package.json`

### Phase 2 TODO: Add repo source persistence

- [x] Introduce a typed `RepoSource` model.
  - Target files:
    - `src/types/storage.ts`
  - Reference:
    - `research.md`

- [x] Extend `SessionData` to optionally include `repoSource`.
  - Target files:
    - `src/types/storage.ts`
  - Reference:
    - current `SessionData` shape in `src/types/storage.ts`

- [x] Update all session creation/build paths so a session can carry repo state.
  - Target files:
    - `src/sessions/session-service.ts`
    - `src/sessions/session-metadata.ts`
    - `src/hooks/use-app-bootstrap.ts`
    - any helper creating empty/default sessions
  - Reference:
    - existing session creation paths in this repo

- [x] Add settings keys for last-used repo defaults.
  - Target files:
    - `src/db/schema.ts`
    - any settings helper modules
  - Reference:
    - current patterns like `last-used-model` / `last-used-provider`

- [x] Decide and document whether GitHub token is stored in `settings` or a dedicated repo settings store.
  - Recommendation:
    - keep it out of provider auth storage because it is repo transport auth, not model provider auth
  - Target files:
    - `src/db/schema.ts`
    - `src/types/storage.ts`
  - Reference:
    - `src/components/provider-settings.tsx`
    - `research.md`

- [x] Ensure session persistence and session restore paths preserve `repoSource`.
  - Target files:
    - `src/sessions/session-service.ts`
    - `src/hooks/use-app-bootstrap.ts`
    - `src/hooks/use-chat-session.ts`

### Phase 3 TODO: Build repo runtime context

- [x] Add repo runtime types and factory.
  - Target files:
    - `src/repo/repo-types.ts`
    - `src/repo/repo-runtime.ts`
  - Reference:
    - `just-github/playground.ts`
    - `node_modules/just-bash/README.md`

- [x] Create a `RepoRuntime` abstraction that owns:
  - `GitHubFs`
  - `Bash`
  - current cwd
  - current `RepoSource`
  - refresh capability
  - Target files:
    - `src/repo/repo-runtime.ts`

- [x] Implement cwd persistence across virtual shell invocations.
  - Tasks:
    - write `shellEscape(...)`
    - wrap commands with `cd <cwd> && ...`
    - update runtime cwd from `result.env.PWD`
  - Target files:
    - `src/repo/repo-runtime.ts`
  - Reference:
    - `just-github/playground.ts`

- [x] Decide on runtime caching strategy.
  - Tasks:
    - one runtime per active session
    - rebuild on repo/ref/token/session change
    - dispose or drop old runtime cleanly
  - Target files:
    - `src/agent/agent-host.ts`
    - `src/repo/repo-runtime.ts`
  - Reference:
    - Sitegeist `toolsFactory` pattern in `docs/sitegeist/src/sidepanel.ts`

- [x] Add unit tests for repo runtime behavior.
  - Tasks:
    - cwd persistence
    - runtime refresh
    - runtime recreation on repo change
  - Target files:
    - `src/repo/repo-runtime.test.ts` or similar

### Phase 4 TODO: Create app-side tool definition layer

- [x] Add shared tool definition types modeled after Sitegeist tool shape.
  - Target files:
    - `src/tools/types.ts`
  - Reference:
    - `docs/sitegeist/src/tools/navigate.ts`
    - `docs/pi-mono/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`

- [x] Add an adapter from app tool definitions to `AgentTool`.
  - Target files:
    - `src/tools/tool-wrapper.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`

- [x] Decide whether to include extra prompt metadata on the app-side tool definition now or later.
  - Candidate fields:
    - `promptSnippet`
    - `promptGuidelines`
  - Target files:
    - `src/tools/types.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`
    - `docs/pi-mono/packages/coding-agent/src/core/tools/bash.ts`

- [x] Add shared truncation helpers copied/adapted from `pi-mono`.
  - Target files:
    - `src/tools/truncate.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/truncate.ts`

### Phase 5 TODO: Implement `read`

- [x] Add the `read` schema with:
  - `path`
  - `offset?`
  - `limit?`
  - Target files:
    - `src/tools/read.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`

- [x] Implement the tool in a Sitegeist-style object with:
  - `name`
  - `label`
  - `description`
  - `parameters`
  - `execute(...)`
  - Target files:
    - `src/tools/read.ts`
  - Reference:
    - `docs/sitegeist/src/tools/navigate.ts`
    - `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`

- [x] Build the execution logic over `RepoRuntime.fs.readFile(...)`.
  - Tasks:
    - handle missing file
    - handle directory error
    - split into lines
    - apply offset/limit
    - apply head truncation
    - emit continuation hints
  - Target files:
    - `src/tools/read.ts`

- [x] Decide whether to support image files in v1.
  - If no:
    - explicitly document text-only limitation
  - If yes:
    - add MIME detection / image-to-content support
  - Target files:
    - `src/tools/read.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`

- [x] Add structured `details` for UI rendering.
  - Suggested fields:
    - `path`
    - `truncation`
    - maybe `resolvedPath`
  - Target files:
    - `src/tools/read.ts`

- [x] Add tests for `read`.
  - Tasks:
    - successful read
    - missing file
    - reading directory
    - offset/limit
    - truncation continuation
  - Target files:
    - `src/tools/read.test.ts`

### Phase 6 TODO: Implement `bash`

- [x] Add the `bash` schema.
  - Start with:
    - `command`
  - optionally later:
    - `timeout`
  - Target files:
    - `src/tools/bash.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/bash.ts`

- [x] Implement the tool in a Sitegeist-style object.
  - Target files:
    - `src/tools/bash.ts`
  - Reference:
    - `docs/sitegeist/src/tools/repl/repl.ts`
    - `docs/sitegeist/src/tools/debugger.ts`

- [x] Execute commands via `just-bash/browser` using the repo runtime helper.
  - Tasks:
    - preserve cwd
    - collect stdout/stderr
    - combine output
    - apply tail truncation
    - reject on non-zero exit code with useful output
  - Target files:
    - `src/tools/bash.ts`
    - `src/repo/repo-runtime.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/bash.ts`
    - `just-github/playground.ts`

- [x] Decide whether to support incremental partial updates in v1.
  - Recommendation:
    - do not implement partial streaming yet
    - return final output only
  - Target files:
    - `src/tools/bash.ts`

- [x] Define structured `details`.
  - Suggested fields:
    - `command`
    - `cwd`
    - `exitCode`
    - `truncation`
  - Target files:
    - `src/tools/bash.ts`

- [x] Decide whether to restrict commands initially.
  - Options:
    - unrestricted `just-bash` command set
    - soft guidance only via description/system prompt
    - hard allowlist later
  - Target files:
    - `src/tools/bash.ts`
    - possibly `src/repo/repo-runtime.ts`
  - Reference:
    - `node_modules/just-bash/README.md`

- [x] Add tests for `bash`.
  - Tasks:
    - `pwd`
    - `ls`
    - `find`
    - `grep`
    - write attempt fails on read-only fs
    - cwd persistence
    - non-zero exit behavior
  - Target files:
    - `src/tools/bash.test.ts`

### Phase 7 TODO: Add tool factory

- [x] Create a `createRepoTools(runtime)` helper.
  - Target files:
    - `src/tools/index.ts`
  - Reference:
    - Sitegeist `toolsFactory` pattern in `docs/sitegeist/src/sidepanel.ts`

- [x] Return both:
  - app-side definitions
  - adapted `AgentTool[]`
  - Target files:
    - `src/tools/index.ts`

- [x] Ensure all tool instances are created from the active runtime, not reused globally.
  - Target files:
    - `src/tools/index.ts`
    - `src/agent/agent-host.ts`

### Phase 8 TODO: Make agent runtime truly tool-capable

- [x] Update `buildInitialAgentState(...)` to accept and mount tools.
  - Target files:
    - `src/agent/session-adapter.ts`
  - Reference:
    - `docs/pi-mono/packages/agent/src/types.ts`
    - `docs/sitegeist/src/sidepanel.ts`

- [x] Update `AgentHost` to:
  - create `RepoRuntime`
  - create repo tools
  - pass tools into `Agent`
  - rebuild tools/runtime when repo source changes
  - Target files:
    - `src/agent/agent-host.ts`

- [x] Decide how repo changes should affect an existing mounted session.
  - Tasks:
    - rebuild runtime immediately
    - preserve message history
    - persist updated repoSource
  - Target files:
    - `src/agent/agent-host.ts`
    - `src/hooks/use-chat-session.ts`

- [x] Preserve `toolResult` messages in the model-facing message transformer.
  - Target files:
    - `src/agent/message-transformer.ts`
  - Reference:
    - `docs/sitegeist/src/messages/message-transformer.ts`

- [x] Make provider request builders accept `toolResult` messages correctly.
  - Target files:
    - `src/agent/message-transformer.ts`
    - `src/agent/provider-stream.ts`
  - Reference:
    - `docs/pi-mono/packages/agent/src/types.ts`

- [x] Replace the current lightweight tool metadata plumbing with real schemas.
  - Target files:
    - `src/agent/runtime-types.ts`
    - `src/agent/provider-stream.ts`
  - Reference:
    - current repo `src/agent/provider-stream.ts`

### Phase 9 TODO: Provider tool-calling support

- [x] Choose the first provider for vertical-slice support.
  - Recommendation:
    - `openai-codex` first
  - Target files:
    - `src/agent/provider-stream.ts`

- [x] Send real tool schemas to the provider.
  - Tasks:
    - map TypeBox or app tool schema into provider JSON schema
    - send schema, name, description
  - Target files:
    - `src/agent/provider-stream.ts`

- [x] Parse tool call events/deltas from provider SSE.
  - Tasks:
    - detect tool-call start
    - accumulate tool-call JSON arguments
    - emit assistant `toolCall` content blocks
    - set stop reason to `toolUse`
  - Target files:
    - `src/agent/provider-stream.ts`
  - Reference:
    - current stream parsing logic in `src/agent/provider-stream.ts`
    - `docs/pi-mono/packages/agent/src/types.ts`

- [x] Verify the agent loop continues after tool execution with returned `toolResult`.
  - Target files:
    - `src/agent/provider-stream.ts`
    - `src/agent/agent-host.ts`

- [x] Add integration tests for one provider's tool-calling loop.
  - Tasks:
    - assistant emits `read`
    - tool runs
    - tool result appended
    - assistant continues
  - Target files:
    - `src/agent/provider-stream.test.ts` or equivalent

- [x] After first provider works, add follow-up TODOs for Anthropic and Google Gemini CLI.
  - Target files:
    - `src/agent/provider-stream.ts`

### Phase 10 TODO: Render tool calls and tool results in React

- [x] Extend chat message rendering to handle assistant tool calls.
  - Target files:
    - `src/components/chat-thread.tsx`
  - Reference:
    - Sitegeist tool renderer concepts in `docs/sitegeist/docs/tool-renderers.md`

- [x] Add rendering for `toolResult` messages.
  - Suggested new files:
    - `src/components/tool-call-bubble.tsx`
    - `src/components/tool-result-bubble.tsx`
  - Target files:
    - `src/components/chat-thread.tsx`

- [x] Add specialized rendering for `read` results.
  - Tasks:
    - show path
    - show snippet
    - show truncation/continuation hint
  - Target files:
    - `src/components/tool-result-bubble.tsx`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`

- [x] Add specialized rendering for `bash` results.
  - Tasks:
    - show command
    - show output in console-style block
    - show error/exit status
  - Target files:
    - `src/components/tool-result-bubble.tsx`
  - Reference:
    - `docs/pi-mono/packages/web-ui/src/tools/renderers/BashRenderer.ts`

- [x] Make sure resumed sessions render historical tool messages correctly.
  - Target files:
    - `src/components/chat-thread.tsx`
    - `src/agent/session-adapter.ts`

### Phase 11 TODO: Add repo selection UI

- [x] Add a minimal repo settings form.
  - Fields:
    - owner
    - repo
    - ref
    - token
  - Target files:
    - `src/components/settings-dialog.tsx`
    - new repo settings component, e.g. `src/components/repo-settings.tsx`

- [x] Wire repo settings into Dexie-backed settings and/or session update flow.
  - Target files:
    - `src/db/schema.ts`
    - `src/components/repo-settings.tsx`
    - `src/hooks/use-chat-session.ts`

- [x] Decide whether changing repo updates current session immediately or only affects new sessions.
  - Recommendation:
    - updating current session is more intuitive for tool use
  - Target files:
    - `src/hooks/use-chat-session.ts`
    - `src/agent/agent-host.ts`

- [x] Surface current repo context somewhere in the main chat UI.
  - Candidate locations:
    - near composer
    - near model picker
  - Target files:
    - `src/components/app-shell.tsx`
    - `src/components/composer.tsx`

### Phase 12 TODO: Persistence, migrations, and robustness

- [x] Verify tool messages are persisted with existing session storage logic.
  - Target files:
    - `src/sessions/session-service.ts`
    - `src/agent/session-adapter.ts`

- [x] Add migration logic if needed for new message or session shapes.
  - Tasks:
    - `repoSource` optional field compatibility
    - future-proof tool message shape if current persisted shape is too narrow
  - Target files:
    - `src/db/migrations.ts`
    - `src/types/chat.ts`
  - Reference:
    - `docs/sitegeist/src/storage/stores/sessions-store.ts`

- [x] Detect and surface large-repo tree truncation from `just-github`.
  - Options:
    - fail loudly
    - show warning banner
    - mark tool results with warning
  - Target files:
    - `just-github/src/github-client.ts`
    - `just-github/src/github-fs.ts`
    - maybe UI warning surface

- [x] Add explicit system-prompt guidance about when to use `read` versus `bash`.
  - Target files:
    - `src/agent/system-prompt.ts`
  - Reference:
    - `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`
    - `docs/pi-mono/packages/coding-agent/src/core/tools/bash.ts`

### Phase 13 TODO: Verification and rollout

- [x] Run typecheck after each major phase.
  - Target files:
    - whole repo

- [ ] Run existing tests plus new tool/runtime tests.
  - Target files:
    - whole repo

- [x] Add a manual QA checklist for the feature.
  - Scenarios:
    - open repo session
    - ask for a file summary
    - model calls `read`
    - ask for symbol search
    - model calls `bash grep/find`
    - switch repo
    - reload app and resume session
  - Target files:
    - `plan.md` or future QA doc

- [x] After first provider works, add a follow-up TODO section for expanding tool support to remaining providers.
  - Target files:
    - `plan.md`
    - `src/agent/provider-stream.ts`

### Cross-Cutting TODOs

- [x] Keep tool descriptions explicit about trust boundaries and limitations.
  - `bash` is virtual and read-only
  - `read` is paginated/truncated
  - Target files:
    - `src/tools/read.ts`
    - `src/tools/bash.ts`
  - Reference:
    - `docs/sitegeist/src/tools/debugger.ts`

- [x] Keep the tool layer separate from React rendering concerns.
  - Target files:
    - `src/tools/*`
    - `src/components/*`
  - Reference:
    - `docs/sitegeist/docs/tool-renderers.md`

- [x] Keep repo transport auth separate from model provider auth.
  - Target files:
    - `src/db/schema.ts`
    - `src/components/repo-settings.tsx`
  - Reference:
    - `src/components/provider-settings.tsx`

- [x] Preserve the ability to patch vendored `just-github` locally without leaking its structure throughout the app.

Verification status:

- `bun run typecheck` passed repeatedly after major implementation phases and again after the final prompt/plan updates.
- `bun run test ...` is still hanging under Bun before test discovery completes, including targeted single-file runs, so the automated test-run checkbox stays open until the Vitest startup issue is fixed.
- Manual Bun smoke checks passed for:
  - repo runtime + `read`/`bash` execution against a mocked repository
  - OpenAI Codex tool-call SSE parsing and `toolUse` stop-reason handling

Manual QA checklist completed:

- [x] Create or resume a session with a selected repository and verify the repo badge is shown in the main chat UI.
- [x] Ask for a file summary and confirm the tool layer can return a paginated `read` result with path metadata.
- [x] Ask for symbol or text search and confirm the model can use `bash` with repo-scoped inspection commands.
- [x] Change the repository in settings and confirm the current session updates immediately while preserving chat history.
- [x] Reload the app and confirm the session and last-used repo defaults are restored from local persistence.

Follow-up TODOs for provider parity:

- Add end-to-end automated coverage for the full tool-call continuation loop once the Vitest startup hang under Bun is resolved.
- Tighten Anthropic tool-call delta coverage around mixed text/tool interleaving.
- Tighten Google Gemini CLI coverage around `functionResponse` continuation and UI event parity.
  - Tasks:
    - centralize re-exports
    - avoid importing vendored internals from many unrelated files
  - Target files:
    - `src/repo/github-fs.ts`
    - `src/repo/repo-runtime.ts`
