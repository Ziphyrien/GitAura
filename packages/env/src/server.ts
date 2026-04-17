import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GITHUB_CLIENT_ID: z.string(),
    GITHUB_CLIENT_SECRET: z.string(),
    GITHUB_PROXY_TOKEN: z.string(),
    CORS_ORIGIN: z.url(),
    FEEDBACK_GITHUB_TOKEN: z.string().optional(),
    FEEDBACK_GITHUB_OWNER: z.string().optional(),
    FEEDBACK_GITHUB_REPO: z.string().optional(),
    FIREWORKS_API_KEY: z.string(),
    AUTUMN_SECRET_KEY: z.string(),
    DEXIE_CLOUD_DB_URL: z.url().optional(),
    DEXIE_CLOUD_CLIENT_ID: z.string().optional(),
    DEXIE_CLOUD_CLIENT_SECRET: z.string().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
