import { defineConfig } from "vite-plus";
import testConfig from "./vitest.config.ts";

export default defineConfig({
  ...testConfig,
  staged: {
    "*": ["vp lint", "vp fmt --write"],
  },
  fmt: {
    ignorePatterns: [],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    categories: {
      correctness: "error",
    },
    rules: {},
    env: {
      builtin: true,
    },
  },
});
