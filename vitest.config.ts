import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared/vitest.config.ts",
      "packages/api-client/vitest.config.ts",
      "apps/api/vitest.config.ts",
      "apps/android-companion/vitest.config.ts",
      "apps/web/vitest.config.ts"
    ]
  }
});
