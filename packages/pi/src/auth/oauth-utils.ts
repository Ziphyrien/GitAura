import type { JsonValue } from "@gitaura/pi/types/common";
import { buildProxiedUrl } from "@gitaura/pi/proxy/url";
import type { OAuthProviderId } from "@gitaura/pi/auth/oauth-types";

export interface ManualOAuthRedirectRequest {
  authUrl: string;
  instructions: string;
  placeholder: string;
  provider: OAuthProviderId;
}

export interface ProxyRequestOptions {
  proxyUrl?: string;
}

export interface OAuthRequestOptions extends ProxyRequestOptions {
  googleProjectId?: string;
  onManualRedirect?: (request: ManualOAuthRedirectRequest) => Promise<string>;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function generatePKCE(): Promise<{
  challenge: string;
  verifier: string;
}> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);
  const challengeBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );

  return {
    challenge: base64UrlEncode(challengeBytes),
    verifier,
  };
}

export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // Not a URL. Continue with supported compact paste formats.
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
}

export async function postTokenRequest(
  url: string,
  body: Record<string, string>,
  options?: ProxyRequestOptions,
): Promise<Record<string, JsonValue>> {
  const requestUrl = options?.proxyUrl === undefined ? url : buildProxiedUrl(options.proxyUrl, url);

  const response = await fetch(requestUrl, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as Record<string, JsonValue>;
}
