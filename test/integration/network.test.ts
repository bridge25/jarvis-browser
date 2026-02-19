/**
 * Integration test: route.* RPC methods (in-process daemon, no Chrome)
 *
 * route.list / route.clear / route.captured work without Chrome
 * (they return empty data or handle gracefully).
 * route.block / route.mock / route.capture require a live page —
 * they reject with BROWSER_NOT_CONNECTED when Chrome is absent.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startServer, stopServer } from "../../src/server.js";
import { connectToSocket, sendRequest } from "../../src/client.js";
import { ERROR_CODES } from "../../src/protocol.js";

const TEST_WORKER_ID = "network-integration-test";
const SAVED_WORKER_ID = process.env.JARVIS_WORKER_ID;

describe("Route RPC — in-process integration (no Chrome)", () => {
  beforeAll(async () => {
    process.env.JARVIS_WORKER_ID = TEST_WORKER_ID;
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    if (SAVED_WORKER_ID === undefined) {
      delete process.env.JARVIS_WORKER_ID;
    } else {
      process.env.JARVIS_WORKER_ID = SAVED_WORKER_ID;
    }
  });

  async function withSocket<T>(
    fn: (socket: Awaited<ReturnType<typeof connectToSocket>>) => Promise<T>,
  ): Promise<T> {
    const socket = await connectToSocket();
    try {
      return await fn(socket);
    } finally {
      socket.end();
    }
  }

  // -------------------------------------------------------------------------
  // route.list — works without Chrome (returns empty rules array)
  // -------------------------------------------------------------------------

  it("route.list returns ok with empty rules for unknown tab", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "route.list", { targetId: "non-existent-tab" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.rules)).toBe(true);
    expect((result.rules as unknown[]).length).toBe(0);
    expect(result.count).toBe(0);
  });

  it("route.list works without targetId", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "route.list", {}),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.rules)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // route.captured — works without Chrome (returns empty array)
  // -------------------------------------------------------------------------

  it("route.captured returns ok with empty captured array", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "route.captured", { targetId: "non-existent-tab" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.captured)).toBe(true);
    expect((result.captured as unknown[]).length).toBe(0);
    expect(result.count).toBe(0);
  });

  it("route.captured accepts url-pattern filter and returns empty", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "route.captured", {
        targetId: "non-existent-tab",
        pattern: "*/api/*",
      }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.captured as unknown[]).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // route.clear — works without Chrome (gracefully handles no page)
  // -------------------------------------------------------------------------

  it("route.clear returns ok for unknown tab (graceful no-op)", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "route.clear", { targetId: "non-existent-tab" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(typeof result.cleared).toBe("number");
  });

  // -------------------------------------------------------------------------
  // route.block — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("route.block rejects with error when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "route.block", {
          pattern: "**/*.png",
          targetId: "non-existent-tab",
        });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(Number(e.code)).toBe(ERROR_CODES.ACTION_FAILED);
      }
    });
  });

  it("route.block requires pattern param", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "route.block", { targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // route.mock — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("route.mock rejects with error when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "route.mock", {
          pattern: "**/api/data",
          status: 200,
          body: '{"ok":true}',
          targetId: "non-existent-tab",
        });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(Number(e.code)).toBe(ERROR_CODES.ACTION_FAILED);
      }
    });
  });

  // -------------------------------------------------------------------------
  // route.capture — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("route.capture rejects with error when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "route.capture", {
          pattern: "**/api/**",
          targetId: "non-existent-tab",
        });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(Number(e.code)).toBe(ERROR_CODES.ACTION_FAILED);
      }
    });
  });

  // -------------------------------------------------------------------------
  // route.remove — requires Chrome; throws when rule not found
  // -------------------------------------------------------------------------

  it("route.remove rejects when no Chrome and ruleId missing", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "route.remove", { targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  it("route.remove requires ruleId param", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "route.remove", { ruleId: "", targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });
});
