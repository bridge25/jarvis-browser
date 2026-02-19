import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      // Measure only the 3 pure-logic modules.
      // server.ts routing (~214 lines) dispatches to Chrome-dependent handlers;
      // actions.ts, browser.ts, cli.ts, daemon.ts, snapshot.ts, types.ts,
      // and all commands/* require a live CDP connection — they are covered
      // by E2E tests, not unit tests.
      include: [
        "src/protocol.ts",
        "src/shared.ts",
        "src/client.ts",
        "src/observer.ts",
        "src/config.ts",
        "src/retry.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
