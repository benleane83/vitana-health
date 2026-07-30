import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.{ts,tsx}", "src/**/*.durability.test.{ts,tsx}"],
    // The root config runs every workspace project in parallel, so a jsdom render that takes
    // ~200ms alone can take several seconds under contention. 5s produced random timeouts in
    // `validate:fast` that never reproduced when the project was run on its own.
    testTimeout: 20_000
  }
});
