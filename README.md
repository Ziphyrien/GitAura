# WebAura

Local-first AI tools, running in your browser.

---

## Privacy

**We don’t run a backend that stores your chats or credentials.** Session history, model choice, app settings, optional GitHub token, provider keys / OAuth, and usage totals live **only in this browser** (IndexedDB via [Dexie](https://github.com/dexie/Dexie.js)).

**The app still uses the network:** Browser modules call the network services they are built for. The current GitHub module calls **GitHub’s API** directly to load repository data. Model requests go directly to the providers you configure, unless you explicitly route them through **Settings -> Proxy**.

---

## Models & modules

| Setting                   | What it’s for                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings -> Providers** | LLM API keys and OAuth credentials for the model providers you use.                                                                      |
| **Settings -> GitHub**    | Optional **PAT** for the GitHub module, stored only in this browser for higher API limits, private repo access, and GitHub Gist sharing. |

---

## Analytics

We use **Vercel** (hosting) and **OneDollar Stats** for **aggregate** traffic and product analytics. These are **private** to the project and are **not** used to inspect your chats, prompts, or repository contents.

---

## How it works

- **Browser workspace** - Run local-first AI workflows in the browser without a hosted product account.
- **Modular surface** - GitHub repo chat is the current built-in module; more browser-native modules can be added behind feature switches or extensions.
- **Stack** - [pi-mono](https://github.com/badlogic/pi-mono) with direct browser API access for module data.
- **Local first** - Agent work runs in a per-tab `DedicatedWorker`; durable state stays on the main thread through IndexedDB.
- **Resilient** - Lease ownership, runtime recovery, and interrupted-turn repair all stay inside the browser runtime.

Inspired by [Sitegeist](https://sitegeist.ai), [btca](https://github.com/davis7dotsh/better-context), and [repogrep](https://repogrep.com).

---

## Rate limits

Unauthenticated GitHub API requests are limited to **60 requests/hour**. With a token, GitHub raises that to **5,000 requests/hour**. Add a token under **Settings -> GitHub** in the app.

---

## AI Disclosure

This codebase has been built with substantial AI assistance. Very little is hand-written; **GPT-5.4** was used heavily to create and iterate on the repository.

---

## License

[AGPL-3.0](LICENSE)

## Copyright

WebAura is a fork of gitinspect by Jeremy Osih.

Copyright (C) 2026 Ziphyrien and contributors.
Original project: <https://github.com/jeremyosih/gitinspect>

Licensed under the GNU Affero General Public License v3.0.
