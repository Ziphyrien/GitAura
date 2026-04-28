import {
  generatePKCE,
  generateState,
  parseAuthorizationInput,
  postTokenRequest,
} from "@gitaura/pi/auth/oauth-utils";
import { openPopup } from "@gitaura/pi/auth/popup-flow";
import type { OAuthCredentials } from "@gitaura/pi/auth/oauth-types";
import type { OAuthRequestOptions, ProxyRequestOptions } from "@gitaura/pi/auth/oauth-utils";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

function decodeJwt(token: string):
  | Record<
      string,
      | string
      | number
      | boolean
      | {
          chatgpt_account_id?: string;
        }
      | undefined
    >
  | undefined {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return undefined;
  }

  try {
    const payload = parts[1];

    if (!payload) {
      return undefined;
    }

    return JSON.parse(atob(payload)) as Record<string, string | undefined>;
  } catch {
    return undefined;
  }
}

function getAccountId(accessToken: string): string | undefined {
  const payload = decodeJwt(accessToken);
  const authValue = payload?.[JWT_CLAIM_PATH];

  if (typeof authValue !== "object" || authValue === null) {
    return undefined;
  }

  const parsed = authValue as {
    chatgpt_account_id?: string;
  };

  return parsed.chatgpt_account_id;
}

async function waitForManualRedirect(
  authUrl: string,
  options: OAuthRequestOptions | undefined,
): Promise<string> {
  openPopup(authUrl);

  if (!options?.onManualRedirect) {
    throw new Error("Paste the final OpenAI redirect URL to complete login.");
  }

  return await options.onManualRedirect({
    authUrl,
    instructions:
      "After OpenAI redirects to localhost and the page fails to load, paste the full address bar URL here.",
    placeholder: REDIRECT_URI,
    provider: "openai-codex",
  });
}

export async function loginOpenAICodex(
  _redirectUri: string,
  options?: OAuthRequestOptions,
): Promise<OAuthCredentials> {
  const { challenge, verifier } = await generatePKCE();
  const state = generateState();
  const url = new URL(AUTHORIZE_URL);

  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("originator", "sitegeist");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);

  const input = await waitForManualRedirect(url.toString(), options);
  const { code, state: returnedState = state } = parseAuthorizationInput(input);

  if (!code || returnedState !== state) {
    throw new Error("OAuth callback validation failed");
  }

  const tokenData = await postTokenRequest(
    TOKEN_URL,
    {
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    },
    options,
  );

  const access = tokenData.access_token;
  const refresh = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  if (typeof access !== "string" || typeof refresh !== "string" || typeof expiresIn !== "number") {
    throw new Error("Token response missing required fields");
  }

  const accountId = getAccountId(access);

  if (!accountId) {
    throw new Error("Failed to extract accountId from token");
  }

  return {
    access,
    accountId,
    expires: Date.now() + expiresIn * 1000,
    providerId: "openai-codex",
    refresh,
  };
}

export async function refreshOpenAICodex(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  const tokenData = await postTokenRequest(
    TOKEN_URL,
    {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh,
    },
    options,
  );

  const access = tokenData.access_token;
  const refresh = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  if (typeof access !== "string" || typeof refresh !== "string" || typeof expiresIn !== "number") {
    throw new Error("Token refresh response missing required fields");
  }

  const accountId = getAccountId(access);

  if (!accountId) {
    throw new Error("Failed to extract accountId from refreshed token");
  }

  return {
    access,
    accountId,
    expires: Date.now() + expiresIn * 1000,
    providerId: "openai-codex",
    refresh,
  };
}
