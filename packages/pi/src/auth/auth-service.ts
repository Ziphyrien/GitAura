import { getIsoNow } from "@webaura/pi/lib/dates";
import { deleteProviderKey, getProviderKey, setProviderKey } from "@webaura/db";
import { loginGitHubCopilot } from "@webaura/pi/auth/providers/github-copilot";
import { loginOpenAICodex } from "@webaura/pi/auth/providers/openai-codex";
import {
  isOAuthProviderId,
  serializeOAuthCredentials,
  type OAuthCredentials,
  type OAuthProviderId,
} from "@webaura/pi/auth/oauth-types";
import type { OAuthRequestOptions } from "@webaura/pi/auth/oauth-utils";
import type { ProviderAuthKind, ProviderAuthState } from "@webaura/pi/types/auth";
import type { ProviderId } from "@webaura/pi/types/models";
import { getOAuthProviderLabel } from "@webaura/pi/models/provider-registry";

export { oauthRefresh } from "@webaura/pi/auth/oauth-refresh";
export type { OAuthProviderId } from "@webaura/pi/auth/oauth-types";

export function isOAuthProvider(provider: string): provider is OAuthProviderId {
  return isOAuthProviderId(provider);
}

export function getOAuthProviderName(provider: OAuthProviderId): string {
  return getOAuthProviderLabel(provider);
}

export async function oauthLogin(
  provider: OAuthProviderId,
  redirectUri: string,
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void,
  options?: OAuthRequestOptions,
): Promise<OAuthCredentials> {
  switch (provider) {
    case "github-copilot":
      return await loginGitHubCopilot(onDeviceCode ?? (() => {}), options);
    case "openai-codex":
      return await loginOpenAICodex(redirectUri, options);
  }
}

export async function upsertProviderOAuth(
  provider: ProviderId,
  credentials: OAuthCredentials,
): Promise<void> {
  await setProviderKey(provider, serializeOAuthCredentials(credentials));
}

export async function loginAndStoreOAuthProvider(
  provider: OAuthProviderId,
  redirectUri: string,
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void,
  options?: OAuthRequestOptions,
): Promise<OAuthCredentials> {
  const credentials = await oauthLogin(provider, redirectUri, onDeviceCode, options);
  await upsertProviderOAuth(provider, credentials);
  return credentials;
}

export async function setProviderApiKey(provider: ProviderId, value: string): Promise<void> {
  await setProviderKey(provider, value);
}

export async function disconnectProvider(provider: ProviderId): Promise<void> {
  await deleteProviderKey(provider);
}

export async function getProviderAuthState(provider: ProviderId): Promise<ProviderAuthState> {
  const record = await getProviderKey(provider);
  const authKind: ProviderAuthKind = !record?.value
    ? "none"
    : record.value.startsWith("{")
      ? "oauth"
      : "api-key";

  return {
    authKind,
    hasValue: Boolean(record?.value),
    provider,
    updatedAt: record?.updatedAt ?? getIsoNow(),
  };
}
