import type { DexieCloudOptions } from "dexie-cloud-addon";
import type { TokenResponse } from "dexie-cloud-common";
import { auth } from "@gitinspect/auth";
import { env } from "@gitinspect/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { getCanonicalAppUserId, isSyncEntitledForUser } from "@/lib/autumn.server";

type DexieTokenRequestBody = Parameters<NonNullable<DexieCloudOptions["fetchTokens"]>>[0];

export const Route = createFileRoute("/api/dexie-cloud-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          !env.DEXIE_CLOUD_DB_URL ||
          !env.DEXIE_CLOUD_CLIENT_ID ||
          !env.DEXIE_CLOUD_CLIENT_SECRET
        ) {
          return Response.json({ error: "Dexie Cloud is not configured" }, { status: 503 });
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const tokenParams = (await request.json()) as DexieTokenRequestBody;

        if (!tokenParams.public_key) {
          return Response.json({ error: "Missing Dexie Cloud public key" }, { status: 400 });
        }

        if (!(await isSyncEntitledForUser(session.user))) {
          return Response.json({ error: "Sync is not enabled for this account" }, { status: 403 });
        }

        const dexieResponse = await fetch(`${env.DEXIE_CLOUD_DB_URL}/token`, {
          body: JSON.stringify({
            claims: {
              email: session.user.email ?? undefined,
              name: session.user.name ?? undefined,
              sub: getCanonicalAppUserId(session.user),
            },
            client_id: env.DEXIE_CLOUD_CLIENT_ID,
            client_secret: env.DEXIE_CLOUD_CLIENT_SECRET,
            grant_type: "client_credentials",
            public_key: tokenParams.public_key,
            scopes: ["ACCESS_DB"],
          }),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        const body = (await dexieResponse.json()) as TokenResponse;

        return new Response(JSON.stringify(body), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json",
          },
          status: dexieResponse.status,
          statusText: dexieResponse.statusText,
        });
      },
    },
  },
});
