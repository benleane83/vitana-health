import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "apps/api",
  "apps/web/vitest.config.ts"
]);
