# Nostr.watch Discovery Endpoint Check

## Summary

Nostr.watch's old public REST endpoints are not usable for free browser relay discovery right now. The practical replacement path is NIP-66 relay discovery events (`kind: 30166`) read from Nostr relays, especially `wss://relay.nostr.watch`, which returned valid NIP-66 events in live probing.

## HTTP Endpoint Probe Results

Checked on 2026-05-01 from the local workspace.

| URL | Result | Notes |
|-----|--------|-------|
| `https://api.nostr.watch/v1/online` | HTTP 502 | Not usable. |
| `https://api.nostr.watch/v1/relays` | HTTP 502 | Not usable. |
| `https://api.nostr.watch/v1/offline` | HTTP 502 | Not usable. |
| `https://api.nostr.watch/v1/online?public=true` | HTTP 502 | Not usable. |
| `https://api.nostr.watch/v1/relays?public=true` | HTTP 502 | Not usable. |
| `https://api.nostr.watch/v2/online` | HTTP 404 JSON | `NOT_FOUND`. |
| `https://api.nostr.watch/v2/relays` | HTTP 402 JSON | `Payment Required`; not suitable for free discovery. |
| `https://nostr.watch/api/v1/online` | HTTP 200 HTML | App shell, not JSON API. |
| `https://nostr.watch/api/v1/relays` | HTTP 200 HTML | App shell, not JSON API. |
| `https://nostr.watch/api/online` | HTTP 200 HTML | App shell, not JSON API. |
| `https://nostr.watch/api/relays` | HTTP 200 HTML | App shell, not JSON API. |
| `https://api.nostr.watch/relays?limit=5` | HTTP 200 HTML | App shell, not JSON API. |
| `https://api.nostr.watch/docs` | HTTP 200 HTML | App shell, not OpenAPI JSON/docs endpoint. |
| `https://rstate.nostr.watch/*` | DNS failure | No public host found. |
| `https://relay-state.nostr.watch/*` | DNS failure | No public host found. |

## Nostr.watch Repository Findings

- Repository: `sandwichfarm/nostr-watch`.
- README describes Nostr.watch as a NIP-66 stack rather than only a REST relay-list service.
- `@nostrwatch/rstate` is a relay state machine with REST endpoints such as `/relays` and `/relays/search`, but docs describe local/self-hosted use. No public deployed REST host was confirmed.
- `apps/rstate/README.md` references ingestion relays such as `wss://history.nostr.watch`.

## Live NIP-66 Probe Results

Queried kind `30166` events via WebSocket Nostr relay protocol.

| Relay | Result | Notes |
|-------|--------|-------|
| `wss://history.nostr.watch` | WebSocket error | Not usable in this probe. |
| `wss://relay.nostr.watch` | Success | Returned `kind: 30166` events with relay URL in `d`, RTT tags, NIP tags, and NIP-11 JSON in content. |
| `wss://relay.damus.io` | Success | Returned some `kind: 30166` events, but using it as a seed would be a hardcoded non-Nostr.watch fallback. |
| `wss://nos.lol` | Success | Returned some `kind: 30166` events, but using it as a seed would be a hardcoded non-Nostr.watch fallback. |

Example `wss://relay.nostr.watch` tags from a returned event:

```json
[
  ["d", "wss://nostr.hoppe-relay.it.com/"],
  ["rtt-open", "944"],
  ["rtt-read", "142"],
  ["n", "clearnet"],
  ["N", "1"],
  ["N", "2"],
  ["N", "4"]
]
```

## NIP-66 Semantics Relevant To WebAura

NIP-66 defines relay discovery/liveness events:

- `kind: 30166` relay discovery events.
- Relay URL appears in `d` tags, and sometimes `r` tags.
- RTT tags include values such as `rtt-open`, `rtt-read`, and `rtt-write`.
- Requirement tags such as `R` can include values like `auth`, `payment`, or negated forms such as `!payment` depending on monitor output.
- `content` may include stringified NIP-11 relay metadata.
- NIP-66 warns clients not to trust a single source blindly; data should be treated as hints and verified by probing.

## Recommendation

Do not use the old Nostr.watch REST endpoints for browser discovery.

Recommended replacement:

1. Query `kind: 30166` from `wss://relay.nostr.watch` as the Nostr.watch-backed discovery source.
2. Parse relay candidates from `d`/`r` tags and metadata from tags/content.
3. Treat NIP-66 data only as candidate hints.
4. Keep existing verification/probing before publishing: require explicit suitable read/write behavior, no auth/payment, and sufficient content/message limits.
5. If `wss://relay.nostr.watch` is unavailable or verified candidates are insufficient, fail clearly instead of falling back to a hardcoded relay pool.

## Implication For Proxy Task

The previous proxy approach is insufficient because the proxied HTTP targets return server errors or paid responses. Proxying cannot make `v1` endpoints usable and `v2/relays` is not free. The task should be reframed from `proxy Nostr.watch REST discovery` to `replace REST discovery with NIP-66 relay discovery from Nostr.watch relay`.
