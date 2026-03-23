

# Sitegeist Web v0 Spec

## Summary

Build a strictly client-side web app that recreates the core Sitegeist agent/runtime architecture and enough of the UX to prove the product works in a normal browser tab.

The app should preserve the parts of Sitegeist that matter for a persistent agent product:

- provider auth via API keys and OAuth
- model selection
- persistent chat sessions
- streaming assistant responses
- resumable history
- local cost tracking

The app should explicitly exclude the Chrome-extension-specific runtime:

- no active-tab awareness
- no navigation messages
- no `browserjs`
- no REPL
- no DOM picking
- no native input events
- no skills registry
- no custom tools in v0

Custom tools will be added later, after the core agent loop, auth, and persistence are working.

## Product Goal

Ship a working browser app where a user can:

1. Open the app.
2. Authenticate with any supported Sitegeist-style provider method.
3. Choose a model.
4. Chat with the LLM.
5. Close and reopen the app.
6. Resume prior sessions with full persistence.

## Non-Goals

These are explicitly out of scope for v0:

- browser-coupled automation
- page/site ingestion
- extension APIs
- onboarding or first-run setup flow
- skills management UI
- custom tools UI
- server-side storage
- backend proxy
- multi-device sync

## Hard Constraints

- The app must run entirely on the user’s device.
- No dedicated backend may be required for chat, auth state, storage, or tool execution.
- Persistence must use `Dexie`, not ad hoc storage wrappers.
- The architecture should stay close to Sitegeist’s runtime loop so browser-safe tools can be added later without a rewrite.

## v0 User Experience

The initial UX can be a pragmatic copy of Sitegeist’s working surfaces. It does not need to be the final design.

Mandatory surfaces:

- chat view
- session history / session switching
- model picker
- provider settings
- OAuth + API key auth entry points
- reusable saved sessions
- cost tracking view or panel

Explicitly omitted:

- welcome/onboarding flow
- site-aware context pills
- skill pills
- tool registry

## Functional Scope

### 1. Core Agent Runtime

The app should preserve the Sitegeist runtime shape, but with a reduced tool surface.

Required behavior:

- initialize persistent storage on app boot
- load settings and last used model
- load the most recent session by default if one exists
- create a fresh session when no session exists
- create an agent instance using:
  - a system prompt
  - the selected model
  - a message transformer
  - a streaming provider request function
  - an API-key resolver that also handles OAuth refresh
- stream assistant output into the UI
- persist completed messages, session metadata, usage, and costs
- support resuming any saved session without loss of state

v0 runtime simplification:

- tool list should be empty or minimal
- there is no browser context message injection
- there are no navigation messages
- there is no page execution environment

### 2. Authentication

v0 should support full auth compatibility with the Sitegeist provider model:

- raw API keys
- OAuth credential objects stored locally and refreshed locally

Initial target providers:

- Anthropic
- OpenAI Codex / ChatGPT subscription flow
- GitHub Copilot
- Google Gemini CLI

Required auth behavior:

- provider settings can store either:
  - a plain API key string
  - a JSON credential object for OAuth
- API key resolution should detect stored OAuth credentials
- if an OAuth token is near expiry, the app should refresh it automatically
- refreshed credentials must be written back to Dexie
- provider resolution should return the exact auth material required by the active model/provider

Web-specific adaptation:

- OAuth flows must use browser-safe redirects/popups rather than extension-localhost callbacks
- redirect completion must land back in the app and finalize the token exchange entirely client-side

### 3. Sessions

Every session must be durable and reusable.

Required behavior:

- create session
- rename session automatically from first user message
- list sessions in reverse chronological order
- reopen an old session
- continue a prior session with the same model/provider settings unless changed
- persist partial metadata needed for sidebar previews

Each session should store:

- id
- title
- preview
- created at / updated at
- model
- provider
- message list
- usage totals
- accumulated cost
- optional thinking level / runtime settings if the model layer needs them

### 4. Model Selection

Required behavior:

- user can choose a model before sending a message
- selected model persists across reloads as the last used model
- session records the model used for each conversation
- changing models mid-session should be allowed and reflected in persisted session state

### 5. Cost Tracking

v0 should preserve Sitegeist’s observability around usage.

Required behavior:

- record usage per assistant response
- aggregate daily cost totals
- aggregate by provider
- aggregate by model
- surface cost history in the UI or settings

### 6. Persistence

All durable state should live in Dexie.

Expected stores:

- `sessions`
- `sessionsMetadata`
- `settings`
- `providerKeys`
- `dailyCosts`

Optional v0 stores if they simplify implementation:

- `authFlows`
- `modelCache`
- `uiState`

Not required in v0:

- `skills`
- `customProviders`, unless needed to support the model/provider layer cleanly

## Architecture

### App Shape

The app should be organized around four layers:

1. `storage`
   - Dexie database
   - typed repositories/stores
2. `auth`
   - provider key storage
   - OAuth login state
   - token refresh logic
3. `agent`
   - session bootstrap
   - message transformation
   - provider stream adapter
   - runtime loop
4. `ui`
   - chat shell
   - settings dialogs
   - session list
   - model picker

### Recommended Runtime Loop

The runtime loop should follow this sequence:

1. App boot initializes Dexie and loads persisted settings.
2. App resolves the active session:
   - requested session if present
   - otherwise most recent session
   - otherwise create new session
3. App resolves the active model/provider configuration.
4. App constructs the agent with:
   - system prompt
   - selected model
   - transformed messages
   - stream function
   - auth resolver
5. User sends a message.
6. UI appends the user message optimistically.
7. Agent streams assistant output.
8. UI renders streaming tokens/chunks.
9. Final assistant message, usage, and cost are persisted.
10. Session metadata and daily aggregates are updated.

### REPL / BrowserJS Decision

For v0, REPL and `browserjs` are not required to run the core loop.

Reason:

- the core loop only needs message persistence, provider auth, model execution, and streaming
- REPL/`browserjs` are part of Sitegeist’s browser-coupled execution model, not the minimal chat runtime
- keeping the agent architecture clean is enough to add browser-safe tools later

Implication:

- the agent runtime should be built so tools can be injected later
- v0 should not depend on tools being present

## Data Model

### `settings`

Suggested fields:

- `lastUsedModel`
- `lastUsedProvider`
- UI preferences needed by the shell

### `providerKeys`

Suggested fields:

- `provider`
- `value`
- `kind` (`api-key` or `oauth`)
- `updatedAt`

`value` should support either:

- a raw API key string
- a JSON-serialized OAuth credential payload

### `sessions`

Suggested fields:

- `id`
- `title`
- `preview`
- `model`
- `provider`
- `messages`
- `usageTotals`
- `costTotals`
- `createdAt`
- `updatedAt`

### `dailyCosts`

Suggested fields:

- `date`
- `provider`
- `model`
- `inputTokens`
- `outputTokens`
- `cost`

## System Prompt

v0 should preserve the idea of a product-specific assistant identity rather than a generic chat wrapper.

Prompt requirements:

- concise and pragmatic assistant tone
- no mention of browser execution abilities that do not exist in the web app
- no references to hidden browser state
- safe default for a tool-less runtime

This prompt can later be expanded when custom tools are introduced.

## UX Notes

The first implementation can mirror Sitegeist’s general shell:

- left sidebar for sessions
- main chat thread
- header controls for model/provider
- settings dialog for auth and cost visibility

The design does not need to be final. The priority is proving:

- auth works
- model calls work
- persistence works
- resume works

## Milestones

### Milestone 1: Core Chat Runtime

- Dexie schema exists
- sessions persist
- settings persist
- chat UI streams messages
- model picker works
- last used model persists

### Milestone 2: Provider Auth

- API key flows work
- OAuth login flows work for supported providers
- refresh logic works
- provider credentials persist safely in Dexie

### Milestone 3: Session History + Costs

- session list is fully resumable
- titles/previews are generated and stored
- usage and costs are tracked and displayed

### Milestone 4: Architecture Cleanup

- runtime loop is isolated from UI
- tool injection point is defined
- app is ready for later custom tool work

## Acceptance Criteria

v0 is complete when all of the following are true:

- a user can authenticate using any supported auth method
- a user can select a model and send a message
- assistant responses stream in the browser
- sessions survive page reloads and browser restarts
- prior sessions can be reopened and continued
- provider settings persist locally
- usage and cost data persist locally
- no server dependency is required for normal use

## Risks And Open Questions

### 1. OAuth Redirect Constraints

A strict client-only app still needs a stable browser origin for OAuth redirect URIs.

Open implementation detail:

- decide the canonical dev origin and production origin early so provider OAuth apps can be registered correctly

the project will live in dev mode under localhost:3000 and in prod under gitoverflow.com use the NODE_ENV to put the right one ! 

### 2. Browser Storage Security

API keys and OAuth credentials will live on-device in browser storage.

This matches the product constraint, but it should be treated as a deliberate tradeoff and documented clearly in settings/help text.

Yeah we will mark this in the repo !

### 3. Provider Compatibility Drift

Some provider OAuth flows may have web-specific constraints that differ from the extension implementation.

The architecture should isolate provider adapters so any provider-specific web adjustments do not leak into the main app runtime.

It's fine I think.

## Build Order Recommendation

Implement in this order:

1. Dexie schema and typed storage layer
2. session bootstrap + chat runtime
3. model picker + persisted settings
4. provider settings with API key support
5. OAuth provider flows + refresh
6. session history + resume
7. cost tracking
8. cleanup for future tool injection

## Future Extensions

These are intentionally deferred until after v0:

- browser-safe custom tools
- tool registry UI
- site ingestion
- document extraction
- prompt/tool packs
- final bespoke UX rebuild
