import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "apps/api",
  "apps/android-companion/vitest.config.ts",
  "apps/web/vitest.config.ts"
]);
