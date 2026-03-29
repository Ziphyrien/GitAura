import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import { comlink } from "vite-plugin-comlink"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

function createTsConfigPathsPlugin() {
  return viteTsConfigPaths({
    projects: ["./tsconfig.json"],
  })
}

function createBrowserNodeZlibAliasPlugin() {
  const replacement = fileURLToPath(
    new URL("./src/shims/node-zlib.ts", import.meta.url)
  )

  return {
    applyToEnvironment(environment) {
      return environment.config.consumer === "client"
    },
    enforce: "pre" as const,
    name: "browser-node-zlib-alias",
    resolveId(id: string) {
      if (id === "node:zlib") {
        return replacement
      }
    },
  }
}

const config = defineConfig({
  plugins: [
    comlink(),
    createBrowserNodeZlibAliasPlugin(),
    devtools(),
    nitro(),
    // this is the plugin that enables path aliases
    createTsConfigPathsPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  worker: {
    format: "es",
    plugins: () => [
      createTsConfigPathsPlugin(),
      createBrowserNodeZlibAliasPlugin(),
      comlink(),
    ],
  },
})

export default config
