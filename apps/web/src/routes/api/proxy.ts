import { auth } from "@gitinspect/auth";
import { env } from "@gitinspect/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { Autumn } from "autumn-js";

const ALLOWED_HOSTS = new Set(["api.fireworks.ai"]);
const AUTUMN_MESSAGES_FEATURE_ID = "messages";
const autumn = env.AUTUMN_SECRET_KEY
  ? new Autumn({
      secretKey: env.AUTUMN_SECRET_KEY,
    })
  : null;

export const Route = createFileRoute("/api/proxy")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        if (request.method === "OPTIONS") {
          return new Response("", {
            headers: {
              "access-control-allow-headers":
                "content-type, authorization, x-gitinspect-bill-first",
              "access-control-allow-methods": "GET, POST, OPTIONS",
              "access-control-allow-origin": "*",
            },
          });
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user.ghId) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get("url");

        if (!targetUrl) {
          return Response.json({ error: "Missing ?url= parameter" }, { status: 400 });
        }

        let target: URL;
        try {
          target = new URL(targetUrl);
        } catch {
          return Response.json({ error: "Invalid target URL" }, { status: 400 });
        }

        if (!ALLOWED_HOSTS.has(target.host)) {
          return Response.json({ error: `Host not allowed: ${target.host}` }, { status: 403 });
        }

        const apiKey = env.FIREWORKS_API_KEY;
        if (!apiKey) {
          return Response.json({ error: "Server proxy is not configured" }, { status: 503 });
        }

        const shouldTrackUsage =
          request.method !== "GET" &&
          request.method !== "HEAD" &&
          request.headers.get("x-gitinspect-bill-first") === "1";

        if (shouldTrackUsage) {
          if (!autumn) {
            return Response.json({ error: "Billing is not configured" }, { status: 503 });
          }

          try {
            const { allowed } = await autumn.check({
              customerId: session.user.ghId,
              featureId: AUTUMN_MESSAGES_FEATURE_ID,
              requiredBalance: 1,
            });

            if (!allowed) {
              return Response.json({ error: "You're out of messages" }, { status: 402 });
            }
          } catch (error) {
            console.error("[gitinspect:billing] proxy_check_message_failed", error);

            return Response.json({ error: "Could not verify message allowance" }, { status: 502 });
          }
        }

        const forwardHeaders = new Headers({
          authorization: `Bearer ${apiKey}`,
        });

        const contentType = request.headers.get("content-type");
        if (contentType) {
          forwardHeaders.set("content-type", contentType);
        }

        for (const [key, value] of request.headers.entries()) {
          if (key.startsWith("x-") && key !== "x-gitinspect-bill-first") {
            forwardHeaders.set(key, value);
          }
        }

        let body: string | undefined;
        if (request.method !== "GET" && request.method !== "HEAD") {
          body = await request.text();
        }

        const response = await fetch(target.toString(), {
          body,
          headers: forwardHeaders,
          method: request.method,
        });

        if (shouldTrackUsage && response.ok && autumn) {
          try {
            await autumn.track({
              customerId: session.user.ghId,
              featureId: AUTUMN_MESSAGES_FEATURE_ID,
              value: 1,
            });
          } catch (error) {
            console.error("[gitinspect:billing] proxy_track_message_failed", error);
          }
        }

        if (!response.body) {
          return new Response("", {
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "no-cache",
              "content-type": response.headers.get("content-type") ?? "application/json",
            },
            status: response.status,
          });
        }

        const headers = new Headers(response.headers);
        headers.set("content-type", response.headers.get("content-type") ?? "application/json");
        headers.set("cache-control", "no-cache");
        headers.set("access-control-allow-origin", "*");

        return new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        });
      },
    },
  },
});
