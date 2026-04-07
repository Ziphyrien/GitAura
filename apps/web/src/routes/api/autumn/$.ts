import { auth } from "@gitinspect/auth";
import { env } from "@gitinspect/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { autumnHandler } from "autumn-js/fetch";

const handleAutumnRequest = autumnHandler({
  identify: async (request) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    return {
      customerData: {
        email: session?.user.email ?? undefined,
        name: session?.user.name ?? undefined,
      },
      customerId: session?.user.ghId,
    };
  },
  pathPrefix: "/api/autumn",
  secretKey: env.AUTUMN_SECRET_KEY,
});

export const Route = createFileRoute("/api/autumn/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        if (!env.AUTUMN_SECRET_KEY) {
          return Response.json(
            {
              error:
                "Autumn is not configured yet. Add AUTUMN_SECRET_KEY and sync your autumn.config.ts.",
            },
            { status: 503 },
          );
        }

        return await handleAutumnRequest(request);
      },
    },
  },
});
