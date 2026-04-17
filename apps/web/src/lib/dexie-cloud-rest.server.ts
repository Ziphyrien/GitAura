import type { TokenFinalResponse } from "dexie-cloud-common";
import { env } from "@gitinspect/env/server";

type DexieCloudConfig = {
  clientId: string;
  clientSecret: string;
  databaseUrl: string;
};

type CachedDexieCloudToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedDexieCloudToken: CachedDexieCloudToken | null = null;
const DEXIE_CLOUD_TOKEN_SCOPES = ["ACCESS_DB", "GLOBAL_READ", "GLOBAL_WRITE"] as const;

/**
 * Dexie Cloud returns 422 with this body until the server has learned your Dexie schema
 * (normally after a signed-in client completes sync). CLI `import` is only for files from `dexie-cloud export`.
 */
export class DexieCloudSchemaPendingError extends Error {
  override readonly name = "DexieCloudSchemaPendingError";
  constructor() {
    super(
      "Dexie Cloud does not have your app schema yet. Open this app while signed in with sync enabled and wait for sync to finish. (CLI: `dexie-cloud import` needs a file from `dexie-cloud export <file.json>` — it does not register schema by itself.)",
    );
  }
}

function isDexieCloudSchemaPendingBody(body: string): boolean {
  return (
    body.includes("Primary key") &&
    body.includes("not known") &&
    (body.includes("client sync") || body.includes("dexie-cloud import"))
  );
}

async function readResponseBodyPreview(response: Response): Promise<string> {
  return (await response.clone().text()).slice(0, 500);
}

function getDexieCloudConfig(): DexieCloudConfig {
  if (!env.DEXIE_CLOUD_DB_URL || !env.DEXIE_CLOUD_CLIENT_ID || !env.DEXIE_CLOUD_CLIENT_SECRET) {
    throw new Error("Dexie Cloud is not configured");
  }

  return {
    clientId: env.DEXIE_CLOUD_CLIENT_ID,
    clientSecret: env.DEXIE_CLOUD_CLIENT_SECRET,
    databaseUrl: env.DEXIE_CLOUD_DB_URL,
  };
}

async function getDexieCloudAccessToken(): Promise<string> {
  if (cachedDexieCloudToken && cachedDexieCloudToken.expiresAt > Date.now() + 60_000) {
    return cachedDexieCloudToken.accessToken;
  }

  const config = getDexieCloudConfig();
  const response = await fetch(`${config.databaseUrl}/token`, {
    body: JSON.stringify({
      claims: {
        sub: "gitinspect-share-publisher",
      },
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scopes: [...DEXIE_CLOUD_TOKEN_SCOPES],
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Dexie Cloud token request failed (${response.status})`);
  }

  const token = (await response.json()) as TokenFinalResponse;
  cachedDexieCloudToken = {
    accessToken: token.accessToken,
    expiresAt: token.accessTokenExpiration,
  };
  return token.accessToken;
}

async function dexieCloudRequest(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getDexieCloudAccessToken();
  const config = getDexieCloudConfig();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return await fetch(`${config.databaseUrl}${path}`, {
    ...init,
    headers,
  });
}

export async function getDexieCloudRecord<T>(path: string): Promise<T | undefined> {
  const response = await dexieCloudRequest(path);

  if (response.status === 404) {
    return undefined;
  }

  if (response.status === 422) {
    const bodyPreview = await readResponseBodyPreview(response);
    if (isDexieCloudSchemaPendingBody(bodyPreview)) {
      return undefined;
    }
    throw new Error(`Dexie Cloud request failed (422): ${bodyPreview || "(empty body)"}`);
  }

  if (!response.ok) {
    const bodyPreview = await readResponseBodyPreview(response);
    throw new Error(
      `Dexie Cloud request failed (${response.status}): ${bodyPreview || "(empty body)"}`,
    );
  }

  return (await response.json()) as T;
}

export async function listDexieCloudRecords<T>(path: string): Promise<T[]> {
  const response = await dexieCloudRequest(path);

  if (response.status === 404) {
    return [];
  }

  if (response.status === 422) {
    const bodyPreview = await readResponseBodyPreview(response);
    if (isDexieCloudSchemaPendingBody(bodyPreview)) {
      return [];
    }
    throw new Error(`Dexie Cloud request failed (422): ${bodyPreview || "(empty body)"}`);
  }

  if (!response.ok) {
    const bodyPreview = await readResponseBodyPreview(response);
    throw new Error(
      `Dexie Cloud request failed (${response.status}): ${bodyPreview || "(empty body)"}`,
    );
  }

  return (await response.json()) as T[];
}

export async function putDexieCloudRecord<T>(tablePath: string, value: T): Promise<void> {
  const response = await dexieCloudRequest(tablePath, {
    body: JSON.stringify([value]),
    method: "POST",
  });

  if (!response.ok) {
    const bodyPreview = await readResponseBodyPreview(response);
    if (response.status === 422 && isDexieCloudSchemaPendingBody(bodyPreview)) {
      throw new DexieCloudSchemaPendingError();
    }
    throw new Error(
      `Dexie Cloud write failed (${response.status}): ${bodyPreview || "(empty body)"}`,
    );
  }
}

export async function deleteDexieCloudRecord(path: string): Promise<void> {
  const response = await dexieCloudRequest(path, {
    method: "DELETE",
  });

  if (response.status === 404) {
    return;
  }

  if (response.status === 422) {
    const bodyPreview = await readResponseBodyPreview(response);
    if (isDexieCloudSchemaPendingBody(bodyPreview)) {
      return;
    }
    throw new Error(`Dexie Cloud delete failed (422): ${bodyPreview || "(empty body)"}`);
  }

  if (!response.ok) {
    const bodyPreview = await readResponseBodyPreview(response);
    throw new Error(
      `Dexie Cloud delete failed (${response.status}): ${bodyPreview || "(empty body)"}`,
    );
  }
}
