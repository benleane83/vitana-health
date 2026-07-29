import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "src/**/*.durability.test.ts"],
    // See apps/web/vitest.config.ts - the parallel monorepo run makes a 5s budget flaky.
    testTimeout: 20_000
  }
});
