# Use NIP-66 For Nostr.watch Discovery

## Goal

Replace the broken Nostr.watch REST discovery path with NIP-66 relay discovery events from `wss://relay.nostr.watch`. This avoids unusable `api.nostr.watch` REST endpoints, avoids proxying a failing/paid API, and preserves the rule that WebAura must fail clearly instead of guessing or using static relay fallbacks.

## Requirements

- Remove old Nostr.watch REST discovery endpoints from the share discovery implementation.
- Do not call `https://api.nostr.watch/v1/*`, `https://api.nostr.watch/v2/*`, or any old REST endpoint for relay discovery.
- Do not route Nostr.watch discovery through the project HTTP proxy; the REST API is not usable and proxying it only returns upstream failures.
- Query `wss://relay.nostr.watch` for NIP-66 `kind: 30166` relay discovery events.
- Use the existing HTTP proxy for optional NIP-11 relay metadata fetches when proxy settings are enabled, because many relay metadata endpoints block browser CORS.
- Parse relay candidates from NIP-66 event tags, especially relay URLs in `d`/`r` tags and latency hints such as `rtt-open`, `rtt-read`, and `rtt-write`.
- Parse optional NIP-11 metadata from NIP-66 event `content` when it is JSON.
- Treat NIP-66 data as hints only; keep relay probing/verification before publishing.
- Require verified suitable relays for publishing: explicit WebSocket read/write verification, no auth/payment requirement, and content/message limits large enough for share chunks.
- Do not add static relay fallback lists, alternate storage transports, backend APIs, database schema, auth, deletion/editing/stats, or guesses when discovery is uncertain.
- If `wss://relay.nostr.watch` is unavailable or not enough candidates verify, fail clearly with the existing publish failure behavior before publishing chunks.

## Acceptance Criteria

- [ ] Browser discovery no longer fetches old `api.nostr.watch` REST endpoints.
- [ ] Browser discovery sends a Nostr `REQ` for `kind: 30166` to `wss://relay.nostr.watch`.
- [ ] Discovery parses relay URLs, latency hints, payment/auth tags, and JSON metadata from NIP-66 events.
- [ ] Existing publish selection still filters paid/auth/small/unverified candidates and never uses static fallback relays.
- [ ] Failure to read NIP-66 discovery events produces no publish attempts and surfaces `publish_failed` through existing share behavior.
- [ ] Existing share tests still pass.
- [ ] Type-check passes for changed packages.

## Definition of Done

- Tests cover NIP-66 discovery parsing and WebSocket request shape.
- Tests prove old REST endpoints are not used.
- Tests prove no fallback publishing happens when NIP-66 discovery fails or yields insufficient verified candidates.
- No server, DB, static relay fallback, or proxy-to-REST logic is introduced.
- Targeted share tests and `@webaura/pi` type-check pass.

## Technical Approach

- Replace `NOSTR_WATCH_DISCOVERY_ENDPOINTS` and `fetchJsonWithTimeout()` use in `BrowserNostrRelayDiscovery.discoverRelays()` with a WebSocket discovery request against `wss://relay.nostr.watch`.
- Reuse existing `openRelaySocket()`, relay message parsing, candidate normalization, and later probe/selection pipeline where practical.
- Add helper(s) to map NIP-66 events into `NostrRelayCandidate` objects.
- Use a bounded request timeout and limit when requesting kind `30166` events.
- Keep `probeRelay()` as active relay protocol verification: open the candidate relay WebSocket, confirm it accepts reads, confirm it accepts a signed short WebAura probe event, then optionally fetch NIP-11 HTTP metadata through `getProxyConfig()` and `buildProxiedUrl()` when proxy settings are enabled.

## Decision (ADR-lite)

**Context**: Live checks showed old Nostr.watch REST endpoints are not usable for free browser discovery: `v1` returns 502, `v2/relays` returns 402 Payment Required, and several app paths return HTML shells. `wss://relay.nostr.watch` returned valid NIP-66 `kind: 30166` discovery events.

**Decision**: Stop using Nostr.watch REST discovery. Use `wss://relay.nostr.watch` and NIP-66 discovery events as the Nostr.watch-backed candidate source.

**Consequences**: Discovery no longer depends on a broken/paid REST API or CORS proxy. It does depend on one Nostr.watch relay as the discovery source; if it is unavailable, WebAura fails clearly instead of guessing.

## Out of Scope

- Supporting old Nostr.watch REST API endpoints.
- Proxying old REST endpoints.
- Adding static relay fallback lists.
- Adding alternative discovery providers beyond Nostr.watch NIP-66 relay events.
- Proxying Nostr relay WebSocket discovery, publish, or read operations.
- Adding server endpoints, DB schema, accounts, deletion/editing/stats, or alternate storage.

## Research References

- [`research/nostr-watch-discovery.md`](research/nostr-watch-discovery.md) — live endpoint checks and NIP-66 replacement recommendation.

## Technical Notes

- Existing share discovery code: `packages/pi/src/lib/share.ts`, `BrowserNostrRelayDiscovery.discoverRelays()`.
- Existing share contract spec: `.trellis/spec/pi/frontend/share-link-contracts.md`.
- NIP-66 reference: `kind: 30166` relay discovery events with relay URLs in `d`/`r` tags and optional NIP-11 JSON content.
