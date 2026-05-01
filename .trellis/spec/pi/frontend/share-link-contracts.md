# Share Link Contracts

## Scenario: Client-Only Conversation Share Links

### 1. Scope / Trigger

- Trigger: Share links cross the chat UI, route parsing, browser crypto, and Nostr relay transport boundaries.
- Scope: `@webaura/pi/lib/share` owns share snapshot creation, link encoding, encryption, Nostr event assembly, relay publishing, relay reading, and payload validation.
- Non-goals: Do not add backend APIs, database schema, accounts, edit/delete flows, stats, or durable-storage promises for this share mechanism.

### 2. Signatures

```ts
export function buildShareSnapshot(
  messages: readonly DisplayChatMessage[],
  options?: BuildShareSnapshotOptions,
): ShareSnapshot;

export async function createShareLink(
  snapshot: ShareSnapshot,
  options?: CreateShareLinkOptions,
): Promise<CreatedShareLink>;

export async function readShareFromFragment(
  hash: string,
  options?: { relayTransport?: NostrRelayTransport },
): Promise<ShareSnapshot>;

export interface NostrRelayDiscovery {
  discoverRelays(): Promise<NostrRelayCandidate[]>;
  probeRelay(candidate: NostrRelayCandidate): Promise<NostrRelayProbeResult>;
}
```

### 3. Contracts

- URL mode is selected when the encoded WebAura fragment is `<= 16KB`.
- Nostr mode is selected when compressed payload bytes are `> 16KB` and `<= 300KB`.
- Payloads `> 300KB` must throw `ShareError` with `code: "oversized"` before any relay publish attempt.
- The URL path/query must not contain plaintext conversation content or the encryption key.
- The encryption key belongs only in the URL fragment.
- Nostr relays receive encrypted chunk content plus public event metadata only.
- Nostr shares use one fresh signing key per share and include the successful relay URLs in the fragment.
- Nostr publish relays must be dynamically discovered and verified through `NostrRelayDiscovery` unless tests explicitly inject relays.
- Do not keep or use a hardcoded publish relay fallback list. If discovery/probing cannot prove enough suitable relays, fail clearly instead of guessing.
- Relay candidates requiring auth/payment, lacking explicit read/write verification, or advertising too-small content/message limits must not be used for publishing.
- Nostr chunks are published before the manifest.
- Readers must validate Nostr event ids, pubkeys, Schnorr signatures, chunk descriptors, chunk sizes, chunk hashes, and total encrypted payload size before decrypting.

### 4. Validation & Error Matrix

- Missing WebAura fragment prefix -> `ShareError("invalid_link")`.
- Unsupported share version -> `ShareError("unsupported_version")`.
- Malformed fragment or snapshot JSON -> `ShareError("invalid_link")`.
- AES-GCM decrypt failure -> `ShareError("decrypt_failed")`.
- Payload too large before publish or after decode -> `ShareError("oversized")`.
- Nostr.watch discovery or relay probing cannot produce at least two verified publish relays -> `ShareError("publish_failed")`.
- Fewer than two successful relay writes -> `ShareError("publish_failed")`.
- Missing/tampered manifest -> `ShareError("missing_manifest")`.
- Missing/tampered chunk -> `ShareError("missing_chunks")`.
- Browser relay socket failure -> `ShareError("relay_failed")`.

### 5. Good/Base/Bad Cases

- Good: A short chat produces `/share#wa1...`, opens without network access, and renders the same sanitized transcript.
- Base: A medium chat publishes encrypted chunks to multiple discovered, verified relays, records only successful relays in the link, and reads successfully when at least one copy of every event survives.
- Bad: Discovery returns one relay or only unverified candidates; publish fails before sending any chunks instead of using a static fallback.
- Bad: A relay returns an event with the requested id but invalid signature; the reader rejects it before assembling or decrypting payload bytes.

### 6. Tests Required

- Assert snapshot sanitization removes thinking text, tool calls, tool results, and raw attachment data.
- Assert URL mode link creation keeps plaintext out of the non-fragment URL and round-trips through `readShareFromFragment`.
- Assert oversized payloads reject before publishing.
- Assert Nostr publish order sends chunks before the manifest.
- Assert Nostr discovery ranks verified low-latency candidates and filters paid/auth/small/unverified relays.
- Assert Nostr publish fails without static fallback when discovery cannot produce enough verified relays.
- Assert Nostr read tolerates partial relay failure.
- Assert tampered Nostr event ids/signatures/hash/size metadata are rejected.

### 7. Wrong vs Correct

#### Wrong

```ts
const link = `/share?payload=${encodeURIComponent(JSON.stringify(snapshot))}`;
```

This leaks plaintext through query strings, browser history, logs, and referrers.

#### Correct

```ts
const share = await createShareLink(snapshot);
await navigator.clipboard.writeText(share.link);
```

The share module selects URL or Nostr mode, encrypts payload bytes, and keeps decryption material in the fragment only.
