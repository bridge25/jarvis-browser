/**
 * Integration test: observer RPC methods (in-process daemon, no Chrome)
 *
 * console / errors / requests work without Chrome (return empty data).
 * observe / page-info require a live CDP page — they reject with
 * BROWSER_NOT_CONNECTED (-32001) when Chrome is absent.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startServer, stopServer } from "../../src/server.js";
import { connectToSocket, sendRequest } from "../../src/client.js";
import { ERROR_CODES } from "../../src/protocol.js";

const TEST_WORKER_ID = "observer-integration-test";
const SAVED_WORKER_ID = process.env.JARVIS_WORKER_ID;

describe("Observer RPC — in-process integration (no Chrome)", () => {
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
  // console — works without Chrome (returns empty buffer)
  // -------------------------------------------------------------------------

  it("console returns ok with empty messages when no tab is attached", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "console", { targetId: "non-existent-tab" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.messages)).toBe(true);
    expect((result.messages as unknown[]).length).toBe(0);
    expect(result.total).toBe(0);
    expect(typeof result.filtered).toBe("number");
    expect(result.filtered).toBe(0);
  });

  it("console accepts level filter and returns empty", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "console", { targetId: "non-existent-tab", level: "error" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.messages as unknown[]).length).toBe(0);
  });

  it("console accepts last param and returns empty", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "console", { targetId: "non-existent-tab", last: 10 }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.messages as unknown[]).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // errors — works without Chrome (returns empty buffer)
  // -------------------------------------------------------------------------

  it("errors returns ok with empty array when no tab is attached", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "errors", { targetId: "non-existent-tab" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect((result.errors as unknown[]).length).toBe(0);
    expect(result.count).toBe(0);
  });

  it("errors accepts last param", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "errors", { targetId: "non-existent-tab", last: 5 }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // requests — works without Chrome (returns empty buffer)
  // -------------------------------------------------------------------------

  it("requests returns ok with empty array when no tab is attached", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "requests", { targetId: "non-existent-tab" }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.requests)).toBe(true);
    expect((result.requests as unknown[]).length).toBe(0);

    const summary = result.summary as Record<string, unknown>;
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.pending).toBe(0);
  });

  it("requests accepts urlPattern param", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "requests", {
        targetId: "non-existent-tab",
        urlPattern: "*/api/*",
      }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.requests as unknown[]).length).toBe(0);
  });

  it("requests accepts last param", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "requests", { targetId: "non-existent-tab", last: 20 }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.requests as unknown[]).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // observe — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("observe rejects with BROWSER_NOT_CONNECTED when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "observe", { targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(e.code).toBe(String(ERROR_CODES.ACTION_FAILED));
      }
    });
  });

  it("observe without targetId also rejects with BROWSER_NOT_CONNECTED", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "observe");
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(e.code).toBe(String(ERROR_CODES.ACTION_FAILED));
      }
    });
  });

  // -------------------------------------------------------------------------
  // page-info — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("page-info rejects with BROWSER_NOT_CONNECTED when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "page-info", { targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(e.code).toBe(String(ERROR_CODES.ACTION_FAILED));
      }
    });
  });

  it("page-info without targetId also rejects with BROWSER_NOT_CONNECTED", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "page-info");
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(e.code).toBe(String(ERROR_CODES.ACTION_FAILED));
      }
    });
  });
});
