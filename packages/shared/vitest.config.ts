import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Matches apps/api and apps/web. Without it, a test that never settles hangs the run
    // instead of failing.
    testTimeout: 20_000
  }
});
