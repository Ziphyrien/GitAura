import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { comlink } from "vite-plugin-comlink";

export default defineConfig({
  optimizeDeps: {
    include: [
      "streamdown",
      "@streamdown/cjk",
      "@streamdown/code",
      "@streamdown/math",
      "@streamdown/mermaid",
      "mermaid",
      "dayjs",
      "@braintree/sanitize-url",
    ],
  },
  plugins: [comlink(), nitro(), tailwindcss(), tanstackStart(), viteReact()],
  resolve: {
    alias: {
      "@webaura/env/server": fileURLToPath(
        new URL("../../packages/env/src/server.ts", import.meta.url),
      ),
      "@webaura/env/web": fileURLToPath(new URL("../../packages/env/src/web.ts", import.meta.url)),
      "@webaura/pi/agent/runtime-worker-client": fileURLToPath(
        new URL("./src/agent/runtime-worker-client.ts", import.meta.url),
      ),
    },
    tsconfigPaths: true,
  },
  server: {
    port: 3001,
  },
  worker: {
    format: "es",
    plugins: () => [comlink()],
  },
});
