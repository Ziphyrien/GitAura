import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

function fromRoot(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@/components/root-guard",
        replacement: fromRoot("./apps/web/src/components/root-guard.tsx"),
      },
      {
        find: "@/components/auth-callback-page",
        replacement: fromRoot("./apps/web/src/components/auth-callback-page.tsx"),
      },
      {
        find: "@/components/analytics",
        replacement: fromRoot("./apps/web/src/components/analytics.tsx"),
      },
      {
        find: "@/components/app-auth-provider",
        replacement: fromRoot("./apps/web/src/components/app-auth-provider.tsx"),
      },
      {
        find: "@/components/app-header",
        replacement: fromRoot("./apps/web/src/components/app-header.tsx"),
      },
      {
        find: "@/components/app-sidebar",
        replacement: fromRoot("./apps/web/src/components/app-sidebar.tsx"),
      },
      {
        find: "@/components/auth-dialog-wrapper",
        replacement: fromRoot("./apps/web/src/components/auth-dialog-wrapper.tsx"),
      },
      {
        find: "@/components/pricing-settings-panel",
        replacement: fromRoot("./apps/web/src/components/pricing-settings-panel.tsx"),
      },
      {
        find: "@/components/sync-bootstrap-gate",
        replacement: fromRoot("./apps/web/src/components/sync-bootstrap-gate.tsx"),
      },
      {
        find: "@/components/chat-adapter",
        replacement: fromRoot("./packages/pi/src/lib/chat-adapter.ts"),
      },
      {
        find: "@/components/ui",
        replacement: fromRoot("./packages/ui/src/components"),
      },
      {
        find: "@/hooks/use-mobile",
        replacement: fromRoot("./packages/ui/src/hooks/use-mobile.ts"),
      },
      {
        find: "@/hooks/use-subscription",
        replacement: fromRoot("./apps/web/src/hooks/use-subscription.ts"),
      },
      {
        find: "@/lib/app-bootstrap",
        replacement: fromRoot("./apps/web/src/lib/app-bootstrap.ts"),
      },
      {
        find: "@/lib/auth-client",
        replacement: fromRoot("./apps/web/src/lib/auth-client.ts"),
      },
      {
        find: "@/lib/github-access",
        replacement: fromRoot("./apps/web/src/lib/github-access.ts"),
      },
      {
        find: "@/lib/autumn.server",
        replacement: fromRoot("./apps/web/src/lib/autumn.server.ts"),
      },
      {
        find: "@/lib/bootstrap-dexie-cloud",
        replacement: fromRoot("./apps/web/src/lib/bootstrap-dexie-cloud.ts"),
      },
      {
        find: "@/lib/dexie-cloud-rest.server",
        replacement: fromRoot("./apps/web/src/lib/dexie-cloud-rest.server.ts"),
      },
      {
        find: "@/lib/fetch-dexie-cloud-tokens",
        replacement: fromRoot("./apps/web/src/lib/fetch-dexie-cloud-tokens.ts"),
      },
      {
        find: "@/lib/subscription-entitlements",
        replacement: fromRoot("./apps/web/src/lib/subscription-entitlements.ts"),
      },
      {
        find: "@/middleware/auth",
        replacement: fromRoot("./apps/web/src/middleware/auth.ts"),
      },
      {
        find: "@/store/auth-store",
        replacement: fromRoot("./apps/web/src/store/auth-store.ts"),
      },
      { find: "@/lib/utils", replacement: fromRoot("./packages/ui/src/lib/utils.ts") },
      { find: "@/types/storage", replacement: fromRoot("./packages/db/src/types.ts") },
      { find: "@/agent", replacement: fromRoot("./packages/pi/src/agent") },
      { find: "@/auth", replacement: fromRoot("./packages/pi/src/auth") },
      { find: "@/components", replacement: fromRoot("./packages/ui/src/components") },
      { find: "@/db", replacement: fromRoot("./packages/db/src") },
      { find: "@/hooks", replacement: fromRoot("./packages/pi/src/hooks") },
      { find: "@/lib", replacement: fromRoot("./packages/pi/src/lib") },
      { find: "@/models", replacement: fromRoot("./packages/pi/src/models") },
      { find: "@/features", replacement: fromRoot("./apps/web/src/features") },
      { find: "@/navigation", replacement: fromRoot("./apps/web/src/navigation") },
      { find: "@/proxy", replacement: fromRoot("./packages/pi/src/proxy") },
      { find: "@/repo", replacement: fromRoot("./packages/pi/src/repo") },
      { find: "@/routes", replacement: fromRoot("./apps/web/src/routes") },
      { find: "@/sessions", replacement: fromRoot("./packages/pi/src/sessions") },
      { find: "@/tools", replacement: fromRoot("./packages/pi/src/tools") },
      { find: "@/types", replacement: fromRoot("./packages/pi/src/types") },
      { find: "@/test", replacement: fromRoot("./tests/lib") },
      {
        find: /^@webaura\/db$/,
        replacement: fromRoot("./packages/db/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
});
