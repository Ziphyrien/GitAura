# Sitegeist Web v0 Implementation Plan

This document turns [SPEC.md](/Users/jeremy/Developer/gitoverflow/SPEC.md) into an implementation plan for the current repository.

The repo is currently a minimal TanStack Start app with:

- a placeholder `/` route in [src/routes/index.tsx](/Users/jeremy/Developer/gitoverflow/src/routes/index.tsx)
- a root document in [src/routes/__root.tsx](/Users/jeremy/Developer/gitoverflow/src/routes/__root.tsx)
- an empty Dexie stub in [src/db/dexie.ts](/Users/jeremy/Developer/gitoverflow/src/db/dexie.ts)

The plan below assumes we will build the runtime directly inside this app, while copying or adapting logic from:

- [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [docs/sitegeist/src/oauth/openai-codex.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/openai-codex.ts)
- [docs/sitegeist/src/oauth/browser-oauth.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/browser-oauth.ts)
- [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](/Users/jeremy/Developer/gitoverflow/docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)

## Core Decisions

### 1. Preserve the runtime shape, not the extension shape

We are not porting the Chrome extension. We are porting the useful product core:

- provider auth
- model selection
- persistent sessions
- streaming chat
- cost tracking
- resumable history

We are explicitly dropping:

- browser-coupled tools
- navigation messages
- REPL
- `browserjs`
- page state injection

That means the runtime should still have an internal `tools` slot, but v0 should run correctly with `tools = []`.

### 2. Keep everything client-side

No backend means:

- Dexie for persistence
- `fetch` for provider/token calls
- popup/redirect based OAuth flows
- local token refresh
- local usage/cost aggregation

This also means we must treat provider compatibility as a first-class implementation risk. Some providers are extension-friendly but web-hostile. The code should isolate provider-specific logic behind adapters so one awkward provider does not contaminate the whole app.

Sitegeist already does most of this correctly:

- provider-specific login and refresh live in separate files under `src/oauth/providers`
- common credential parsing and refresh routing live in `src/oauth/index.ts`
- the only part that is truly extension-specific is the redirect transport in `browser-oauth.ts`

For this web app, the rule should be:

- copy the provider login/refresh/request-normalization logic as directly as possible
- keep the same stored credential format as Sitegeist
- replace only the redirect transport, because the web app does not have Chrome tab APIs

### 3. Build an internal app runtime

Do not couple the app directly to the view layer.

Recommended split:

- `db`: Dexie schema plus helper functions
- `auth`: provider key persistence, OAuth login, refresh, key resolution
- `models`: thin wrappers around the copied Sitegeist/pi-ai model registry
- `agent`: runtime loop and stream orchestration
- `hooks`: runtime/bootstrap hooks
- `components`: UI
- `routes`: shell and callback routes

## Proposed File Layout

```text
src/
  db/
    schema.ts
      // Dexie instance, store schema, and small storage helpers
    migrations.ts
  lib/
    ids.ts
    dates.ts
    preview.ts
    title.ts
    events.ts
  auth/
    oauth-types.ts
    oauth-utils.ts
    popup-flow.ts
    resolve-api-key.ts
    providers/
      anthropic.ts
      openai-codex.ts
      github-copilot.ts
      google-gemini-cli.ts
    auth-service.ts
  models/
    catalog.ts
    provider-metadata.ts
    pricing.ts
  agent/
    system-prompt.ts
    message-transformer.ts
    provider-stream.ts
    runtime.ts
    runtime-types.ts
  hooks/
    use-app-bootstrap.ts
    use-chat-session.ts
    use-session-list.ts
  types/
    chat.ts
    auth.ts
    models.ts
    storage.ts
  components/ (existing folder)
    app-shell.tsx
    session-sidebar.tsx
    chat-thread.tsx
    composer.tsx
    model-picker.tsx
    provider-badge.tsx
    settings-dialog.tsx
    provider-settings.tsx
    costs-panel.tsx
    /ui ... (ui elements !)
  sessions/
    session-service.ts
    session-metadata.ts
  routes/
    __root.tsx
    index.tsx
    auth.callback.tsx
```

Implementation note:

- follow this flattened layout
- keep Dexie store definitions and their helper functions in `src/db/schema.ts`
- do not create separate repository classes unless the file becomes too large to manage

## Phase Plan

## Phase 0: Foundation

Goal: replace the starter route with a real app shell and establish all core domain types before building behavior.

Tasks:

- replace the placeholder route with a split view shell
- copy the Sitegeist/web-ui storage contracts before writing Dexie helpers
- copy the Sitegeist/pi-ai model contract before building the picker
- choose the callback route path now: `/auth/callback`
- choose the app title and metadata in the root route

Deliverables:

- shell route renders without data
- type definitions compile
- all later phases have stable file targets

Starter types:

Do not invent new storage or auth contracts here. Copy the exact Sitegeist-compatible shapes first.

Auth types should follow the Sitegeist OAuth shape:

```ts
// src/auth/oauth-types.ts
export interface OAuthCredentials {
  providerId: "anthropic" | "openai-codex" | "github-copilot" | "google-gemini-cli"
  access: string
  refresh: string
  expires: number
  accountId?: string
  projectId?: string
}

export function isOAuthCredentials(value: string): boolean {
  return value.startsWith("{")
}

export function parseOAuthCredentials(value: string): OAuthCredentials {
  return JSON.parse(value) as OAuthCredentials
}

export function serializeOAuthCredentials(credentials: OAuthCredentials): string {
  return JSON.stringify(credentials)
}
```

Message and usage types should follow the Sitegeist/pi-agent-core and pi-ai shapes as closely as possible.
The plan should prefer copying those types or vendoring them locally over inventing a smaller custom message schema.

## Phase 1: Dexie Storage Layer

Goal: get all persistence working before chat logic gets complicated.

Build:

- a real Dexie schema
- small helper functions around each table in `src/db/schema.ts`
- transactional session save helpers
- migration support from day one

Required tables, matching Sitegeist/web-ui naming where possible:

- `sessions`
- `sessions-metadata`
- `settings`
- `provider-keys`
- `daily_costs`

Recommended approach:

- store full session state in `sessions`
- store lightweight sidebar data in `sessions-metadata`
- update both in one transaction

Keep the `sessions` / `sessions-metadata` split exactly like Sitegeist.
Yes, the sidebar data could be derived from full sessions, but Sitegeist deliberately avoids that so the list view can stay fast and indexed without loading full message histories.

Example Dexie schema:

```ts
// src/db/schema.ts
import Dexie, { type EntityTable } from "dexie"
import type { DailyCostAggregate, SessionData, SessionMetadata } from "@/types/storage"

export class AppDb extends Dexie {
  sessions!: EntityTable<SessionData, "id">
  sessionsMetadata!: EntityTable<SessionMetadata, "id">
  settings!: EntityTable<unknown, string>
  providerKeys!: EntityTable<string, string>
  dailyCosts!: EntityTable<DailyCostAggregate, "date">

  constructor() {
    super("gitoverflow")

    this.version(1).stores({
      sessions: "id, updatedAt, createdAt, provider, model",
      "sessions-metadata": "id, lastModified",
      settings: "key",
      "provider-keys": "",
      daily_costs: "date",
    })
  }
}

export const db = new AppDb()
```

Storage helper example:

```ts
// src/db/schema.ts
import { db } from "@/db/schema"
import type { SessionData, SessionMetadata } from "@/types/storage"

export async function saveSession(
  session: SessionData,
  metadata: SessionMetadata,
): Promise<void> {
  await db.transaction("rw", db.sessions, db.table("sessions-metadata"), async () => {
    await db.sessions.put(session)
    await db.table("sessions-metadata").put(metadata)
  })
}

export function listSessionMetadata(): Promise<SessionMetadata[]> {
  return db.table<SessionMetadata, string>("sessions-metadata")
    .orderBy("lastModified")
    .reverse()
    .toArray()
}
```

Implementation notes:

- keep `messages` in the full session record only
- derive `preview`, `title`, `messageCount`, and aggregates into metadata
- never make UI components talk to Dexie directly

## Phase 2: Session Domain

Goal: make the app boot into an existing or new session.

Build:

- `createSession`
- `loadSession`
- `loadMostRecentSession`
- `saveSession`
- `updateSessionTitle`
- `buildSessionPreview`

Key logic copied from Sitegeist:

- title generated from first user message
- preview generated from early user/assistant text
- only save a session after there is at least one user and one assistant message

Suggested helper:

```ts
// src/sessions/session-metadata.ts
import type { AgentMessage } from "@/types/chat"

export function generateTitle(messages: AgentMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")
  if (!firstUser) return "New chat"

  const text = typeof firstUser.content === "string"
    ? firstUser.content.trim()
    : firstUser.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join(" ")
        .trim()

  if (!text) return "New chat"
  if (text.length <= 50) return text
  return `${text.slice(0, 47)}...`
}

export function buildPreview(messages: AgentMessage[]): string {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      if (typeof message.content === "string") return message.content
      return message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join(" ")
    })
    .join("\n")
    .slice(0, 2048)
}
```

Bootstrap flow:

1. App loads `lastUsedModel` from settings.
2. App checks route/search params for a session id.
3. If not present, load the most recent session.
4. If none exists, create a fresh session record in memory.
5. Render the shell.

## Phase 3: Model Registry and Provider Metadata

Goal: use the same model lookup pattern as Sitegeist instead of inventing a local hand-maintained model list.

Do not hardcode model lists in UI components.

Add:

- a thin local wrapper around the copied pi-ai model registry
- provider display metadata
- default model selection logic

Sitegeist does this by using `getModel()` and `getModels()` from the pi-ai registry, then layering a small `DEFAULT_MODELS` mapping on top.

Example:

```ts
// src/models/catalog.ts
export { getModel, getModels, getProviders, calculateCost } from "@/models/pi-ai-models"

export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  "openai-codex": "gpt-5.1-codex-mini",
  "github-copilot": "gpt-4o",
  "google-gemini-cli": "gemini-2.5-pro",
}
```

Use this catalog for:

- model picker
- provider badge
- settings defaults
- cost aggregation
- auth lookup

Do not create a second source of truth for model pricing or capabilities if the copied pi-ai model registry already has that data.

## Phase 4: Auth Storage and Key Resolution

Goal: unify API keys and OAuth credentials under one storage and resolution interface.

Store shape, matching Sitegeist exactly:

```ts
// provider-keys
// key: provider name
// value: raw api key string OR JSON-serialized OAuthCredentials string
```

Central resolver:

```ts
// src/auth/resolve-api-key.ts
import { db } from "@/db/schema"
import {
  isOAuthCredentials,
  parseOAuthCredentials,
  serializeOAuthCredentials,
} from "@/auth/oauth-types"
import { oauthRefresh } from "@/auth/auth-service"

export async function resolveApiKey(storedValue: string, provider: string): Promise<string> {
  if (!isOAuthCredentials(storedValue)) {
    return storedValue
  }

  let credentials = parseOAuthCredentials(storedValue)

  if (Date.now() >= credentials.expires - 60_000) {
    credentials = await oauthRefresh(credentials)
    await db.table("provider-keys").put(
      serializeOAuthCredentials(credentials),
      provider,
    )
  }

  if (credentials.providerId === "google-gemini-cli") {
    return JSON.stringify({ token: credentials.access, projectId: credentials.projectId })
  }

  return credentials.access
}
```

Implementation notes:

- keep the same string-based storage contract as Sitegeist for parity
- copy `resolveApiKey` behavior directly where possible
- auth resolution should be usable both from runtime code and settings UI

## Phase 5: OAuth for a Real Browser App

Goal: adapt extension-based OAuth flows to normal web popups and callbacks.

This is the most important architecture change from Sitegeist.

### Popup flow design

Because we are not in an extension, we cannot watch tab URLs with privileged APIs. Instead:

1. Open a popup to the provider authorization URL.
2. Provider redirects back to `https://your-origin/auth/callback?...`.
3. The callback page runs inside our app origin.
4. The callback route sends the result back to the opener via `window.opener.postMessage`.
5. The opener exchanges the code for tokens.
6. The popup closes.

Dexie alone is not enough here. The problem is not shared storage; the problem is learning that the provider redirect completed and recovering the callback URL safely. A same-origin callback route plus `postMessage` is the simplest browser-native replacement for Sitegeist’s Chrome tab watcher.

Popup helper:

```ts
// src/auth/popup-flow.ts
export async function runPopupOAuthFlow(authUrl: string): Promise<URL> {
  const popup = window.open(authUrl, "oauth", "width=520,height=720")
  if (!popup) {
    throw new Error("Failed to open OAuth popup")
  }

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "oauth-callback") return

      window.removeEventListener("message", onMessage)
      popup.close()

      if (event.data.error) {
        reject(new Error(event.data.error))
        return
      }

      resolve(new URL(event.data.url))
    }

    window.addEventListener("message", onMessage)
  })
}
```

Callback route:

```tsx
// src/routes/auth.callback.tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
})

function AuthCallbackPage() {
  React.useEffect(() => {
    window.opener?.postMessage(
      {
        type: "oauth-callback",
        url: window.location.href,
      },
      window.location.origin,
    )
    window.close()
  }, [])

  return <div className="p-6 text-sm">Completing login...</div>
}
```

PKCE utilities can be adapted almost directly from the Sitegeist browser OAuth helpers:

- `generatePKCE`
- `generateState`
- `postTokenRequest`

These should live in `src/auth/oauth-utils.ts`.

### Provider implementation strategy

Implement providers in this order:

1. OpenAI Codex
2. Anthropic
3. GitHub Copilot
4. Google Gemini CLI

Reason:

- OpenAI and Anthropic are the cleanest early proof points
- Copilot and Gemini have more provider-specific quirks

Provider adapter shape:

```ts
// src/auth/providers/openai-codex.ts
import type { OAuthCredentials } from "@/auth/oauth-types"
import { generatePKCE, generateState, postTokenRequest } from "@/auth/oauth-utils"
import { runPopupOAuthFlow } from "@/auth/popup-flow"

const CLIENT_ID = "..."
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
const TOKEN_URL = "https://auth.openai.com/oauth/token"

export async function loginOpenAICodex(redirectUri: string): Promise<OAuthCredentials> {
  const { verifier, challenge } = await generatePKCE()
  const state = generateState()

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", "openid profile email offline_access")
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)

  const redirect = await runPopupOAuthFlow(url.toString())
  const code = redirect.searchParams.get("code")

  if (!code || redirect.searchParams.get("state") !== state) {
    throw new Error("OAuth callback validation failed")
  }

  const tokenData = await postTokenRequest(TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  })

  return normalizeOpenAICredentials(tokenData)
}
```

### Refresh strategy

Each provider file should expose:

- `loginProvider()`
- `refreshProvider()`
- `resolveProviderAuthPayload()`

And the auth service should call them generically:

```ts
// src/auth/auth-service.ts
export async function maybeRefreshCredentials(
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const expiresSoon = credentials.expires - Date.now() < 60_000
  if (!expiresSoon) return credentials

  const refreshed = await refreshOAuthCredentials(credentials)
  await upsertProviderOAuth(refreshed.providerId, refreshed)
  return refreshed
}
```

## Phase 6: Stream Function and Message Transport

Goal: follow Sitegeist’s transport shape instead of inventing a new per-provider adapter abstraction.

Sitegeist does not build a hand-written `ProviderStreamAdapter` interface per provider in app code.
It creates an agent with:

- a model object from the pi-ai registry
- a shared `streamFn`
- a `getApiKey` resolver

The provider-specific HTTP and SSE details live inside the copied pi-ai provider implementations.

Plan:

- copy the Sitegeist/pi-web-ui `createStreamFn` pattern
- keep auth resolution separate via `resolveApiKey`
- let the selected model determine provider behavior through the copied model registry
- only add a thin wrapper in `src/agent/provider-stream.ts` if the React app needs a simpler call shape

Recommended internal flow:

1. load the selected model via `getModel()` / `getModels()`
2. resolve auth material via the copied `resolveApiKey` flow
3. call the shared stream function
4. append text deltas to the in-memory assistant draft
5. use normalized usage from the copied provider/model layer
6. persist on stable lifecycle boundaries

## Phase 7: Agent Runtime

Goal: create a reusable runtime controller that the UI can subscribe to.

This does not need to be a giant class. A focused service plus a hook is enough.

Suggested runtime service:

```ts
// src/agent/runtime.ts
import { generateTitle, buildPreview } from "@/sessions/session-metadata"
import { saveSession } from "@/db/schema"
import { streamChat } from "@/agent/provider-stream"
import type { ChatMessage } from "@/types/chat"

export async function sendMessage(params: {
  session: SessionRow
  content: string
  model: string
  provider: ProviderId
  onAssistantDelta(delta: string): void
}): Promise<SessionRow> {
  const now = new Date().toISOString()
  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: params.content,
    createdAt: now,
  }

  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    createdAt: now,
  }

  const nextMessages = [...params.session.messages, userMessage, assistantMessage]

  const result = await streamChat({
    provider: params.provider,
    model: params.model,
    messages: nextMessages,
    onTextDelta(delta) {
      assistantMessage.content += delta
      params.onAssistantDelta(delta)
    },
  })

  if (result.usage) {
    assistantMessage.usage = result.usage
  }

  const updatedSession = {
    ...params.session,
    model: params.model,
    provider: params.provider,
    messages: nextMessages,
    title: generateTitle(nextMessages),
    preview: buildPreview(nextMessages),
    updatedAt: new Date().toISOString(),
  }

  await persistSessionAndCosts(updatedSession)
  return updatedSession
}
```

Important behavior:

- append the user message optimistically
- create an empty assistant message before streaming
- mutate only the in-memory assistant draft during stream
- persist on the same meaningful boundaries Sitegeist uses
- if aborted, persist the best partial draft you want the user to keep only after the runtime settles

Sitegeist does not write every token chunk into IndexedDB.
It subscribes to agent events, records per-message cost on `message_end`, and saves session state after meaningful state changes. That keeps persistence durable without thrashing IndexedDB on every streamed delta.

The web app should do the same:

- keep streaming text in memory while the response is in flight
- update React state on deltas
- persist the session when the assistant message completes, aborts, or otherwise reaches a stable boundary
- record daily cost only once per completed assistant message

## Phase 8: React Hooks and App Bootstrap

Goal: move runtime orchestration out of route components.

Main hooks:

- `useAppBootstrap`
- `useChatSession`
- `useSessionList`

`useAppBootstrap` should:

- initialize Dexie-backed repositories
- load settings
- load or create the active session
- expose loading and fatal error states

`useChatSession` should:

- own the active session state
- expose `sendMessage`
- expose `abort`
- expose `setModel`
- keep transient streaming state out of Dexie until completion

Hook sketch:

```ts
// src/hooks/use-chat-session.ts
export function useChatSession(initialSession: SessionRow) {
  const [session, setSession] = React.useState(initialSession)
  const [isStreaming, setIsStreaming] = React.useState(false)

  const send = React.useEffectEvent(async (content: string) => {
    if (!content.trim()) return
    setIsStreaming(true)

    const next = await sendMessage({
      session,
      content,
      model: session.model,
      provider: session.provider,
      onAssistantDelta(delta) {
        setSession((current) => appendDelta(current, delta))
      },
    })

    setSession(next)
    setIsStreaming(false)
  })

  return { session, setSession, isStreaming, send }
}
```

Use `useEffectEvent` because:

- the send function depends on the latest session state
- we do not want to add unstable callback dependencies everywhere

## Phase 9: UI Shell

Goal: copy the working Sitegeist UX shape just enough to prove the runtime.

Layout:

- left sidebar: session history and new chat button
- top bar: model picker, provider auth status, settings button
- center: message thread
- bottom: composer

Minimal route implementation:

```tsx
// src/routes/index.tsx
import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/app-shell"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return <AppShell />
}
```

App shell responsibilities:

- call `useAppBootstrap`
- render loading and error states
- hand state to sidebar, thread, and composer
- open settings dialog
- switch sessions

Do not let the main route contain business logic.

## Phase 10: Cost Tracking

Goal: persist per-message usage and maintain daily aggregates.

Implementation:

- read usage from normalized provider response
- attach usage to the assistant message
- write a `dailyCosts` row keyed by `date:provider:model`

Aggregator example:

```ts
// src/db/schema.ts
export async function recordUsage(usage: MessageUsage): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const store = db.table("daily_costs")
  const current = await store.get(date)

  await store.put({
    date,
    total: (current?.total ?? 0) + usage.cost.total,
    byProvider: {
      ...(current?.byProvider ?? {}),
      [usage.provider]: {
        ...(current?.byProvider?.[usage.provider] ?? {}),
        [usage.model]:
          ((current?.byProvider?.[usage.provider]?.[usage.model] as number | undefined) ?? 0) +
          usage.cost.total,
      },
    },
  })
}
```

UI requirements:

- show session-level totals
- show daily totals
- break down by provider/model

## Phase 11: Settings UI

Goal: let the user fully manage providers and inspect costs.

v0 settings tabs:

- Providers
- Costs

Providers tab should support:

- enter/update API key
- start OAuth login flow
- disconnect provider
- show auth type: `api key` or `subscription`
- show last updated time

Costs tab should support:

- current session cost
- aggregate daily totals
- breakdown by provider/model

## Phase 12: Testing and Hardening

Goal: avoid building an un-debuggable auth/chat system.

### Unit tests

Add tests for:

- title generation
- preview generation
- session save/load
- auth record serialization
- refresh threshold logic
- model catalog defaults
- cost aggregation

### Integration tests

Add tests for:

- bootstrap with no session
- bootstrap with existing recent session
- sending a message persists session metadata
- switching sessions updates the active thread
- provider auth settings update the runtime resolver

### Provider tests

Mock:

- OAuth callback payloads
- token exchange responses
- refresh responses
- streaming responses

## Detailed Todo List

This is the execution checklist for the implementation. Do not skip around casually. Finish each phase to a stable checkpoint before moving on.

### Phase 0: Foundation and Source Import Map

- [ ] Replace the placeholder app shell in `src/routes/index.tsx` with a real split layout skeleton.
  Implementation target:
  - `src/routes/index.tsx`
  - `src/components/app-shell.tsx`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

- [ ] Update root document metadata and app title in `src/routes/__root.tsx`.
  Implementation target:
  - `src/routes/__root.tsx`
  Copy/reference:
  - [docs/sitegeist/static/sidepanel.html](docs/sitegeist/static/sidepanel.html)
  - [docs/sitegeist/site/src/frontend/index.html](docs/sitegeist/site/src/frontend/index.html)

- [ ] Create the initial file skeleton for the flattened architecture.
  Implementation target:
  - `src/db/schema.ts`
  - `src/auth/*`
  - `src/models/*`
  - `src/agent/*`
  - `src/hooks/*`
  - `src/components/*`
  - `src/sessions/*`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/sitegeist/src/storage/app-storage.ts](docs/sitegeist/src/storage/app-storage.ts)

- [ ] Decide what will be copied verbatim, what will be vendored with edits, and what must be reimplemented for the web.
  Required outcome:
  - explicit list in code comments or module headers for each major copied module
  Copy/reference:
  - [docs/sitegeist/src/oauth/browser-oauth.ts](docs/sitegeist/src/oauth/browser-oauth.ts)
  - [docs/sitegeist/src/oauth/index.ts](docs/sitegeist/src/oauth/index.ts)
  - [docs/pi-mono/packages/ai/src/models.ts](docs/pi-mono/packages/ai/src/models.ts)

### Phase 1: Storage Contract Parity

- [ ] Implement the Dexie database in `src/db/schema.ts` using Sitegeist/web-ui store names and shapes.
  Implementation target:
  - `src/db/schema.ts`
  Copy/reference:
  - [docs/sitegeist/src/storage/app-storage.ts](docs/sitegeist/src/storage/app-storage.ts)
  - [docs/sitegeist/docs/storage.md](docs/sitegeist/docs/storage.md)
  - [docs/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts)
  - [docs/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts)
  - [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)
  - [docs/sitegeist/src/storage/stores/cost-store.ts](docs/sitegeist/src/storage/stores/cost-store.ts)

- [ ] Create helper functions in `src/db/schema.ts` for:
  - settings get/set/delete/list
  - provider key get/set/delete/list
  - session save/load/delete/list metadata/latest session id
  - daily cost get/record/list
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts)
  - [docs/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts)
  - [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)
  - [docs/sitegeist/src/storage/stores/cost-store.ts](docs/sitegeist/src/storage/stores/cost-store.ts)

- [ ] Keep the `sessions` plus `sessions-metadata` split exactly.
  Required behavior:
  - atomic writes to both stores
  - metadata listing sorted by `lastModified`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)
  - [docs/sitegeist/docs/storage.md](docs/sitegeist/docs/storage.md)

- [ ] Add migration scaffolding in `src/db/migrations.ts` even if v1 only has a no-op placeholder.
  Implementation target:
  - `src/db/migrations.ts`
  Copy/reference:
  - [docs/sitegeist/src/storage/stores/sessions-store.ts](docs/sitegeist/src/storage/stores/sessions-store.ts)
  - [docs/pi-mono/packages/coding-agent/src/migrations.ts](docs/pi-mono/packages/coding-agent/src/migrations.ts)

### Phase 2: Type Parity

- [ ] Copy or vendor the minimal Sitegeist-compatible auth types.
  Implementation target:
  - `src/auth/oauth-types.ts`
  - `src/types/auth.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/types.ts](docs/sitegeist/src/oauth/types.ts)
  - [docs/sitegeist/src/oauth/index.ts](docs/sitegeist/src/oauth/index.ts)

- [ ] Copy or vendor the minimal message, usage, and session types needed for runtime and storage.
  Implementation target:
  - `src/types/chat.ts`
  - `src/types/storage.ts`
  - `src/types/models.ts`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/storage/types.ts](docs/pi-mono/packages/web-ui/src/storage/types.ts)
  - [docs/pi-mono/packages/ai/src/types.ts](docs/pi-mono/packages/ai/src/types.ts)
  - [docs/sitegeist/docs/storage.md](docs/sitegeist/docs/storage.md)

- [ ] Ensure the session metadata type supports:
  - `title`
  - `createdAt`
  - `lastModified`
  - `messageCount`
  - `usage`
  - `thinkingLevel`
  - `preview`
  - `modelId`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

### Phase 3: Session Metadata and Persistence Logic

- [ ] Implement `generateTitle()` and `buildPreview()` in `src/sessions/session-metadata.ts`.
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

- [ ] Implement `shouldSaveSession()` behavior so empty or one-sided conversations are not persisted prematurely.
  Implementation target:
  - `src/sessions/session-service.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Implement `saveSession()` behavior that:
  - aggregates usage across assistant messages
  - builds preview text from user and assistant messages
  - preserves original `createdAt`
  - updates metadata and full session atomically
  Implementation target:
  - `src/sessions/session-service.ts`
  - `src/db/schema.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)

- [ ] Implement most-recent-session bootstrapping.
  Implementation target:
  - `src/hooks/use-app-bootstrap.ts`
  - `src/sessions/session-service.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

### Phase 4: Model Registry Parity

- [ ] Vendor or wrap the pi-ai model lookup flow instead of inventing a local model array.
  Implementation target:
  - `src/models/pi-ai-models.ts`
  - `src/models/catalog.ts`
  Copy/reference:
  - [docs/pi-mono/packages/ai/src/models.ts](docs/pi-mono/packages/ai/src/models.ts)
  - [docs/pi-mono/packages/ai/src/index.ts](docs/pi-mono/packages/ai/src/index.ts)

- [ ] Implement the Sitegeist-style `DEFAULT_MODELS` mapping.
  Implementation target:
  - `src/models/catalog.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Implement “choose a default model for a provider that already has auth configured”.
  Implementation target:
  - `src/models/catalog.ts`
  - `src/hooks/use-app-bootstrap.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Persist `lastUsedModel` the same way Sitegeist does.
  Implementation target:
  - `src/db/schema.ts`
  - `src/hooks/use-chat-session.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/sitegeist/docs/settings.md](docs/sitegeist/docs/settings.md)

### Phase 5: OAuth Type and Resolver Parity

- [ ] Implement `isOAuthCredentials`, `parseOAuthCredentials`, and `serializeOAuthCredentials`.
  Implementation target:
  - `src/auth/oauth-types.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/types.ts](docs/sitegeist/src/oauth/types.ts)

- [ ] Implement the Sitegeist-style OAuth provider registry and dispatch.
  Implementation target:
  - `src/auth/auth-service.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/index.ts](docs/sitegeist/src/oauth/index.ts)

- [ ] Implement `resolveApiKey()` using the exact Sitegeist storage contract.
  Required behavior:
  - plain string returns directly
  - JSON string parses as OAuth credentials
  - refresh when close to expiry
  - rewrite refreshed credentials back to `provider-keys`
  - special handling for Gemini CLI auth payload
  Implementation target:
  - `src/auth/resolve-api-key.ts`
  - `src/db/schema.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/index.ts](docs/sitegeist/src/oauth/index.ts)

### Phase 6: Browser OAuth Transport Rewrite

- [ ] Copy PKCE and state generation helpers.
  Implementation target:
  - `src/auth/oauth-utils.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/browser-oauth.ts](docs/sitegeist/src/oauth/browser-oauth.ts)

- [ ] Replace `waitForOAuthRedirect()` with a web-native popup plus callback flow.
  Implementation target:
  - `src/auth/popup-flow.ts`
  - `src/routes/auth.callback.tsx`
  Copy/reference:
  - [docs/sitegeist/src/oauth/browser-oauth.ts](docs/sitegeist/src/oauth/browser-oauth.ts)

- [ ] Add popup lifecycle handling:
  - popup blocked
  - popup closed before completion
  - callback origin validation
  - callback error propagation
  Implementation target:
  - `src/auth/popup-flow.ts`
  - `src/routes/auth.callback.tsx`
  Copy/reference:
  - [docs/sitegeist/src/oauth/browser-oauth.ts](docs/sitegeist/src/oauth/browser-oauth.ts)

### Phase 7: Provider OAuth Ports

- [ ] Port OpenAI Codex OAuth login and refresh.
  Implementation target:
  - `src/auth/providers/openai-codex.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/openai-codex.ts](docs/sitegeist/src/oauth/openai-codex.ts)

- [ ] Port Anthropic OAuth login and refresh.
  Implementation target:
  - `src/auth/providers/anthropic.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/anthropic.ts](docs/sitegeist/src/oauth/anthropic.ts)

- [ ] Port GitHub Copilot device flow and refresh.
  Implementation target:
  - `src/auth/providers/github-copilot.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/github-copilot.ts](docs/sitegeist/src/oauth/github-copilot.ts)
  - [docs/pi-mono/packages/ai/src/utils/oauth/github-copilot.ts](docs/pi-mono/packages/ai/src/utils/oauth/github-copilot.ts)

- [ ] Port Google Gemini CLI OAuth login and refresh.
  Implementation target:
  - `src/auth/providers/google-gemini-cli.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/google-gemini-cli.ts](docs/sitegeist/src/oauth/google-gemini-cli.ts)

- [ ] Ensure all providers expose the same app-facing shape:
  - login
  - refresh
  - provider id
  - any provider-specific output normalization
  Implementation target:
  - `src/auth/providers/*`
  - `src/auth/auth-service.ts`
  Copy/reference:
  - [docs/sitegeist/src/oauth/index.ts](docs/sitegeist/src/oauth/index.ts)

### Phase 8: Agent Runtime Boot

- [ ] Implement a web-app equivalent of `createAgent()` without browser tools.
  Implementation target:
  - `src/agent/runtime.ts`
  - `src/agent/system-prompt.ts`
  - `src/agent/message-transformer.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

- [ ] Port the Sitegeist boot order:
  - load settings
  - resolve most recent or requested session
  - resolve last used model
  - construct runtime
  - render shell
  Implementation target:
  - `src/hooks/use-app-bootstrap.ts`
  - `src/agent/runtime.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Keep the tool list empty for v0, but preserve the injection seam for future tools.
  Implementation target:
  - `src/agent/runtime.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

### Phase 9: Streaming and Usage

- [ ] Implement the shared streaming transport shape instead of per-provider app adapters.
  Implementation target:
  - `src/agent/provider-stream.ts`
  - `src/agent/runtime.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/src/utils/proxy-utils.ts](docs/pi-mono/packages/web-ui/src/utils/proxy-utils.ts)

- [ ] Normalize usage and cost using the copied model/provider layer.
  Implementation target:
  - `src/agent/provider-stream.ts`
  - `src/models/catalog.ts`
  Copy/reference:
  - [docs/pi-mono/packages/ai/src/models.ts](docs/pi-mono/packages/ai/src/models.ts)
  - [docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts](docs/pi-mono/packages/ai/src/providers/openai-responses-shared.ts)
  - [docs/pi-mono/packages/ai/src/providers/anthropic.ts](docs/pi-mono/packages/ai/src/providers/anthropic.ts)
  - [docs/pi-mono/packages/ai/src/providers/google-gemini-cli.ts](docs/pi-mono/packages/ai/src/providers/google-gemini-cli.ts)

- [ ] Persist session state on stable lifecycle boundaries, not every token delta.
  Required behavior:
  - update React state on streamed deltas
  - record message cost once per completed assistant message
  - save session after stable message state changes
  Implementation target:
  - `src/agent/runtime.ts`
  - `src/hooks/use-chat-session.ts`
  - `src/sessions/session-service.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

### Phase 10: Cost Tracking

- [ ] Copy the Sitegeist daily aggregate cost shape into `daily_costs`.
  Implementation target:
  - `src/db/schema.ts`
  - `src/types/storage.ts`
  Copy/reference:
  - [docs/sitegeist/src/storage/stores/cost-store.ts](docs/sitegeist/src/storage/stores/cost-store.ts)

- [ ] Record daily cost only once per assistant message.
  Implementation target:
  - `src/agent/runtime.ts`
  - `src/db/schema.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Add queries for:
  - all daily aggregates
  - total cost
  - costs by provider
  - costs by model
  Implementation target:
  - `src/db/schema.ts`
  Copy/reference:
  - [docs/sitegeist/src/storage/stores/cost-store.ts](docs/sitegeist/src/storage/stores/cost-store.ts)

### Phase 11: Hooks

- [ ] Implement `use-app-bootstrap`.
  Implementation target:
  - `src/hooks/use-app-bootstrap.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

- [ ] Implement `use-chat-session`.
  Required behavior:
  - send message
  - stream updates
  - abort
  - model changes
  - persisted session handoff
  Implementation target:
  - `src/hooks/use-chat-session.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Implement `use-session-list`.
  Implementation target:
  - `src/hooks/use-session-list.ts`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/dialogs/SessionListDialog.ts](docs/pi-mono/packages/web-ui/src/dialogs/SessionListDialog.ts)
  - [docs/sitegeist/src/dialogs/SessionListDialog.ts](docs/sitegeist/src/dialogs/SessionListDialog.ts)

### Phase 12: UI Shell

- [ ] Build the sidebar, thread, and composer components.
  Implementation target:
  - `src/components/session-sidebar.tsx`
  - `src/components/chat-thread.tsx`
  - `src/components/composer.tsx`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/ChatPanel.ts](docs/pi-mono/packages/web-ui/src/ChatPanel.ts)
  - [docs/pi-mono/packages/web-ui/src/components/AgentInterface.ts](docs/pi-mono/packages/web-ui/src/components/AgentInterface.ts)

- [ ] Build the model picker.
  Implementation target:
  - `src/components/model-picker.tsx`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/src/dialogs/ModelSelector.ts](docs/pi-mono/packages/web-ui/src/dialogs/ModelSelector.ts)
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Build the provider auth badge/status UI.
  Implementation target:
  - `src/components/provider-badge.tsx`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Build the app shell orchestration component.
  Implementation target:
  - `src/components/app-shell.tsx`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

### Phase 13: Settings UI

- [ ] Build the provider settings panel with API key entry and OAuth actions.
  Implementation target:
  - `src/components/settings-dialog.tsx`
  - `src/components/provider-settings.tsx`
  Copy/reference:
  - [docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts](docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts)
  - [docs/sitegeist/src/dialogs/ApiKeyOrOAuthDialog.ts](docs/sitegeist/src/dialogs/ApiKeyOrOAuthDialog.ts)

- [ ] Build the cost panel.
  Implementation target:
  - `src/components/costs-panel.tsx`
  Copy/reference:
  - [docs/sitegeist/src/dialogs/CostsTab.ts](docs/sitegeist/src/dialogs/CostsTab.ts)

- [ ] Add disconnect/remove auth behavior for each provider.
  Implementation target:
  - `src/components/provider-settings.tsx`
  - `src/db/schema.ts`
  Copy/reference:
  - [docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts](docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts)

### Phase 14: Session Navigation UI

- [ ] Implement new chat creation.
  Implementation target:
  - `src/components/session-sidebar.tsx`
  - `src/hooks/use-chat-session.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Implement session list loading and switching.
  Implementation target:
  - `src/components/session-sidebar.tsx`
  - `src/hooks/use-session-list.ts`
  Copy/reference:
  - [docs/sitegeist/src/dialogs/SessionListDialog.ts](docs/sitegeist/src/dialogs/SessionListDialog.ts)
  - [docs/pi-mono/packages/web-ui/src/dialogs/SessionListDialog.ts](docs/pi-mono/packages/web-ui/src/dialogs/SessionListDialog.ts)

- [ ] Implement URL/session synchronization.
  Required behavior:
  - requested session id from URL opens that session
  - newly created session updates URL
  Implementation target:
  - `src/hooks/use-app-bootstrap.ts`
  - `src/hooks/use-chat-session.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

### Phase 15: Testing

- [ ] Add unit tests for:
  - OAuth serialization helpers
  - title generation
  - preview generation
  - latest-session lookup
  - daily cost aggregation
  Implementation target:
  - `src/**/*.test.ts`
  Copy/reference:
  - [docs/pi-mono/packages/ai/test/tokens.test.ts](docs/pi-mono/packages/ai/test/tokens.test.ts)
  - [docs/pi-mono/packages/ai/test/abort.test.ts](docs/pi-mono/packages/ai/test/abort.test.ts)

- [ ] Add integration tests for:
  - boot with no saved session
  - boot with recent session
  - model persistence
  - provider-key persistence
  - resumed chat after reload
  Implementation target:
  - `src/**/*.test.tsx`
  Copy/reference:
  - [docs/pi-mono/packages/web-ui/example/src/main.ts](docs/pi-mono/packages/web-ui/example/src/main.ts)

- [ ] Add OAuth flow tests with mocked callbacks and token exchanges.
  Implementation target:
  - `src/auth/**/*.test.ts`
  Copy/reference:
  - [docs/pi-mono/packages/ai/test/oauth.ts](docs/pi-mono/packages/ai/test/oauth.ts)
  - [docs/pi-mono/packages/ai/test/github-copilot-oauth.test.ts](docs/pi-mono/packages/ai/test/github-copilot-oauth.test.ts)

- [ ] Add streaming and usage tests for the selected initial providers.
  Implementation target:
  - `src/agent/**/*.test.ts`
  Copy/reference:
  - [docs/pi-mono/packages/ai/test/stream.test.ts](docs/pi-mono/packages/ai/test/stream.test.ts)
  - [docs/pi-mono/packages/ai/test/openai-codex-stream.test.ts](docs/pi-mono/packages/ai/test/openai-codex-stream.test.ts)

### Phase 16: Final Verification Before Tooling Work

- [ ] Verify a fresh user can:
  - open the app
  - add API key or OAuth auth
  - choose a model
  - send a message
  - stream a response
  - reload the page
  - resume the same session
  Implementation target:
  - manual QA checklist
  Copy/reference:
  - [SPEC.md](SPEC.md)

- [ ] Verify there is no extension-only code left in the runtime path.
  Required check:
  - no `chrome.*`
  - no navigation messages
  - no browser tool injection
  - no REPL dependency
  Implementation target:
  - whole app audit
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

- [ ] Verify the code still has a clean seam for future custom tools.
  Implementation target:
  - `src/agent/runtime.ts`
  - `src/agent/provider-stream.ts`
  Copy/reference:
  - [docs/sitegeist/src/sidepanel.ts](docs/sitegeist/src/sidepanel.ts)

## Copy vs Rebuild Guidance

Use these repo files as the source of truth and copy-paste from them unless a piece is blocked by the web environment:

- [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  - copy the boot, model selection, session save, and settings flow
  - do not copy extension wiring or browser-context messaging
- [docs/sitegeist/src/oauth/browser-oauth.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/browser-oauth.ts)
  - copy PKCE/state/token-post helpers
  - replace Chrome tab watching with popup + callback messaging
- [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
  - copy the provider dispatch and `resolveApiKey` contract
- [docs/sitegeist/src/oauth/openai-codex.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/openai-codex.ts)
  - copy request parameters and normalization logic
  - replace redirect mechanics
- [docs/pi-mono/packages/ai/src/models.ts](/Users/jeremy/Developer/gitoverflow/docs/pi-mono/packages/ai/src/models.ts)
  - copy the model lookup pattern instead of inventing a second catalog
- [docs/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts](/Users/jeremy/Developer/gitoverflow/docs/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts)
  - copy the simple string store contract exactly
- [docs/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts](/Users/jeremy/Developer/gitoverflow/docs/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts)
  - copy the key-value settings contract exactly
- [docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts](/Users/jeremy/Developer/gitoverflow/docs/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts)
  - copy the full session vs metadata split
- [docs/sitegeist/src/storage/stores/cost-store.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/stores/cost-store.ts)
  - copy the daily aggregate shape instead of inventing a per-row schema

## Suggested Delivery Order

Build in this sequence:

1. Replace placeholder route with app shell skeleton.
2. Implement storage types and Dexie schema.
3. Implement session repositories and bootstrap.
4. Implement copied model registry access and settings persistence.
5. Implement chat runtime against one provider with API key auth first.
6. Implement streaming UI and session persistence.
7. Implement OpenAI Codex OAuth.
8. Implement Anthropic OAuth.
9. Implement Copilot and Gemini CLI OAuth.
10. Implement cost aggregation and settings panels.
11. Add tests and clean up architecture seams.

## Recommended First Vertical Slice

Do not start with all providers.

Start with this thin end-to-end slice:

- Dexie schema
- one session
- one model picker
- one provider adapter
- one API key auth flow
- one streaming chat path
- one persisted session sidebar

Recommendation: use `openai-codex` first if the browser token exchange path is clean, otherwise use Anthropic.

Why:

- proves the runtime loop
- proves persistence
- proves the UI shell
- reduces noise before full OAuth parity

## Risks

### 1. OAuth provider web compatibility

Even though Sitegeist already solved auth in an extension, some providers may behave differently in a standard web app.

Mitigation:

- isolate each provider in its own file
- ship provider-by-provider
- add mocked integration tests for refresh and callback parsing

### 2. Storing secrets locally

API keys and refresh tokens will live in browser storage.

Mitigation:

- keep all state local as requested
- document the tradeoff clearly in settings
- centralize auth storage so future encryption-at-rest improvements are possible

### 3. Runtime drift if UI owns too much logic

If route components start doing storage and auth work directly, tool support later will be painful.

Mitigation:

- keep repositories, auth services, and runtime services outside React
- keep components as thin as possible

## Definition of Done

The plan is implemented when:

- the app boots into a new or existing session
- settings persist with Dexie
- model selection persists
- a user can authenticate with supported provider methods
- chat responses stream in the main thread
- sessions resume correctly after reload
- costs are persisted and viewable
- no browser extension APIs are required
- the codebase is ready for later tool injection without rewriting the runtime
