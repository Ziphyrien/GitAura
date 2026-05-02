import { schnorr } from "@noble/curves/secp256k1";
import { getAssistantText, getUserAttachments, getUserText } from "@webaura/pi/lib/chat-adapter";
import { getProxyConfig } from "@webaura/pi/proxy/settings";
import { buildProxiedUrl } from "@webaura/pi/proxy/url";
import type { DisplayChatMessage } from "@webaura/pi/types/chat";

export const SHARE_FRAGMENT_PREFIX = "wa1.";
export const SHARE_VERSION = 1;
export const SHARE_APP_ID = "webaura";
export const URL_FRAGMENT_LIMIT_BYTES = 16 * 1024;
export const NOSTR_PAYLOAD_LIMIT_BYTES = 300 * 1024;
const NOSTR_ENCRYPTED_PAYLOAD_LIMIT_BYTES = NOSTR_PAYLOAD_LIMIT_BYTES + 16;
export const NOSTR_CHUNK_SIZE_BYTES = 8 * 1024;
const MIN_NOSTR_CHUNK_SIZE_BYTES = 1024;
export const MIN_SUCCESSFUL_NOSTR_RELAYS = 2;
const MAX_NOSTR_DISCOVERY_CANDIDATES = 24;
const MAX_NOSTR_PUBLISH_RELAYS = 6;
const TARGET_NOSTR_DISCOVERED_PUBLISH_RELAYS = 3;
const NOSTR_RELAY_PROBE_BATCH_SIZE = 6;
const NOSTR_RELAY_PROBE_TIMEOUT_MS = 5000;
const NOSTR_DISCOVERY_REQUEST_TIMEOUT_MS = 8000;
const NOSTR_PUBLISH_EVENT_ATTEMPTS = 3;
const NOSTR_RELAY_PROBE_EXPIRATION_SECONDS = 60 * 60;
const NOSTR_WATCH_DISCOVERY_RELAY_URL = "wss://relay.nostr.watch";
const NIP66_RELAY_DISCOVERY_KIND = 30166;
const NIP66_DISCOVERY_LIMIT = 100;
const MIN_NOSTR_RELAY_CONTENT_BYTES = Math.ceil((NOSTR_CHUNK_SIZE_BYTES * 4) / 3);
const MIN_NOSTR_RELAY_MESSAGE_BYTES = NOSTR_CHUNK_SIZE_BYTES * 2;

const SHARE_EVENT_KIND = 30078;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

type CompressionMode = "gzip" | "identity";
type FragmentMode = "url" | "nostr";

export type ShareErrorCode =
  | "decrypt_failed"
  | "invalid_link"
  | "missing_chunks"
  | "missing_manifest"
  | "oversized"
  | "publish_failed"
  | "relay_failed"
  | "unsupported_version";

export class ShareError extends Error {
  readonly code: ShareErrorCode;

  constructor(code: ShareErrorCode, message: string) {
    super(message);
    this.name = "ShareError";
    this.code = code;
  }
}

export interface ShareAttachmentSnapshot {
  fileName: string;
  mediaType: string;
  size?: number;
  type: "document" | "image";
}

export interface ShareMessageSnapshot {
  attachments?: ShareAttachmentSnapshot[];
  content: string;
  role: "assistant" | "system" | "user";
  timestamp?: number;
}

export interface ShareSnapshot {
  app: typeof SHARE_APP_ID;
  createdAt: string;
  messages: ShareMessageSnapshot[];
  metadata?: {
    model?: string;
    provider?: string;
    title?: string;
  };
  version: typeof SHARE_VERSION;
}

export interface BuildShareSnapshotOptions {
  createdAt?: Date;
  model?: string;
  provider?: string;
  title?: string;
}

export interface CreateShareLinkOptions {
  baseUrl?: string;
  compression?: CompressionMode;
  now?: Date;
  relayDiscovery?: NostrRelayDiscovery;
  relays?: readonly string[];
  relayTransport?: NostrRelayTransport;
}

export interface CreatedShareLink {
  link: string;
  mode: FragmentMode;
  payloadBytes: number;
  relays?: string[];
}

interface UrlShareFragment {
  c: CompressionMode;
  iv: string;
  k: string;
  p: string;
  t: "url";
  v: typeof SHARE_VERSION;
}

interface NostrShareFragment {
  iv: string;
  k: string;
  m: string;
  p: string;
  r: string[];
  t: "nostr";
  v: typeof SHARE_VERSION;
}

type ShareFragment = NostrShareFragment | UrlShareFragment;

export interface NostrEvent {
  content: string;
  created_at: number;
  id: string;
  kind: number;
  pubkey: string;
  sig: string;
  tags: string[][];
}

interface UnsignedNostrEvent {
  content: string;
  created_at: number;
  kind: number;
  pubkey: string;
  tags: string[][];
}

export interface NostrChunkDescriptor {
  eventId: string;
  hash: string;
  index: number;
  size: number;
}

export interface NostrManifestContent {
  app: typeof SHARE_APP_ID;
  chunkSize: number;
  chunks: NostrChunkDescriptor[];
  compression: CompressionMode;
  encryptedBytes: number;
  shareId: string;
  version: typeof SHARE_VERSION;
}

export interface BuiltNostrShare {
  chunkEvents: NostrEvent[];
  manifest: NostrManifestContent;
  manifestEvent: NostrEvent;
  pubkey: string;
}

export interface NostrRelayTransport {
  fetchEvents(relayUrl: string, eventIds: readonly string[]): Promise<NostrEvent[]>;
  publishEvents(relayUrl: string, events: readonly NostrEvent[]): Promise<void>;
}

export interface NostrRelayCandidate {
  authRequired?: boolean;
  latencyMs?: number;
  maxContentLength?: number;
  maxMessageLength?: number;
  paymentRequired?: boolean;
  read?: boolean;
  url: string;
  write?: boolean;
}

export interface NostrRelayProbeResult {
  authRequired?: boolean;
  latencyMs?: number;
  maxContentLength?: number;
  maxMessageLength?: number;
  paymentRequired?: boolean;
  read?: boolean;
  url?: string;
  write?: boolean;
}

export interface NostrRelayDiscovery {
  discoverRelays(): Promise<NostrRelayCandidate[]>;
  probeRelay(candidate: NostrRelayCandidate): Promise<NostrRelayProbeResult>;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function buildShareSnapshot(
  messages: readonly DisplayChatMessage[],
  options: BuildShareSnapshotOptions = {},
): ShareSnapshot {
  const snapshotMessages: ShareMessageSnapshot[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user": {
        const content = getUserText(message).trim();
        const attachments = getUserAttachments(message).map((attachment) => ({
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          size: attachment.size,
          type: attachment.type,
        }));

        if (content || attachments.length > 0) {
          snapshotMessages.push({
            attachments: attachments.length > 0 ? attachments : undefined,
            content,
            role: "user",
            timestamp: message.timestamp,
          });
        }
        break;
      }
      case "assistant": {
        const content = getAssistantText(message).trim();

        if (content) {
          snapshotMessages.push({
            content,
            role: "assistant",
            timestamp: message.timestamp,
          });
        }
        break;
      }
      case "system": {
        const content = message.message.trim();

        if (content) {
          snapshotMessages.push({
            content,
            role: "system",
            timestamp: message.timestamp,
          });
        }
        break;
      }
      case "toolResult":
        break;
      default:
        assertNever(message);
    }
  }

  const metadata = {
    model: normalizeOptionalText(options.model),
    provider: normalizeOptionalText(options.provider),
    title: normalizeOptionalText(options.title),
  };

  return {
    app: SHARE_APP_ID,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    messages: snapshotMessages,
    metadata:
      metadata.model || metadata.provider || metadata.title
        ? {
            ...(metadata.model ? { model: metadata.model } : {}),
            ...(metadata.provider ? { provider: metadata.provider } : {}),
            ...(metadata.title ? { title: metadata.title } : {}),
          }
        : undefined,
    version: SHARE_VERSION,
  };
}

export function getSharePayloadSize(snapshot: ShareSnapshot): number {
  return TEXT_ENCODER.encode(JSON.stringify(snapshot)).byteLength;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 8192;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }

  const binary = chunks.join("");

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) {
    throw new ShareError("invalid_link", "The share link contains invalid hex data.");
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function isHex(value: string, bytes?: number): boolean {
  return /^[0-9a-f]+$/i.test(value) && (bytes === undefined || value.length === bytes * 2);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function compressBytes(
  bytes: Uint8Array,
  requested?: CompressionMode,
): Promise<{
  bytes: Uint8Array;
  compression: CompressionMode;
}> {
  if (requested === "identity" || typeof CompressionStream === "undefined") {
    return { bytes, compression: "identity" };
  }

  const stream = new Blob([toArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return {
    bytes: new Uint8Array(await new Response(stream).arrayBuffer()),
    compression: "gzip",
  };
}

async function decompressBytes(
  bytes: Uint8Array,
  compression: CompressionMode,
): Promise<Uint8Array> {
  switch (compression) {
    case "identity":
      return bytes;
    case "gzip": {
      if (typeof DecompressionStream === "undefined") {
        throw new ShareError("invalid_link", "This browser cannot decompress the shared chat.");
      }

      try {
        const stream = new Blob([toArrayBuffer(bytes)])
          .stream()
          .pipeThrough(new DecompressionStream("gzip"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        throw new ShareError("invalid_link", "The shared chat could not be decompressed.");
      }
    }
    default:
      assertNever(compression);
  }
}

async function encryptPayload(bytes: Uint8Array): Promise<{
  ciphertext: Uint8Array;
  iv: Uint8Array;
  key: Uint8Array;
}> {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { iv: toArrayBuffer(iv), name: "AES-GCM" },
      cryptoKey,
      toArrayBuffer(bytes),
    ),
  );

  return { ciphertext, iv, key };
}

async function decryptPayload(input: {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  key: Uint8Array;
}): Promise<Uint8Array> {
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(input.key),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { iv: toArrayBuffer(input.iv), name: "AES-GCM" },
        cryptoKey,
        toArrayBuffer(input.ciphertext),
      ),
    );
  } catch {
    throw new ShareError("decrypt_failed", "The share link could not decrypt this chat.");
  }
}

function encodeFragment(fragment: ShareFragment): string {
  return `${SHARE_FRAGMENT_PREFIX}${bytesToBase64Url(TEXT_ENCODER.encode(JSON.stringify(fragment)))}`;
}

export function parseShareFragment(hash: string): ShareFragment {
  const token = hash.startsWith("#") ? hash.slice(1) : hash;

  if (!token.startsWith(SHARE_FRAGMENT_PREFIX)) {
    throw new ShareError("invalid_link", "This is not a WebAura share link.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(
      TEXT_DECODER.decode(base64UrlToBytes(token.slice(SHARE_FRAGMENT_PREFIX.length))),
    );
  } catch {
    throw new ShareError("invalid_link", "The share link is malformed.");
  }

  if (!isRecord(parsed) || parsed.v !== SHARE_VERSION) {
    throw new ShareError("unsupported_version", "This share link version is not supported.");
  }

  if (parsed.t === "url") {
    if (
      (parsed.c !== "gzip" && parsed.c !== "identity") ||
      typeof parsed.iv !== "string" ||
      typeof parsed.k !== "string" ||
      typeof parsed.p !== "string"
    ) {
      throw new ShareError("invalid_link", "The share link is missing required URL payload data.");
    }

    return {
      c: parsed.c,
      iv: parsed.iv,
      k: parsed.k,
      p: parsed.p,
      t: "url",
      v: SHARE_VERSION,
    };
  }

  if (parsed.t === "nostr") {
    if (
      typeof parsed.iv !== "string" ||
      typeof parsed.k !== "string" ||
      typeof parsed.m !== "string" ||
      typeof parsed.p !== "string" ||
      !Array.isArray(parsed.r) ||
      !parsed.r.every((relay) => typeof relay === "string")
    ) {
      throw new ShareError("invalid_link", "The share link is missing required Nostr data.");
    }

    return {
      iv: parsed.iv,
      k: parsed.k,
      m: parsed.m,
      p: parsed.p,
      r: parsed.r,
      t: "nostr",
      v: SHARE_VERSION,
    };
  }

  throw new ShareError("invalid_link", "The share link uses an unknown transport.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateShareSnapshot(value: unknown): ShareSnapshot {
  if (!isRecord(value) || value.app !== SHARE_APP_ID || value.version !== SHARE_VERSION) {
    throw new ShareError("invalid_link", "The shared chat data is not a WebAura snapshot.");
  }

  if (typeof value.createdAt !== "string" || !Array.isArray(value.messages)) {
    throw new ShareError("invalid_link", "The shared chat snapshot is missing required fields.");
  }

  const messages: ShareMessageSnapshot[] = value.messages.map((message) => {
    if (!isRecord(message)) {
      throw new ShareError("invalid_link", "The shared chat contains an invalid message.");
    }

    if (message.role !== "assistant" && message.role !== "system" && message.role !== "user") {
      throw new ShareError("invalid_link", "The shared chat contains an unsupported message role.");
    }

    if (typeof message.content !== "string") {
      throw new ShareError("invalid_link", "The shared chat contains invalid message content.");
    }

    return {
      attachments: Array.isArray(message.attachments)
        ? message.attachments.flatMap((attachment) => {
            if (!isRecord(attachment)) {
              return [];
            }

            if (
              typeof attachment.fileName !== "string" ||
              typeof attachment.mediaType !== "string" ||
              (attachment.type !== "document" && attachment.type !== "image")
            ) {
              return [];
            }

            return [
              {
                fileName: attachment.fileName,
                mediaType: attachment.mediaType,
                size: typeof attachment.size === "number" ? attachment.size : undefined,
                type: attachment.type,
              },
            ];
          })
        : undefined,
      content: message.content,
      role: message.role,
      timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
    };
  });

  const metadata = isRecord(value.metadata)
    ? {
        model: typeof value.metadata.model === "string" ? value.metadata.model : undefined,
        provider: typeof value.metadata.provider === "string" ? value.metadata.provider : undefined,
        title: typeof value.metadata.title === "string" ? value.metadata.title : undefined,
      }
    : undefined;

  return {
    app: SHARE_APP_ID,
    createdAt: value.createdAt,
    messages,
    metadata,
    version: SHARE_VERSION,
  };
}

async function decodeSnapshotPayload(
  bytes: Uint8Array,
  compression: CompressionMode,
): Promise<ShareSnapshot> {
  const decompressed = await decompressBytes(bytes, compression);

  if (decompressed.byteLength > NOSTR_PAYLOAD_LIMIT_BYTES) {
    throw new ShareError("oversized", "The shared chat is larger than WebAura can open safely.");
  }

  try {
    return validateShareSnapshot(JSON.parse(TEXT_DECODER.decode(decompressed)));
  } catch (error) {
    if (error instanceof ShareError) {
      throw error;
    }

    throw new ShareError("invalid_link", "The shared chat data is malformed.");
  }
}

function buildShareUrl(baseUrl: string | undefined, fragment: string): string {
  const resolvedBaseUrl = (baseUrl ?? window.location.origin).replace(/\/$/, "");
  return `${resolvedBaseUrl}/share#${fragment}`;
}

function getPayloadTooLargeMessage(payloadBytes: number): string {
  const kib = Math.ceil(payloadBytes / 1024);
  return `This conversation is ${kib}KB after encoding. Share a shorter conversation to stay under the 300KB share limit.`;
}

export async function createShareLink(
  snapshot: ShareSnapshot,
  options: CreateShareLinkOptions = {},
): Promise<CreatedShareLink> {
  if (snapshot.messages.length === 0) {
    throw new ShareError("invalid_link", "There is no conversation content to share.");
  }

  const raw = TEXT_ENCODER.encode(JSON.stringify(snapshot));
  const compressed = await compressBytes(raw, options.compression);

  if (compressed.bytes.byteLength > NOSTR_PAYLOAD_LIMIT_BYTES) {
    throw new ShareError("oversized", getPayloadTooLargeMessage(compressed.bytes.byteLength));
  }

  const encrypted = await encryptPayload(compressed.bytes);
  const urlFragment = encodeFragment({
    c: compressed.compression,
    iv: bytesToBase64Url(encrypted.iv),
    k: bytesToBase64Url(encrypted.key),
    p: bytesToBase64Url(encrypted.ciphertext),
    t: "url",
    v: SHARE_VERSION,
  });

  if (urlFragment.length <= URL_FRAGMENT_LIMIT_BYTES) {
    return {
      link: buildShareUrl(options.baseUrl, urlFragment),
      mode: "url",
      payloadBytes: compressed.bytes.byteLength,
    };
  }

  const published = await publishNostrShare(
    {
      ciphertext: encrypted.ciphertext,
      compression: compressed.compression,
    },
    {
      now: options.now,
      relayDiscovery: options.relayDiscovery,
      relayTransport: options.relayTransport,
      relays: options.relays,
    },
  );
  const nostrFragment = encodeFragment({
    iv: bytesToBase64Url(encrypted.iv),
    k: bytesToBase64Url(encrypted.key),
    m: published.manifestEvent.id,
    p: published.pubkey,
    r: published.relays,
    t: "nostr",
    v: SHARE_VERSION,
  });

  return {
    link: buildShareUrl(options.baseUrl, nostrFragment),
    mode: "nostr",
    payloadBytes: compressed.bytes.byteLength,
    relays: published.relays,
  };
}

export async function readShareFromFragment(
  hash: string,
  options: { relayTransport?: NostrRelayTransport } = {},
): Promise<ShareSnapshot> {
  const fragment = parseShareFragment(hash);

  if (fragment.t === "url") {
    const plaintext = await decryptPayload({
      ciphertext: base64UrlToBytes(fragment.p),
      iv: base64UrlToBytes(fragment.iv),
      key: base64UrlToBytes(fragment.k),
    });
    return decodeSnapshotPayload(plaintext, fragment.c);
  }

  const manifestEvent = await fetchNostrManifest(fragment, options.relayTransport);
  const manifest = parseManifest(manifestEvent.content);
  const chunkEvents = await fetchNostrChunks(
    fragment.r,
    manifest,
    options.relayTransport,
    manifestEvent.pubkey,
  );
  const ciphertext = await assembleNostrCiphertext(manifest, chunkEvents);
  const plaintext = await decryptPayload({
    ciphertext,
    iv: base64UrlToBytes(fragment.iv),
    key: base64UrlToBytes(fragment.k),
  });

  return decodeSnapshotPayload(plaintext, manifest.compression);
}

function createUnsignedEvent(input: {
  content: string;
  kind?: number;
  now?: Date;
  pubkey: string;
  tags: string[][];
}): UnsignedNostrEvent {
  return {
    content: input.content,
    created_at: Math.floor((input.now ?? new Date()).getTime() / 1000),
    kind: input.kind ?? SHARE_EVENT_KIND,
    pubkey: input.pubkey,
    tags: input.tags,
  };
}

async function getEventIdBytes(event: UnsignedNostrEvent): Promise<Uint8Array> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return sha256(TEXT_ENCODER.encode(serialized));
}

async function getEventId(event: UnsignedNostrEvent): Promise<string> {
  return bytesToHex(await getEventIdBytes(event));
}

async function signEvent(event: UnsignedNostrEvent, secretKey: Uint8Array): Promise<NostrEvent> {
  const idBytes = await getEventIdBytes(event);
  const sig = schnorr.sign(idBytes, secretKey);

  return {
    ...event,
    id: bytesToHex(idBytes),
    sig: bytesToHex(sig),
  };
}

async function verifyNostrEvent(
  event: NostrEvent,
  errorCode: "missing_chunks" | "missing_manifest",
  message: string,
): Promise<void> {
  if (!isHex(event.id, 32) || !isHex(event.pubkey, 32) || !isHex(event.sig, 64)) {
    throw new ShareError(errorCode, message);
  }

  const expectedId = await getEventId(event);

  if (expectedId !== event.id) {
    throw new ShareError(errorCode, message);
  }

  let signatureValid = false;

  try {
    signatureValid = schnorr.verify(
      hexToBytes(event.sig),
      hexToBytes(event.id),
      hexToBytes(event.pubkey),
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    throw new ShareError(errorCode, message);
  }
}

export async function buildNostrShareEvents(input: {
  ciphertext: Uint8Array;
  compression: CompressionMode;
  now?: Date;
  secretKey?: Uint8Array;
}): Promise<BuiltNostrShare> {
  const secretKey = input.secretKey ?? schnorr.utils.randomSecretKey(randomBytes(48));
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
  const shareId = bytesToBase64Url(randomBytes(16));
  const chunks = splitBytes(input.ciphertext, NOSTR_CHUNK_SIZE_BYTES);
  const chunkResults = await Promise.all(
    chunks.map(async (chunk, index) => {
      const hash = bytesToHex(await sha256(chunk));
      const event = await signEvent(
        createUnsignedEvent({
          content: bytesToBase64Url(chunk),
          now: input.now,
          pubkey,
          tags: [
            ["d", `${shareId}:chunk:${index}`],
            ["client", SHARE_APP_ID],
            ["webaura-share", shareId],
            ["type", "chunk"],
            ["index", String(index)],
            ["sha256", hash],
          ],
        }),
        secretKey,
      );

      return {
        descriptor: {
          eventId: event.id,
          hash,
          index,
          size: chunk.byteLength,
        },
        event,
      };
    }),
  );
  const chunkEvents = chunkResults.map((result) => result.event);
  const descriptors = chunkResults.map((result) => result.descriptor);

  const manifest: NostrManifestContent = {
    app: SHARE_APP_ID,
    chunkSize: NOSTR_CHUNK_SIZE_BYTES,
    chunks: descriptors,
    compression: input.compression,
    encryptedBytes: input.ciphertext.byteLength,
    shareId,
    version: SHARE_VERSION,
  };
  const manifestEvent = await signEvent(
    createUnsignedEvent({
      content: JSON.stringify(manifest),
      now: input.now,
      pubkey,
      tags: [
        ["d", `${shareId}:manifest`],
        ["client", SHARE_APP_ID],
        ["webaura-share", shareId],
        ["type", "manifest"],
      ],
    }),
    secretKey,
  );

  return {
    chunkEvents,
    manifest,
    manifestEvent,
    pubkey,
  };
}

function splitBytes(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }

  return chunks;
}

export async function publishNostrShare(
  input: { ciphertext: Uint8Array; compression: CompressionMode },
  options: {
    now?: Date;
    relayDiscovery?: NostrRelayDiscovery;
    relayTransport?: NostrRelayTransport;
    relays?: readonly string[];
  } = {},
): Promise<BuiltNostrShare & { relays: string[] }> {
  const relayTransport = options.relayTransport ?? browserNostrRelayTransport;
  const built = await buildNostrShareEvents({
    ciphertext: input.ciphertext,
    compression: input.compression,
    now: options.now,
  });
  const relays = await resolvePublishRelays(options);
  const successfulRelays: string[] = [];

  await Promise.all(
    relays.map(async (relayUrl) => {
      try {
        await relayTransport.publishEvents(relayUrl, built.chunkEvents);
        await relayTransport.publishEvents(relayUrl, [built.manifestEvent]);
        successfulRelays.push(relayUrl);
      } catch {
        // Relay publication is best-effort; redundancy is enforced after all attempts settle.
      }
    }),
  );

  if (successfulRelays.length < MIN_SUCCESSFUL_NOSTR_RELAYS) {
    throw new ShareError(
      "publish_failed",
      `Published to ${successfulRelays.length} relays. WebAura requires at least ${MIN_SUCCESSFUL_NOSTR_RELAYS} relays for a share link.`,
    );
  }

  return {
    ...built,
    relays: successfulRelays,
  };
}

async function resolvePublishRelays(options: {
  relayDiscovery?: NostrRelayDiscovery;
  relays?: readonly string[];
}): Promise<string[]> {
  if (options.relays !== undefined) {
    const relays = dedupeRelays(options.relays);

    if (relays.length < MIN_SUCCESSFUL_NOSTR_RELAYS) {
      throw new ShareError(
        "publish_failed",
        `WebAura requires at least ${MIN_SUCCESSFUL_NOSTR_RELAYS} relays for a Nostr share link.`,
      );
    }

    return relays;
  }

  const discovery = options.relayDiscovery ?? browserNostrRelayDiscovery;
  let candidates: NostrRelayCandidate[];

  try {
    candidates = await discovery.discoverRelays();
  } catch {
    candidates = [];
  }

  const relays = await selectDiscoveredPublishRelays(candidates, discovery);

  if (relays.length < MIN_SUCCESSFUL_NOSTR_RELAYS) {
    throw new ShareError(
      "publish_failed",
      `Nostr.watch discovery did not produce ${MIN_SUCCESSFUL_NOSTR_RELAYS} verified free public relays for publishing. Try again later or share a shorter conversation as a URL-only share.`,
    );
  }

  return relays;
}

async function selectDiscoveredPublishRelays(
  candidates: readonly NostrRelayCandidate[],
  discovery: NostrRelayDiscovery,
): Promise<string[]> {
  const uniqueCandidates = dedupeCandidates(candidates)
    .filter(isPotentialPublishRelay)
    .sort(compareRelayCandidates)
    .slice(0, MAX_NOSTR_DISCOVERY_CANDIDATES);

  const verified: NostrRelayCandidate[] = [];

  for (
    let index = 0;
    index < uniqueCandidates.length && verified.length < TARGET_NOSTR_DISCOVERED_PUBLISH_RELAYS;
    index += NOSTR_RELAY_PROBE_BATCH_SIZE
  ) {
    const batch = uniqueCandidates.slice(index, index + NOSTR_RELAY_PROBE_BATCH_SIZE);
    const probed = await Promise.all(
      batch.map(async (candidate) => {
        try {
          const result = await discovery.probeRelay(candidate);
          return mergeProbeResult(candidate, result);
        } catch {
          return undefined;
        }
      }),
    );

    verified.push(
      ...probed
        .filter((candidate): candidate is NostrRelayCandidate => candidate !== undefined)
        .filter(isSuitablePublishRelay),
    );
  }

  return verified
    .sort(compareRelayCandidates)
    .slice(0, MAX_NOSTR_PUBLISH_RELAYS)
    .map((candidate) => candidate.url);
}

function dedupeRelays(relays: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const relay of relays) {
    const normalized = normalizeRelayUrl(relay);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function dedupeCandidates(candidates: readonly NostrRelayCandidate[]): NostrRelayCandidate[] {
  const byUrl = new Map<string, NostrRelayCandidate>();

  for (const candidate of candidates) {
    const url = normalizeRelayUrl(candidate.url);

    if (!url || byUrl.has(url)) {
      continue;
    }

    byUrl.set(url, { ...candidate, url });
  }

  return [...byUrl.values()];
}

function normalizeRelayUrl(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "wss:" && url.protocol !== "ws:") {
      return undefined;
    }

    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function isPotentialPublishRelay(candidate: NostrRelayCandidate): boolean {
  return (
    candidate.authRequired !== true &&
    candidate.paymentRequired !== true &&
    candidate.read !== false &&
    candidate.write !== false &&
    hasEnoughRelayCapacity(candidate)
  );
}

function isSuitablePublishRelay(candidate: NostrRelayCandidate): boolean {
  return candidate.read === true && candidate.write === true && isPotentialPublishRelay(candidate);
}

function hasEnoughRelayCapacity(candidate: NostrRelayCandidate): boolean {
  return (
    (candidate.maxContentLength === undefined ||
      candidate.maxContentLength >= MIN_NOSTR_RELAY_CONTENT_BYTES) &&
    (candidate.maxMessageLength === undefined ||
      candidate.maxMessageLength >= MIN_NOSTR_RELAY_MESSAGE_BYTES)
  );
}

function compareRelayCandidates(left: NostrRelayCandidate, right: NostrRelayCandidate): number {
  const leftLatency = left.latencyMs ?? Number.POSITIVE_INFINITY;
  const rightLatency = right.latencyMs ?? Number.POSITIVE_INFINITY;

  if (leftLatency !== rightLatency) {
    return leftLatency - rightLatency;
  }

  return left.url.localeCompare(right.url);
}

function mergeProbeResult(
  candidate: NostrRelayCandidate,
  result: NostrRelayProbeResult,
): NostrRelayCandidate {
  return {
    authRequired:
      result.authRequired === true || candidate.authRequired === true
        ? true
        : (result.authRequired ?? candidate.authRequired),
    latencyMs: result.latencyMs ?? candidate.latencyMs,
    maxContentLength: result.maxContentLength ?? candidate.maxContentLength,
    maxMessageLength: result.maxMessageLength ?? candidate.maxMessageLength,
    paymentRequired:
      result.paymentRequired === true || candidate.paymentRequired === true
        ? true
        : (result.paymentRequired ?? candidate.paymentRequired),
    read: result.read ?? candidate.read,
    url: normalizeRelayUrl(result.url ?? candidate.url) ?? candidate.url,
    write: result.write ?? candidate.write,
  };
}

function parseManifest(content: string): NostrManifestContent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ShareError("missing_manifest", "The Nostr share manifest is invalid.");
  }

  if (!isRecord(parsed) || parsed.app !== SHARE_APP_ID || parsed.version !== SHARE_VERSION) {
    throw new ShareError("missing_manifest", "The Nostr share manifest is missing required data.");
  }

  if (parsed.compression !== "gzip" && parsed.compression !== "identity") {
    throw new ShareError("missing_manifest", "The Nostr share manifest is missing required data.");
  }

  if (!Number.isSafeInteger(parsed.encryptedBytes) || !Array.isArray(parsed.chunks)) {
    throw new ShareError("missing_manifest", "The Nostr share manifest is missing required data.");
  }

  const encryptedBytes = parsed.encryptedBytes as number;
  const chunks = parsed.chunks as unknown[];

  if (encryptedBytes <= 0 || encryptedBytes > NOSTR_ENCRYPTED_PAYLOAD_LIMIT_BYTES) {
    throw new ShareError("missing_manifest", "The Nostr share manifest is missing required data.");
  }

  const chunkSize = Number.isSafeInteger(parsed.chunkSize)
    ? (parsed.chunkSize as number)
    : NOSTR_CHUNK_SIZE_BYTES;

  if (chunkSize < MIN_NOSTR_CHUNK_SIZE_BYTES || chunkSize > NOSTR_CHUNK_SIZE_BYTES) {
    throw new ShareError("missing_manifest", "The Nostr share manifest has invalid chunks.");
  }

  if (chunks.length !== Math.ceil(encryptedBytes / chunkSize)) {
    throw new ShareError("missing_manifest", "The Nostr share manifest has invalid chunks.");
  }

  const seenEventIds = new Set<string>();
  const seenIndexes = new Set<number>();
  const parsedChunks = chunks.map<NostrChunkDescriptor>((chunk) => {
    if (
      !isRecord(chunk) ||
      typeof chunk.eventId !== "string" ||
      typeof chunk.hash !== "string" ||
      !Number.isSafeInteger(chunk.index) ||
      !Number.isSafeInteger(chunk.size)
    ) {
      throw new ShareError("missing_manifest", "The Nostr share manifest has invalid chunks.");
    }

    const index = chunk.index as number;
    const size = chunk.size as number;

    if (
      !isHex(chunk.eventId, 32) ||
      !isHex(chunk.hash, 32) ||
      index < 0 ||
      index >= chunks.length ||
      size <= 0 ||
      size > chunkSize
    ) {
      throw new ShareError("missing_manifest", "The Nostr share manifest has invalid chunks.");
    }

    if (seenEventIds.has(chunk.eventId) || seenIndexes.has(index)) {
      throw new ShareError("missing_manifest", "The Nostr share manifest has invalid chunks.");
    }

    const expectedSize =
      index === chunks.length - 1 ? encryptedBytes - chunkSize * (chunks.length - 1) : chunkSize;

    if (size !== expectedSize) {
      throw new ShareError("missing_manifest", "The Nostr share manifest has invalid chunks.");
    }

    seenEventIds.add(chunk.eventId);
    seenIndexes.add(index);

    return {
      eventId: chunk.eventId,
      hash: chunk.hash,
      index,
      size,
    };
  });

  return {
    app: SHARE_APP_ID,
    chunkSize,
    chunks: parsedChunks,
    compression: parsed.compression,
    encryptedBytes,
    shareId: typeof parsed.shareId === "string" ? parsed.shareId : "",
    version: SHARE_VERSION,
  };
}

async function fetchNostrManifest(
  fragment: NostrShareFragment,
  relayTransport: NostrRelayTransport | undefined,
): Promise<NostrEvent> {
  const transport = relayTransport ?? browserNostrRelayTransport;
  const events = await fetchEventsFromRelays(fragment.r, [fragment.m], transport);
  const manifest = events.get(fragment.m);

  if (!manifest) {
    throw new ShareError("missing_manifest", "Could not find the shared chat manifest on relays.");
  }

  await verifyNostrEvent(
    manifest,
    "missing_manifest",
    "The shared chat manifest failed integrity checks.",
  );

  if (manifest.pubkey !== fragment.p) {
    throw new ShareError("missing_manifest", "The shared chat manifest does not match this link.");
  }

  return manifest;
}

async function fetchNostrChunks(
  relays: readonly string[],
  manifest: NostrManifestContent,
  relayTransport: NostrRelayTransport | undefined,
  expectedPubkey: string,
): Promise<Map<string, NostrEvent>> {
  const transport = relayTransport ?? browserNostrRelayTransport;
  const events = await fetchEventsFromRelays(
    relays,
    manifest.chunks.map((chunk) => chunk.eventId),
    transport,
  );
  const missing = manifest.chunks.filter((chunk) => !events.has(chunk.eventId));

  if (missing.length > 0) {
    throw new ShareError("missing_chunks", "Some encrypted chat chunks could not be found.");
  }

  await Promise.all(
    manifest.chunks.map(async (chunk) => {
      const event = events.get(chunk.eventId);

      if (!event) {
        throw new ShareError("missing_chunks", "Some encrypted chat chunks could not be found.");
      }

      if (event.pubkey !== expectedPubkey) {
        throw new ShareError("missing_chunks", "An encrypted chat chunk does not match this link.");
      }

      await verifyNostrEvent(
        event,
        "missing_chunks",
        "An encrypted chat chunk failed integrity checks.",
      );
    }),
  );

  return events;
}

async function fetchEventsFromRelays(
  relays: readonly string[],
  eventIds: readonly string[],
  transport: NostrRelayTransport,
): Promise<Map<string, NostrEvent>> {
  const events = new Map<string, NostrEvent>();
  const requestedEventIds = new Set(eventIds);

  await Promise.all(
    relays.map(async (relayUrl) => {
      try {
        for (const event of await transport.fetchEvents(relayUrl, eventIds)) {
          if (requestedEventIds.has(event.id)) {
            events.set(event.id, event);
          }
        }
      } catch {
        // Readers can tolerate failed relays as long as another relay has the requested event.
      }
    }),
  );

  return events;
}

async function assembleNostrCiphertext(
  manifest: NostrManifestContent,
  events: Map<string, NostrEvent>,
): Promise<Uint8Array> {
  const output = new Uint8Array(manifest.encryptedBytes);

  await Promise.all(
    manifest.chunks.map(async (chunk) => {
      const event = events.get(chunk.eventId);

      if (!event) {
        throw new ShareError("missing_chunks", "Some encrypted chat chunks could not be found.");
      }

      const bytes = base64UrlToBytes(event.content);

      if (bytes.byteLength !== chunk.size) {
        throw new ShareError("missing_chunks", "An encrypted chat chunk has an invalid size.");
      }

      const actualHash = bytesToHex(await sha256(bytes));

      if (actualHash !== chunk.hash) {
        throw new ShareError("missing_chunks", "An encrypted chat chunk failed integrity checks.");
      }

      output.set(bytes, chunk.index * manifest.chunkSize);
    }),
  );

  return output;
}

class BrowserNostrRelayTransport implements NostrRelayTransport {
  async fetchEvents(relayUrl: string, eventIds: readonly string[]): Promise<NostrEvent[]> {
    const socket = await openRelaySocket(relayUrl);
    const subscriptionId = bytesToBase64Url(randomBytes(8));

    return new Promise((resolve, reject) => {
      const events: NostrEvent[] = [];
      let settled = false;

      function cleanup(): void {
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        window.clearTimeout(timeoutId);
      }

      function settle(): void {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        socket.close();
        resolve(events);
      }

      function fail(): void {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        socket.close();
        reject(new ShareError("relay_failed", `Could not read from ${relayUrl}.`));
      }

      function handleMessage(message: MessageEvent): void {
        const parsed = parseRelayMessage(message.data);

        if (!Array.isArray(parsed) || parsed[1] !== subscriptionId) {
          return;
        }

        if (parsed[0] === "EVENT" && isNostrEvent(parsed[2])) {
          events.push(parsed[2]);
        }

        if (parsed[0] === "EOSE") {
          settle();
        }
      }

      const timeoutId = window.setTimeout(settle, 8000);

      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", fail);
      socket.addEventListener("close", fail);
      socket.send(JSON.stringify(["REQ", subscriptionId, { ids: eventIds }]));
    });
  }

  async publishEvents(relayUrl: string, events: readonly NostrEvent[]): Promise<void> {
    let pendingEvents = [...events];
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= NOSTR_PUBLISH_EVENT_ATTEMPTS && pendingEvents.length > 0;
      attempt += 1
    ) {
      let socket: WebSocket;

      try {
        socket = await openRelaySocket(relayUrl);
      } catch (error) {
        lastError = error;
        continue;
      }

      try {
        const results = await Promise.all(
          pendingEvents.map(async (event) => {
            try {
              await publishEvent(socket, relayUrl, event);
              return { event, published: true as const };
            } catch (error) {
              return { error, event, published: false as const };
            }
          }),
        );

        pendingEvents = results.flatMap((result) => {
          if (result.published) {
            return [];
          }

          lastError = result.error;
          return [result.event];
        });
      } finally {
        socket.close();
      }
    }

    if (pendingEvents.length > 0) {
      if (lastError instanceof ShareError) {
        throw lastError;
      }

      throw new ShareError(
        "relay_failed",
        `Could not publish ${pendingEvents.length} share event(s) to ${relayUrl}.`,
      );
    }
  }
}

export const browserNostrRelayTransport: NostrRelayTransport = new BrowserNostrRelayTransport();

class BrowserNostrRelayDiscovery implements NostrRelayDiscovery {
  async discoverRelays(): Promise<NostrRelayCandidate[]> {
    return discoverNip66RelayCandidates(NOSTR_WATCH_DISCOVERY_RELAY_URL);
  }

  async probeRelay(candidate: NostrRelayCandidate): Promise<NostrRelayProbeResult> {
    const url = normalizeRelayUrl(candidate.url);

    if (!url) {
      throw new ShareError("relay_failed", "The discovered relay URL is invalid.");
    }

    const startedAt = nowMs();
    const activeProbe = await probeRelayReadWrite(url);
    const latencyMs = candidate.latencyMs ?? Math.max(0, Math.round(nowMs() - startedAt));

    if (activeProbe.read !== true || activeProbe.write !== true) {
      return {
        ...activeProbe,
        latencyMs,
        url,
      };
    }

    let metadata: NostrRelayProbeResult = {};

    try {
      metadata = await fetchRelayInformationDocument(url);
    } catch {
      // NIP-11 endpoints often fail through CORS/proxies. Active relay protocol checks are authoritative for read/write.
    }

    return {
      ...metadata,
      authRequired: metadata.authRequired ?? activeProbe.authRequired,
      latencyMs: metadata.latencyMs ?? latencyMs,
      paymentRequired: metadata.paymentRequired ?? activeProbe.paymentRequired,
      read: activeProbe.read,
      url,
      write: activeProbe.write,
    };
  }
}

export const browserNostrRelayDiscovery: NostrRelayDiscovery = new BrowserNostrRelayDiscovery();

async function discoverNip66RelayCandidates(relayUrl: string): Promise<NostrRelayCandidate[]> {
  const socket = await openRelaySocket(relayUrl);
  const subscriptionId = bytesToBase64Url(randomBytes(8));

  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    let settled = false;

    function cleanup(): void {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", fail);
      socket.removeEventListener("close", fail);
      window.clearTimeout(timeoutId);
    }

    function settle(candidates: NostrRelayCandidate[]): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.close();
      resolve(candidates);
    }

    function fail(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.close();
      reject(new ShareError("relay_failed", `Could not read NIP-66 discovery from ${relayUrl}.`));
    }

    function handleMessage(message: MessageEvent): void {
      const parsed = parseRelayMessage(message.data);

      if (!Array.isArray(parsed) || parsed[1] !== subscriptionId) {
        return;
      }

      if (
        parsed[0] === "EVENT" &&
        isNostrEvent(parsed[2]) &&
        parsed[2].kind === NIP66_RELAY_DISCOVERY_KIND
      ) {
        events.push(parsed[2]);
      }

      if (parsed[0] === "EOSE") {
        socket.send(JSON.stringify(["CLOSE", subscriptionId]));
        settle(extractNip66RelayCandidates(events));
      }
    }

    const timeoutId = window.setTimeout(() => {
      settle(extractNip66RelayCandidates(events));
    }, NOSTR_DISCOVERY_REQUEST_TIMEOUT_MS);

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
    socket.send(
      JSON.stringify([
        "REQ",
        subscriptionId,
        { kinds: [NIP66_RELAY_DISCOVERY_KIND], limit: NIP66_DISCOVERY_LIMIT },
      ]),
    );
  });
}

async function probeRelayReadWrite(relayUrl: string): Promise<NostrRelayProbeResult> {
  const readSocket = await openRelaySocket(relayUrl);
  let readProbe: NostrRelayProbeResult;

  try {
    readProbe = await probeRelayRead(readSocket);
  } finally {
    readSocket.close();
  }

  if (readProbe.read !== true) {
    return {
      ...readProbe,
      url: relayUrl,
      write: false,
    };
  }

  const writeSocket = await openRelaySocket(relayUrl);

  try {
    const writeProbe = await probeRelayWrite(writeSocket);

    return {
      authRequired: writeProbe.authRequired ?? readProbe.authRequired,
      paymentRequired: writeProbe.paymentRequired ?? readProbe.paymentRequired,
      read: true,
      url: relayUrl,
      write: writeProbe.write,
    };
  } finally {
    writeSocket.close();
  }
}

function probeRelayRead(socket: WebSocket): Promise<NostrRelayProbeResult> {
  const subscriptionId = bytesToBase64Url(randomBytes(8));

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: NostrRelayProbeResult) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleFail);
      socket.removeEventListener("close", handleFail);
      window.clearTimeout(timeoutId);
      resolve(result);
    };

    const handleFail = () => {
      finish({ read: false });
    };

    const timeoutId = window.setTimeout(() => {
      finish({ read: false });
    }, NOSTR_RELAY_PROBE_TIMEOUT_MS);

    const handleMessage = (message: MessageEvent) => {
      const parsed = parseRelayMessage(message.data);

      if (!Array.isArray(parsed) || parsed[1] !== subscriptionId) {
        return;
      }

      if (parsed[0] === "EVENT" || parsed[0] === "EOSE") {
        finish({ read: true });
      } else if (parsed[0] === "CLOSED") {
        finish({
          ...parseRelayRestrictionMessage(parsed[2]),
          read: false,
        });
      }
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleFail);
    socket.addEventListener("close", handleFail);
    socket.send(JSON.stringify(["REQ", subscriptionId, { kinds: [SHARE_EVENT_KIND], limit: 1 }]));
  });
}

async function probeRelayWrite(socket: WebSocket): Promise<NostrRelayProbeResult> {
  const event = await buildRelayWriteProbeEvent();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: NostrRelayProbeResult) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleFail);
      socket.removeEventListener("close", handleFail);
      window.clearTimeout(timeoutId);
      resolve(result);
    };

    const handleFail = () => {
      finish({ write: false });
    };

    const timeoutId = window.setTimeout(() => {
      finish({ write: false });
    }, NOSTR_RELAY_PROBE_TIMEOUT_MS);

    const handleMessage = (message: MessageEvent) => {
      const parsed = parseRelayMessage(message.data);

      if (!Array.isArray(parsed) || parsed[0] !== "OK" || parsed[1] !== event.id) {
        return;
      }

      if (parsed[2] === true) {
        finish({ write: true });
      } else {
        finish({
          ...parseRelayRestrictionMessage(parsed[3]),
          write: false,
        });
      }
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleFail);
    socket.addEventListener("close", handleFail);
    socket.send(JSON.stringify(["EVENT", event]));
  });
}

async function buildRelayWriteProbeEvent(): Promise<NostrEvent> {
  const secretKey = schnorr.utils.randomSecretKey(randomBytes(48));
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
  const probeId = bytesToBase64Url(randomBytes(16));
  const chunkBytes = randomBytes(NOSTR_CHUNK_SIZE_BYTES);
  const hash = bytesToHex(await sha256(chunkBytes));
  const expiresAt = Math.floor(Date.now() / 1000) + NOSTR_RELAY_PROBE_EXPIRATION_SECONDS;

  return signEvent(
    createUnsignedEvent({
      content: bytesToBase64Url(chunkBytes),
      pubkey,
      tags: [
        ["d", `${probeId}:chunk:0`],
        ["client", SHARE_APP_ID],
        ["webaura-share", probeId],
        ["type", "probe"],
        ["index", "0"],
        ["sha256", hash],
        ["expiration", String(expiresAt)],
      ],
    }),
    secretKey,
  );
}

function parseRelayRestrictionMessage(message: unknown): NostrRelayProbeResult {
  const normalized = typeof message === "string" ? message.toLowerCase() : "";

  return {
    authRequired: normalized.includes("auth") ? true : undefined,
    paymentRequired: normalized.includes("payment") ? true : undefined,
  };
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}.`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchRelayInformationDocument(relayUrl: string): Promise<NostrRelayProbeResult> {
  const metadataUrl = relayUrlToMetadataUrl(relayUrl);
  const requestUrl = await resolveRelayMetadataRequestUrl(metadataUrl);
  const startedAt = nowMs();
  const response = await fetchJsonWithTimeout(requestUrl, NOSTR_RELAY_PROBE_TIMEOUT_MS, {
    accept: "application/nostr+json",
  });
  const metadata = parseRelayCandidate(response, relayUrl) ?? { url: relayUrl };

  return {
    ...metadata,
    latencyMs: metadata.latencyMs ?? Math.max(0, Math.round(nowMs() - startedAt)),
    url: relayUrl,
  };
}

async function resolveRelayMetadataRequestUrl(metadataUrl: string): Promise<string> {
  const proxy = await getProxyConfig();
  return proxy.enabled ? buildProxiedUrl(proxy.url, metadataUrl) : metadataUrl;
}

function relayUrlToMetadataUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  return url.toString();
}

function extractNip66RelayCandidates(events: readonly NostrEvent[]): NostrRelayCandidate[] {
  return dedupeCandidates(events.flatMap((event) => parseNip66RelayDiscoveryEvent(event)));
}

function parseNip66RelayDiscoveryEvent(event: NostrEvent): NostrRelayCandidate[] {
  const relayUrls = new Set<string>();
  const tagCandidate: Partial<NostrRelayCandidate> = {};

  for (const tag of event.tags) {
    const [name, value] = tag;

    if (name === "d" || name === "r") {
      const url = normalizeRelayUrl(value ?? "");

      if (url) {
        relayUrls.add(url);
      }
      continue;
    }

    if (name === "rtt-open" || name === "rtt-read" || name === "rtt-write") {
      const latency = parseFiniteNumber(value);

      if (latency !== undefined) {
        tagCandidate.latencyMs = Math.min(tagCandidate.latencyMs ?? latency, latency);
      }
      continue;
    }

    if (name === "R") {
      applyNip66Requirement(value, tagCandidate);
    }
  }

  const contentMetadata = parseNip66ContentMetadata(event.content);
  const candidates: NostrRelayCandidate[] = [];

  for (const url of relayUrls) {
    candidates.push({
      ...(parseRelayCandidate(contentMetadata, url) ?? { url }),
      ...tagCandidate,
      url,
    });
  }

  return candidates;
}

function applyNip66Requirement(
  requirement: string | undefined,
  candidate: Partial<NostrRelayCandidate>,
): void {
  const normalized = requirement?.trim().toLowerCase();

  if (!normalized) {
    return;
  }

  if (normalized === "auth") {
    candidate.authRequired = true;
  } else if (normalized === "payment") {
    candidate.paymentRequired = true;
  } else if (normalized === "!auth") {
    candidate.authRequired = false;
  } else if (normalized === "!payment") {
    candidate.paymentRequired = false;
  }
}

function parseNip66ContentMetadata(content: string): unknown {
  const trimmed = content.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function parseFiniteNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRelayCandidate(value: unknown, keyedUrl?: string): NostrRelayCandidate | undefined {
  if (!isRecord(value)) {
    return keyedUrl ? { url: keyedUrl } : undefined;
  }

  const url =
    normalizeRelayUrl(getFirstString(value, ["url", "uri", "relay", "relay_url"]) ?? "") ??
    (keyedUrl ? normalizeRelayUrl(keyedUrl) : undefined);

  if (!url) {
    return undefined;
  }

  const limitation = isRecord(value.limitation) ? value.limitation : undefined;
  const candidate: NostrRelayCandidate = {
    authRequired:
      getFirstBoolean(value, ["authRequired", "auth_required"]) ??
      getFirstBoolean(limitation, ["authRequired", "auth_required"]),
    latencyMs: getFirstFiniteNumber(value, [
      "latencyMs",
      "latency_ms",
      "latency",
      "rtt",
      "ping",
      "ms",
      "avg_latency",
    ]),
    maxContentLength:
      getFirstSafeInteger(value, ["maxContentLength", "max_content_length"]) ??
      getFirstSafeInteger(limitation, ["maxContentLength", "max_content_length"]),
    maxMessageLength:
      getFirstSafeInteger(value, ["maxMessageLength", "max_message_length"]) ??
      getFirstSafeInteger(limitation, ["maxMessageLength", "max_message_length"]),
    paymentRequired:
      getFirstBoolean(value, ["paymentRequired", "payment_required", "paid"]) ??
      getFirstBoolean(limitation, ["paymentRequired", "payment_required"]),
    read: getFirstBoolean(value, ["read", "readable"]),
    url,
    write: getFirstBoolean(value, ["write", "writable", "writeable"]),
  };

  return candidate;
}

function getFirstString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function getFirstBoolean(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): boolean | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function getFirstFiniteNumber(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function getFirstSafeInteger(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  const value = getFirstFiniteNumber(record, keys);
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function openRelaySocket(relayUrl: string): Promise<WebSocket> {
  if (typeof WebSocket === "undefined") {
    return Promise.reject(
      new ShareError("relay_failed", "This browser cannot connect to Nostr relays."),
    );
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    const timeoutId = window.setTimeout(() => {
      socket.close();
      reject(new ShareError("relay_failed", `Timed out connecting to ${relayUrl}.`));
    }, 8000);

    socket.addEventListener("open", () => {
      window.clearTimeout(timeoutId);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      window.clearTimeout(timeoutId);
      reject(new ShareError("relay_failed", `Could not connect to ${relayUrl}.`));
    });
  });
}

function publishEvent(socket: WebSocket, relayUrl: string, event: NostrEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    function cleanup(): void {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleFail);
      socket.removeEventListener("close", handleFail);
      window.clearTimeout(timeoutId);
    }

    function succeed(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    }

    function fail(error: ShareError): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function handleFail(): void {
      fail(new ShareError("relay_failed", `Could not publish to ${relayUrl}.`));
    }

    function handleMessage(message: MessageEvent): void {
      const parsed = parseRelayMessage(message.data);

      if (!Array.isArray(parsed) || parsed[0] !== "OK" || parsed[1] !== event.id) {
        return;
      }

      if (parsed[2] === true) {
        succeed();
      } else {
        fail(new ShareError("relay_failed", `Relay rejected a share event: ${String(parsed[3])}`));
      }
    }

    const timeoutId = window.setTimeout(() => {
      fail(new ShareError("relay_failed", `Timed out publishing to ${relayUrl}.`));
    }, 8000);

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleFail);
    socket.addEventListener("close", handleFail);
    socket.send(JSON.stringify(["EVENT", event]));
  });
}

function parseRelayMessage(data: unknown): unknown {
  if (typeof data !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function isNostrEvent(value: unknown): value is NostrEvent {
  return (
    isRecord(value) &&
    typeof value.content === "string" &&
    typeof value.created_at === "number" &&
    typeof value.id === "string" &&
    typeof value.kind === "number" &&
    typeof value.pubkey === "string" &&
    typeof value.sig === "string" &&
    Array.isArray(value.tags)
  );
}
