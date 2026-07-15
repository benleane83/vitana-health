import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/api/vitest.integration.config.ts",
      "apps/web/vitest.integration.config.ts"
    ]
  }
});