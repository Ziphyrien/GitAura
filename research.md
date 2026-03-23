# Sitegeist Research

## Bottom Line

Sitegeist is not just "a chat UI with OAuth". It is a browser-extension-first agent runtime that couples:

- a persistent chat session model
- provider auth and key storage
- browser-tab state tracking
- a prompt/tool system that knows when it is on a live page
- optional skills that inject site-specific helpers into page context

If the goal in GitOverflow is "ask a question, get a response, connect OAuth like Sitegeist", then the core to recreate is much smaller than the full Sitegeist stack. The browser automation and multi-window session locking are important to understand, but they are extension-specific and can be omitted unless you want the browser-coupled experience.

## What Sitegeist Is Doing

Sitegeist lives in a Chrome/Edge sidepanel and behaves like an agent workspace rather than a plain chat widget. The user can:

- start a new session or resume an existing one
- choose a model and provider
- connect either an API key or an OAuth subscription login
- ask the assistant to act on the current browser tab
- see session history, costs, and skills
- persist everything locally in IndexedDB

The extension is intentionally collaborative. The assistant sees DOM/page state through tooling while the user sees the actual rendered page. The core product idea is: "you guide, it executes".

## End-To-End Runtime Loop

The main loop is centered in `src/sidepanel.ts`.

1. The sidepanel initializes storage and port communication.
2. It loads settings such as last model, proxy settings, and debug flags.
3. It creates an `Agent` with:
   - `SYSTEM_PROMPT`
   - the current model
   - the custom message transformer
   - a stream function for provider requests
   - an API-key resolver that supports OAuth refresh
4. It wires the tool set into the agent.
5. It renders the chat panel.
6. When the user sends a message, the current tab context is appended as a navigation message if the tab changed.
7. The agent streams model output and tool calls.
8. Tool results and custom messages are transformed back into the LLM input format.
9. Session state, title, usage, and costs are persisted.

That loop matters more than the extension UI. The rest of the product is mostly scaffolding around it.

## Startup And Session Bootstrap

On startup, Sitegeist does the following:

- creates `SitegeistAppStorage`
- initializes the window-scoped port system
- requests `userScripts` permission when needed
- initializes default skills
- creates the `ChatPanel`
- decides whether to load a prior session or create a new one

The session bootstrap logic has three main branches:

- If the URL contains `?session=...`, it tries to load that session.
- If there is no session and no explicit `new=true`, it tries to load the most recent session.
- If no session can be loaded, it creates a fresh agent and inserts a welcome message.

There is also a first-run gate:

- if no API keys are configured, Sitegeist shows a welcome setup dialog
- it then opens the settings dialog
- it auto-selects a default model if possible

This is a useful pattern to copy into GitOverflow if you want onboarding to feel opinionated instead of empty.

## Authentication Model

Sitegeist supports two auth shapes:

- plain API keys
- browser-based OAuth subscriptions

Stored provider values live in `provider-keys` and are either:

- a raw string API key
- a JSON-encoded OAuth credential object

OAuth credentials are detected by checking whether the stored string starts with `{`.

### OAuth Providers

The OAuth path supports these providers:

- Anthropic
- OpenAI Codex / ChatGPT subscription
- GitHub Copilot
- Google Gemini CLI

### Provider-Specific Behavior

Anthropic:

- uses PKCE
- opens `claude.ai/oauth/authorize`
- waits for a redirect to `localhost:53692`
- exchanges the code against `platform.claude.com/v1/oauth/token`
- refreshes with the refresh token

OpenAI Codex:

- uses PKCE plus state
- opens `auth.openai.com/oauth/authorize`
- waits for redirect to `localhost:1455`
- exchanges on `auth.openai.com/oauth/token`
- extracts `accountId` from the access-token JWT payload

GitHub Copilot:

- uses device-code flow rather than PKCE
- prompts the user with a code and verification URL
- polls GitHub until authorization completes
- exchanges the GitHub access token for a Copilot internal token

Google Gemini CLI:

- uses PKCE
- opens Google auth in a browser tab
- waits for redirect to `localhost:8085`
- exchanges on `oauth2.googleapis.com/token`
- discovers or provisions a Google Cloud project for the CLI flow

### Token Refresh

`resolveApiKey()` handles token refresh automatically:

- if the stored value is JSON OAuth credentials, it parses them
- if the token is near expiry, it refreshes it
- refreshed credentials are written back to storage
- Gemini CLI returns a token/projectId bundle rather than a plain API key string

That means Sitegeist treats OAuth subscriptions as just another provider-key source from the agent's point of view.

## Settings And Persistence

Sitegeist stores most durable state in IndexedDB via `sitegeist-storage`.

### Stores

- `sessions`
- `sessions-metadata`
- `settings`
- `provider-keys`
- `skills`
- `daily_costs`
- `custom-providers` is wired in the storage layer, though it is not surfaced as a major current UX feature in the docs I read

### Important Settings

- `proxy.enabled`
- `proxy.url`
- `lastUsedModel`

There are also a few Chrome local/session storage flags that are not part of the IndexedDB settings store:

- `showJsonMode`
- `debuggerMode`
- sidepanel/session lock state in `chrome.storage.session`

### Session Persistence

Sessions store more than the message list:

- full messages
- model and thinking level
- metadata
- usage totals
- preview text
- title
- timestamps

The title is auto-generated from the first user message.

The preview is built from the first ~2KB of user and assistant text.

Sessions are only saved once there is at least one user message and one assistant message.

### Cost Tracking

Sitegeist separately aggregates cost data:

- per assistant message
- per day
- per provider
- per model

This is mostly observability, not core chat behavior, but it is part of the product's settings/history surface.

## Prompt And Tool Architecture

Sitegeist uses a very explicit prompt/tool system.

### System Prompt

The system prompt positions the assistant as Sitegeist, not as a generic chatbot. It emphasizes:

- concise, pragmatic tone
- browser-guided execution
- use of `navigate` rather than direct navigation APIs
- hidden tool output that must be paraphrased back to the user

### Core Tools

The main tools wired into the sidepanel are:

- `navigate`
- `ask_user_which_element`
- `repl`
- `skill`
- `extract_document`
- `extract_image`
- optional `debugger`

The REPL tool is the key bridge between plain chat and browser-coupled automation.

### REPL And BrowserJS

The REPL is a sandboxed JavaScript execution environment. It can call `browserjs()` to run code in the active tab's page context. The important constraints are:

- `browserjs()` code is serialized and executed separately
- it cannot close over REPL variables
- it cannot navigate
- navigation must happen through `navigate()` in REPL code or the `navigate` tool

Sitegeist adds runtime providers into the REPL so the model can use:

- `browserjs()`
- `navigate()`
- trusted native input events

This is the main browser automation loop.

## Browser-Coupled Message Flow

Sitegeist uses custom messages to represent browser state in the chat.

### Navigation Messages

When the active tab changes or the assistant navigates, Sitegeist creates a `navigation` message. That message contains:

- URL
- title
- favicon
- tab ID
- a frozen `skillsOutput` string

The UI renders the message as a clickable pill and also shows matching skills for the URL.

The transformer turns the navigation message into LLM-visible context:

- `<browser-context>` with the navigation result
- `<skills>` with the formatted skill summary
- instructions that the message is informational and should not be repeated to the user

### Welcome Messages

The welcome message is UI-only. It is shown only before a normal conversation starts and is filtered out of the LLM input.

It is used to bootstrap tutorials and onboarding.

## Skills System

Skills are one of the more distinctive Sitegeist features.

### What A Skill Is

A skill is a reusable JavaScript library attached to one or more domain patterns. It typically exposes a namespace such as `window.youtube` or `window.gmail`.

Each skill contains:

- name
- domain patterns
- short description
- full markdown description
- examples
- library code
- timestamps

### How Skills Work

Skills are:

- stored persistently
- matched by glob-like domain patterns
- auto-injected into browser page context when relevant
- listed and managed through the `skill` tool

### LLM Behavior

Sitegeist tracks whether a skill has been shown before. New or updated skills are shown with full details; previously seen skills are shown in compact form. This is token-efficient and avoids spamming the model with the same library text.

### Important Point

This is powerful, but it is not needed for the minimal "ask a question, get an answer, connect OAuth" product. It is an advanced extension of the browser automation layer.

## Multi-Window Session Locking

Sitegeist prevents the same session from being open in multiple sidepanel windows at once.

The mechanism is built from:

- `chrome.runtime.connect()`
- `chrome.storage.session`
- background-service-worker lock management
- a synchronous in-memory cache of open sidepanels

The behavior is:

- the first window can lock and use a session
- a second window opening the same session gets a landing page instead
- locks are released when the port disconnects, the window closes, or the sidepanel crashes

This is a well-designed extension-specific safeguard, but it is not core to the chat product if GitOverflow is not a multi-window browser extension.

## UI And Settings Surface

The settings dialog is organized around:

- API Keys and OAuth
- Costs
- Skills
- Proxy
- About

The first-run welcome dialog is only a gate; the actual auth setup happens in the settings dialog.

The welcome/tutorial screen is intentionally educational and explains:

- how to use the assistant
- what the browser-side tools do
- where data is stored
- how the proxy works

## What Is Core Versus Optional For GitOverflow

If you are rebuilding only the Sitegeist-like "chat + OAuth + response" experience inside GitOverflow, the core subset is:

- persistent sessions
- model selection
- provider-key storage
- OAuth login flows
- automatic token refresh
- basic settings storage
- agent streaming and tool invocation
- a first-run setup gate

The likely optional or removable parts are:

- sidepanel window management
- multi-window session locking
- browser tab navigation tracking
- browserJS / page-context automation
- skills auto-injection
- extract-image and debugger tools
- custom UI messages for navigation
- the CORS proxy layer if your app is not constrained by extension CORS rules

If you want a plain conversational product, you can strip a lot. If you want Sitegeist's "assistant inside the browser" feel, you need the browser-coupled parts.

## Important Findings And Mismatches

I found one significant discrepancy between docs and current code:

- the docs describe the proxy as enabled by default
- `src/sidepanel.ts` currently sets `proxy.enabled` to `false` on startup and comments that CORS is handled locally via declarativeNetRequest rules

That suggests the docs are at least partially stale relative to the current implementation. If you rebuild this behavior in GitOverflow, trust the current code path more than the prose docs.

Other useful findings:

- the update check still exists, but the active startup update flow appears to be commented out
- `debuggerMode` is an opt-in extra tool, not part of the default agent surface
- `showJsonMode` is another local UI flag outside the main settings store
- `custom-providers` storage is wired into app storage, which hints at future extensibility even if the current docs focus on the simpler provider model

## Practical Rebuild Note

If the target is "GitOverflow that feels like Sitegeist, but without the extension-heavy browser automation", the architecture to copy is:

- a persistent chat/session layer
- a provider-key store that accepts OAuth and API keys
- a settings store for model/proxy preferences
- model selection and refresh logic
- first-run onboarding
- cost/session metadata

Everything else is optional unless you want the browser-automation product specifically.

## Files I Read

- `docs/sitegeist/README.md`
- `docs/sitegeist/AGENTS.md`
- `docs/sitegeist/docs/settings.md`
- `docs/sitegeist/docs/storage.md`
- `docs/sitegeist/docs/prompts.md`
- `docs/sitegeist/docs/skills.md`
- `docs/sitegeist/docs/proxy.md`
- `docs/sitegeist/docs/custom-ui-messages.md`
- `docs/sitegeist/docs/multi-window.md`
- `docs/sitegeist/src/sidepanel.ts`
- `docs/sitegeist/src/background.ts`
- `docs/sitegeist/src/prompts/prompts.ts`
- `docs/sitegeist/src/messages/message-transformer.ts`
- `docs/sitegeist/src/messages/NavigationMessage.ts`
- `docs/sitegeist/src/messages/WelcomeMessage.ts`
- `docs/sitegeist/src/storage/app-storage.ts`
- `docs/sitegeist/src/storage/stores/sessions-store.ts`
- `docs/sitegeist/src/storage/stores/cost-store.ts`
- `docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts`
- `docs/sitegeist/src/dialogs/ApiKeyOrOAuthDialog.ts`
- `docs/sitegeist/src/dialogs/WelcomeSetupDialog.ts`
- `docs/sitegeist/src/dialogs/SessionListDialog.ts`
- `docs/sitegeist/src/dialogs/CostsTab.ts`
- `docs/sitegeist/src/dialogs/AboutTab.ts`
- `docs/sitegeist/src/oauth/index.ts`
- `docs/sitegeist/src/oauth/browser-oauth.ts`
- `docs/sitegeist/src/oauth/anthropic.ts`
- `docs/sitegeist/src/oauth/openai-codex.ts`
- `docs/sitegeist/src/oauth/github-copilot.ts`
- `docs/sitegeist/src/oauth/google-gemini-cli.ts`
- `docs/sitegeist/src/tools/index.ts`
- `docs/sitegeist/src/tools/skill.ts`
- `docs/sitegeist/src/tools/navigate.ts`
- `docs/sitegeist/src/tools/extract-image.ts`
- `docs/sitegeist/src/tools/debugger.ts`
- `docs/sitegeist/src/tools/repl/repl.ts`
- `docs/sitegeist/src/tools/repl/runtime-providers.ts`
- `docs/sitegeist/src/tools/repl/overlay-inject.ts`
- `docs/sitegeist/src/tools/repl/userscripts-helpers.ts`
- `docs/sitegeist/src/utils/format-skills.ts`
- `docs/sitegeist/src/utils/port.ts`
