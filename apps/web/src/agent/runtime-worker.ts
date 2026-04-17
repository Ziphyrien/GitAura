import { initDbCloud, isDbCloudConfigured } from "@gitinspect/db";
import { env } from "@gitinspect/env/web";
import { fetchDexieCloudTokens } from "@/lib/fetch-dexie-cloud-tokens";

if (!isDbCloudConfigured()) {
  initDbCloud({
    databaseUrl: env.VITE_DEXIE_CLOUD_DB_URL,
    fetchTokens: fetchDexieCloudTokens,
  });
}

export * from "@gitinspect/pi/agent/runtime-worker";
