import { env } from "@gitinspect/env/server";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export function createAuth() {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 60 * 24 * 30,
        refreshCache: true,
        strategy: "jwe",
      },
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        mapProfileToUser: (profile) => ({
          email: profile.email,
          ghId: `gh_${profile.id}`,
          image: profile.avatar_url,
          name: profile.name || profile.login,
        }),
      },
    },
    trustedOrigins: [env.CORS_ORIGIN],
    user: {
      additionalFields: {
        ghId: {
          required: false,
          type: "string",
        },
      },
    },
    plugins: [tanstackStartCookies()],
  });
}

export const auth = createAuth();
export type Auth = typeof auth;
