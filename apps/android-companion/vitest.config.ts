import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Matches apps/api and apps/web. The fake-timer tests in this suite hang rather than fail
    // when an awaited tick never arrives, so the bound matters here more than elsewhere.
    testTimeout: 20_000
  }
});