export const OAUTH_PROVIDER_IDS = ["github-copilot", "openai-codex"] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  providerId: OAuthProviderId;
  refresh: string;
}

interface OAuthCredentialsDraft {
  access?: string;
  accountId?: string;
  expires?: number;
  providerId?: string;
  refresh?: string;
}

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return OAUTH_PROVIDER_IDS.includes(value as OAuthProviderId);
}

function requireString(value: string | number | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OAuth credentials are missing ${field}`);
  }

  return value;
}

function requireNumber(value: string | number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`OAuth credentials have invalid ${field}`);
  }

  return value;
}

function validateDraft(credentials: OAuthCredentialsDraft): OAuthCredentials {
  const providerId = credentials.providerId;

  if (!providerId || !isOAuthProviderId(providerId)) {
    throw new Error("OAuth credentials have invalid providerId");
  }

  const normalized: OAuthCredentials = {
    access: requireString(credentials.access, "access"),
    expires: requireNumber(credentials.expires, "expires"),
    providerId,
    refresh: requireString(credentials.refresh, "refresh"),
  };

  if (providerId === "openai-codex") {
    normalized.accountId = requireString(credentials.accountId, "accountId");
  }

  return normalized;
}

export function isOAuthCredentials(value: string): boolean {
  return value.startsWith("{");
}

export function parseOAuthCredentials(value: string): OAuthCredentials {
  return validateDraft(JSON.parse(value) as OAuthCredentialsDraft);
}

export function serializeOAuthCredentials(credentials: OAuthCredentials): string {
  return JSON.stringify(validateDraft(credentials));
}
