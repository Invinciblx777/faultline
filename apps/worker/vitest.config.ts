import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Browser and database tests share local resources; run files one at a time.
    fileParallelism: false,
  },
});
