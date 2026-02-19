/**
 * Integration test: session.* RPC methods (in-process daemon, no Chrome)
 *
 * session.list / session.import / session.export / session.delete work
 * without Chrome (file-based operations only).
 * session.save / session.load require a live page — they reject with
 * BROWSER_NOT_CONNECTED when Chrome is absent.
 */

import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer, stopServer } from "../../src/server.js";
import { connectToSocket, sendRequest } from "../../src/client.js";
import { ERROR_CODES } from "../../src/protocol.js";

const TEST_WORKER_ID = "session-integration-test";
const SAVED_WORKER_ID = process.env.JARVIS_WORKER_ID;
const SESSIONS_DIR = "/tmp/jarvis-browser-sessions";

describe("Session RPC — in-process integration (no Chrome)", () => {
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

  // Cleanup tracker
  const createdSessions: string[] = [];
  const createdFiles: string[] = [];

  afterEach(async () => {
    for (const name of createdSessions.splice(0)) {
      const fp = join(SESSIONS_DIR, `${name}.json`);
      if (existsSync(fp)) await unlink(fp).catch(() => {});
    }
    for (const fp of createdFiles.splice(0)) {
      if (existsSync(fp)) await unlink(fp).catch(() => {});
    }
  });

  async function createSessionFile(name: string): Promise<void> {
    await mkdir(SESSIONS_DIR, { recursive: true });
    const data = {
      version: 1,
      name,
      saved_at: new Date().toISOString(),
      origin: "https://example.com",
      cookies: [],
      localStorage: {},
      sessionStorage: {},
    };
    await writeFile(join(SESSIONS_DIR, `${name}.json`), JSON.stringify(data, null, 2), "utf-8");
    createdSessions.push(name);
  }

  // -------------------------------------------------------------------------
  // session.list — works without Chrome
  // -------------------------------------------------------------------------

  it("session.list returns ok with sessions array", async () => {
    const result = await withSocket((s) =>
      sendRequest(s, "session.list", {}),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(typeof result.count).toBe("number");
  });

  it("session.list includes newly created session", async () => {
    const name = `rpc-test-list-${Date.now()}`;
    await createSessionFile(name);

    const result = await withSocket((s) =>
      sendRequest(s, "session.list", {}),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    const sessions = result.sessions as Array<Record<string, unknown>>;
    const found = sessions.find((s) => s.name === name);
    expect(found).toBeDefined();
    expect(found?.origin).toBe("https://example.com");
    expect(typeof found?.expired).toBe("boolean");
  });

  // -------------------------------------------------------------------------
  // session.delete — works without Chrome
  // -------------------------------------------------------------------------

  it("session.delete removes an existing session", async () => {
    const name = `rpc-test-delete-${Date.now()}`;
    await createSessionFile(name);
    createdSessions.pop(); // will be deleted via RPC

    const result = await withSocket((s) =>
      sendRequest(s, "session.delete", { name }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(name);
    expect(existsSync(join(SESSIONS_DIR, `${name}.json`))).toBe(false);
  });

  it("session.delete rejects when session does not exist", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.delete", { name: "nonexistent-session-rpc-xyz" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  it("session.delete requires name param", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.delete", {});
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // session.export — works without Chrome
  // -------------------------------------------------------------------------

  it("session.export exports an existing session", async () => {
    const name = `rpc-test-export-${Date.now()}`;
    await createSessionFile(name);
    const outputFile = `/tmp/rpc-export-test-${Date.now()}.json`;
    createdFiles.push(outputFile);

    const result = await withSocket((s) =>
      sendRequest(s, "session.export", { name, outputFile }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.path).toBe(outputFile);
    expect(existsSync(outputFile)).toBe(true);
  });

  it("session.export rejects when session does not exist", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.export", { name: "nonexistent-export-rpc-xyz" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // session.import — works without Chrome
  // -------------------------------------------------------------------------

  it("session.import imports a session from file", async () => {
    const name = `rpc-test-import-src-${Date.now()}`;
    await createSessionFile(name);
    createdSessions.pop(); // track separately

    // Export it first so we have a portable JSON
    const srcPath = join(SESSIONS_DIR, `${name}.json`);
    const importedName = `rpc-test-imported-${Date.now()}`;
    createdSessions.push(name); // original
    createdSessions.push(importedName); // imported

    const result = await withSocket((s) =>
      sendRequest(s, "session.import", { path: srcPath, name: importedName }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.imported).toBe(importedName);
    expect(existsSync(join(SESSIONS_DIR, `${importedName}.json`))).toBe(true);
  });

  it("session.import rejects when file does not exist", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.import", { path: "/tmp/nonexistent-import-file-rpc.json" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  it("session.import requires path param", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.import", {});
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // session.save — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("session.save rejects with BROWSER_NOT_CONNECTED when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.save", { name: "my-session", targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(Number(e.code)).toBe(ERROR_CODES.ACTION_FAILED);
      }
    });
  });

  it("session.save requires name param", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.save", {});
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // session.load — requires Chrome; throws BROWSER_NOT_CONNECTED without it
  // -------------------------------------------------------------------------

  it("session.load rejects with BROWSER_NOT_CONNECTED when Chrome is absent", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "session.load", { name: "any-session", targetId: "non-existent-tab" });
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        expect(Number(e.code)).toBe(ERROR_CODES.ACTION_FAILED);
      }
    });
  });
});
