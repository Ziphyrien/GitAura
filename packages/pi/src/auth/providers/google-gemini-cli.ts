import { generatePKCE } from "@gitaura/pi/auth/oauth-utils";
import { runPopupOAuthFlow } from "@gitaura/pi/auth/popup-flow";
import { buildProxiedUrl } from "@gitaura/pi/proxy/url";
import type { OAuthCredentials } from "@gitaura/pi/auth/oauth-types";
import type { OAuthRequestOptions, ProxyRequestOptions } from "@gitaura/pi/auth/oauth-utils";

const decode = (value: string) => atob(value);
const CLIENT_ID = decode(
  "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const CLIENT_SECRET = decode("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const TIER_FREE = "free-tier";
const TIER_LEGACY = "legacy-tier";
const TIER_STANDARD = "standard-tier";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

type CloudCodeTier = {
  id: string;
  isDefault?: boolean;
};

type CloudCodeLoadResponse = {
  allowedTiers?: CloudCodeTier[];
  cloudaicompanionProject?: string;
  currentTier?: CloudCodeTier;
};

type CloudCodeOperation = {
  done?: boolean;
  name?: string;
  response?: {
    cloudaicompanionProject?: {
      id?: string;
    };
  };
};

function withProxy(url: string, options?: ProxyRequestOptions): string {
  return options?.proxyUrl ? buildProxiedUrl(options.proxyUrl, url) : url;
}

function getDefaultTier(tiers: CloudCodeTier[] | undefined): CloudCodeTier {
  if (!tiers || tiers.length === 0) {
    return { id: TIER_LEGACY };
  }

  return tiers.find((tier) => tier.isDefault) ?? { id: TIER_LEGACY };
}

function isVpcScAffectedUser(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return false;
  }

  const error = (payload as { error?: { details?: Array<{ reason?: string }> } }).error;
  return (
    Array.isArray(error?.details) &&
    error.details.some((detail) => detail.reason === "SECURITY_POLICY_VIOLATED")
  );
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options?: ProxyRequestOptions,
): Promise<T> {
  const response = await fetch(withProxy(url, options), init);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return (await response.json()) as T;
}

async function pollOperation(
  operationName: string,
  headers: Record<string, string>,
  options?: ProxyRequestOptions,
): Promise<CloudCodeOperation> {
  while (true) {
    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    const operation = await fetchJson<CloudCodeOperation>(
      `${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`,
      {
        headers,
        method: "GET",
      },
      options,
    );

    if (operation.done) {
      return operation;
    }
  }
}

function requireGoogleProjectIdMessage(): string {
  return "This Google account requires a Google Cloud project ID. Enter it in the Gemini row and try again.";
}

async function discoverProject(
  accessToken: string,
  options?: OAuthRequestOptions,
): Promise<string> {
  const googleProjectId = options?.googleProjectId?.trim();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
  };

  const loadBody: {
    cloudaicompanionProject?: string;
    metadata: {
      duetProject?: string;
      ideType: string;
      platform: string;
      pluginType: string;
    };
  } = {
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  };

  if (googleProjectId) {
    loadBody.cloudaicompanionProject = googleProjectId;
    loadBody.metadata.duetProject = googleProjectId;
  }

  const loadResponse = await fetch(
    withProxy(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, options),
    {
      body: JSON.stringify(loadBody),
      headers,
      method: "POST",
    },
  );

  let loadData: CloudCodeLoadResponse;
  if (!loadResponse.ok) {
    let errorPayload: unknown;
    try {
      errorPayload = await loadResponse.clone().json();
    } catch {
      errorPayload = undefined;
    }

    if (isVpcScAffectedUser(errorPayload)) {
      loadData = { currentTier: { id: TIER_STANDARD } };
    } else {
      const text = await loadResponse.text();
      throw new Error(
        `loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${text}`,
      );
    }
  } else {
    loadData = (await loadResponse.json()) as CloudCodeLoadResponse;
  }

  if (loadData.currentTier) {
    if (loadData.cloudaicompanionProject) {
      return loadData.cloudaicompanionProject;
    }

    if (googleProjectId) {
      return googleProjectId;
    }

    throw new Error(requireGoogleProjectIdMessage());
  }

  if (typeof loadData.cloudaicompanionProject === "string") {
    return loadData.cloudaicompanionProject;
  }

  const tierId = getDefaultTier(loadData.allowedTiers).id;
  if (tierId !== TIER_FREE && !googleProjectId) {
    throw new Error(requireGoogleProjectIdMessage());
  }

  const onboardBody: {
    cloudaicompanionProject?: string;
    metadata: {
      duetProject?: string;
      ideType: string;
      platform: string;
      pluginType: string;
    };
    tierId: string;
  } = {
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
    tierId,
  };

  if (tierId !== TIER_FREE && googleProjectId) {
    onboardBody.cloudaicompanionProject = googleProjectId;
    onboardBody.metadata.duetProject = googleProjectId;
  }

  let operation = await fetchJson<CloudCodeOperation>(
    `${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`,
    {
      body: JSON.stringify(onboardBody),
      headers,
      method: "POST",
    },
    options,
  );

  if (!operation.done && operation.name) {
    operation = await pollOperation(operation.name, headers, options);
  }

  const projectId = operation.response?.cloudaicompanionProject?.id;
  if (projectId) {
    return projectId;
  }

  if (googleProjectId) {
    return googleProjectId;
  }

  throw new Error("Could not discover or provision a Google Cloud project for Gemini CLI.");
}

export async function loginGeminiCli(
  redirectUri: string,
  options?: OAuthRequestOptions,
): Promise<OAuthCredentials> {
  const { challenge, verifier } = await generatePKCE();
  const authParams = new URLSearchParams({
    access_type: "offline",
    client_id: CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state: verifier,
  });
  const redirect = await runPopupOAuthFlow(`${AUTH_URL}?${authParams.toString()}`);
  const code = redirect.searchParams.get("code");

  if (!code || redirect.searchParams.get("state") !== verifier) {
    throw new Error("OAuth callback validation failed");
  }

  const tokenResponse = await fetch(withProxy(TOKEN_URL, options), {
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (
    typeof tokenData.access_token !== "string" ||
    typeof tokenData.refresh_token !== "string" ||
    typeof tokenData.expires_in !== "number"
  ) {
    throw new Error("Token response missing required fields");
  }

  const projectId = await discoverProject(tokenData.access_token, options);

  return {
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
    projectId,
    providerId: "google-gemini-cli",
    refresh: tokenData.refresh_token,
  };
}

export async function refreshGeminiCli(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  const response = await fetch(withProxy(TOKEN_URL, options), {
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
    throw new Error("Token refresh response missing required fields");
  }

  return {
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId: credentials.projectId,
    providerId: "google-gemini-cli",
    refresh: typeof data.refresh_token === "string" ? data.refresh_token : credentials.refresh,
  };
}
