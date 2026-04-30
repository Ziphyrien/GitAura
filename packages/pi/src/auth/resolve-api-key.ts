import { db, getProviderKey, setProviderKey } from "@webaura/db";
import { oauthRefresh } from "@webaura/pi/auth/oauth-refresh";
import {
  isOAuthCredentials,
  parseOAuthCredentials,
  serializeOAuthCredentials,
} from "@webaura/pi/auth/oauth-types";
import { getIsoNow } from "@webaura/pi/lib/dates";
import { getProxyConfig } from "@webaura/pi/proxy/settings";
import type { OAuthCredentials } from "@webaura/pi/auth/oauth-types";
import type { ProviderId } from "@webaura/pi/types/models";

export interface ResolvedProviderAuth {
  apiKey: string;
  isOAuth: boolean;
  provider: ProviderId;
  storedValue: string;
}

type OAuthRefreshLock = {
  expiresAt: number;
  owner: string;
};

const OAUTH_REFRESH_LOCK_TTL_MS = 45_000;
const OAUTH_REFRESH_LOCK_WAIT_MS = 50;
const OAUTH_REFRESH_LOCK_WAIT_TIMEOUT_MS = OAUTH_REFRESH_LOCK_TTL_MS + 5_000;

export function credentialsExpireSoon(expiresAt: number, now = Date.now()): boolean {
  return now >= expiresAt - 60_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oauthRefreshLockKey(provider: ProviderId): string {
  return `oauth-refresh-lock:${provider}`;
}

function createLockOwner(provider: ProviderId): string {
  return `${provider}:${Date.now()}:${crypto.randomUUID()}`;
}

function readLockValue(value: unknown): OAuthRefreshLock | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const lock = value as Record<string, unknown>;

  if (typeof lock.owner !== "string" || typeof lock.expiresAt !== "number") {
    return undefined;
  }

  return {
    expiresAt: lock.expiresAt,
    owner: lock.owner,
  };
}

function isConstraintError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "ConstraintError"
    : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        String((error as { name: unknown }).name) === "ConstraintError";
}

async function readRefreshLock(key: string): Promise<OAuthRefreshLock | undefined> {
  const row = await db.settings.get(key);

  if (!row) {
    return undefined;
  }

  const lock = readLockValue(row.value);

  if (lock) {
    return lock;
  }

  await db.settings.delete(key);
  return undefined;
}

async function tryAcquireRefreshLock(provider: ProviderId): Promise<OAuthRefreshLock | undefined> {
  const key = oauthRefreshLockKey(provider);
  const now = Date.now();
  const existing = await readRefreshLock(key);

  if (existing && existing.expiresAt > now) {
    return undefined;
  }

  if (existing) {
    await db.settings.delete(key);
  }

  const lock: OAuthRefreshLock = {
    expiresAt: now + OAUTH_REFRESH_LOCK_TTL_MS,
    owner: createLockOwner(provider),
  };

  try {
    await db.settings.add({
      key,
      updatedAt: getIsoNow(),
      value: lock,
    });
    return lock;
  } catch (error) {
    if (isConstraintError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function releaseRefreshLock(provider: ProviderId, lock: OAuthRefreshLock): Promise<void> {
  const key = oauthRefreshLockKey(provider);
  const existing = await readRefreshLock(key);

  if (existing?.owner === lock.owner) {
    await db.settings.delete(key);
  }
}

function buildResolvedProviderAuth(
  storedValue: string,
  provider: ProviderId,
): ResolvedProviderAuth {
  if (!isOAuthCredentials(storedValue)) {
    return {
      apiKey: storedValue,
      isOAuth: false,
      provider,
      storedValue,
    };
  }

  const credentials = parseOAuthCredentials(storedValue);
  const apiKey =
    credentials.providerId === "google-gemini-cli"
      ? JSON.stringify({
          projectId: credentials.projectId,
          token: credentials.access,
        })
      : credentials.access;

  return {
    apiKey,
    isOAuth: true,
    provider,
    storedValue,
  };
}

async function refreshOAuthCredentials(
  provider: ProviderId,
  credentials: OAuthCredentials,
): Promise<ResolvedProviderAuth> {
  const proxy = await getProxyConfig();
  const refreshed = proxy.enabled
    ? await oauthRefresh(credentials, { proxyUrl: proxy.url })
    : await oauthRefresh(credentials);
  const storedValue = serializeOAuthCredentials(refreshed);

  await db.transaction("rw", db.providerKeys, async () => {
    await setProviderKey(provider, storedValue);
  });

  return buildResolvedProviderAuth(storedValue, provider);
}

async function refreshOAuthCredentialsWithLock(
  provider: ProviderId,
  storedValue: string,
): Promise<ResolvedProviderAuth> {
  const deadline = Date.now() + OAUTH_REFRESH_LOCK_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const lock = await tryAcquireRefreshLock(provider);

    if (lock) {
      try {
        const latest = await getProviderKey(provider);
        const latestValue = latest?.value ?? storedValue;

        if (latestValue !== storedValue) {
          if (!isOAuthCredentials(latestValue)) {
            return buildResolvedProviderAuth(latestValue, provider);
          }

          const latestCredentials = parseOAuthCredentials(latestValue);

          if (!credentialsExpireSoon(latestCredentials.expires)) {
            return buildResolvedProviderAuth(latestValue, provider);
          }

          return await refreshOAuthCredentials(provider, latestCredentials);
        }

        return await refreshOAuthCredentials(provider, parseOAuthCredentials(latestValue));
      } finally {
        await releaseRefreshLock(provider, lock);
      }
    }

    const latest = await getProviderKey(provider);

    if (latest?.value && latest.value !== storedValue) {
      return await resolveStoredProviderAuth(latest.value, provider);
    }

    await sleep(OAUTH_REFRESH_LOCK_WAIT_MS);
  }

  throw new Error(`Timed out waiting for OAuth token refresh lock for ${provider}`);
}

async function resolveStoredProviderAuth(
  storedValue: string,
  provider: ProviderId,
): Promise<ResolvedProviderAuth> {
  if (!isOAuthCredentials(storedValue)) {
    return buildResolvedProviderAuth(storedValue, provider);
  }

  const credentials = parseOAuthCredentials(storedValue);

  if (credentialsExpireSoon(credentials.expires)) {
    return await refreshOAuthCredentialsWithLock(provider, storedValue);
  }

  return buildResolvedProviderAuth(storedValue, provider);
}

export async function resolveStoredApiKey(
  storedValue: string,
  provider: ProviderId,
): Promise<string> {
  return (await resolveStoredProviderAuth(storedValue, provider)).apiKey;
}

export async function resolveProviderAuthForProvider(
  provider: ProviderId,
): Promise<ResolvedProviderAuth | undefined> {
  const record = await getProviderKey(provider);

  if (!record?.value) {
    return undefined;
  }

  return await resolveStoredProviderAuth(record.value, provider);
}

export async function resolveApiKeyForProvider(provider: ProviderId): Promise<string | undefined> {
  const resolved = await resolveProviderAuthForProvider(provider);
  return resolved?.apiKey;
}
