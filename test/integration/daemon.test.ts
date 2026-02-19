/**
 * Integration test: in-process daemon server
 *
 * Starts the JSON-RPC server directly (no subprocess spawn, no Chrome needed),
 * exercises daemon.health and daemon.status via a real socket connection,
 * then tears down cleanly.
 *
 * Chrome is NOT required — daemon introspection methods work without a CDP
 * connection.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startServer, stopServer } from "../../src/server.js";
import { connectToSocket, sendRequest, call, tryConnect } from "../../src/client.js";

// Use an isolated worker ID so this test doesn't clash with a running daemon
const TEST_WORKER_ID = "integration-test";
const SAVED_WORKER_ID = process.env.JARVIS_WORKER_ID;

describe("Daemon server — in-process integration", () => {
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

  // Helper: open socket, run fn, close socket
  async function withSocket<T>(fn: (socket: Awaited<ReturnType<typeof connectToSocket>>) => Promise<T>): Promise<T> {
    const socket = await connectToSocket();
    try {
      return await fn(socket);
    } finally {
      socket.end();
    }
  }

  it("responds to daemon.health with process info", async () => {
    const result = await withSocket((s) => sendRequest(s, "daemon.health"));
    const r = result as Record<string, unknown>;

    expect(r).toHaveProperty("daemon");
    const daemon = r.daemon as Record<string, unknown>;
    expect(typeof daemon.pid).toBe("number");
    expect(daemon.pid).toBe(process.pid); // same process (in-process server)
    expect(typeof daemon.uptime_s).toBe("number");
    expect(daemon.uptime_s).toBeGreaterThanOrEqual(0);
    expect(typeof daemon.memory_mb).toBe("number");
    expect(daemon.memory_mb).toBeGreaterThan(0);

    expect(r).toHaveProperty("chrome");
    const chrome = r.chrome as Record<string, unknown>;
    expect(typeof chrome.connected).toBe("boolean");
    expect(typeof chrome.cdp_url).toBe("string");
    // chrome.connected is false in unit test (no real Chrome)
    expect(chrome.connected).toBe(false);

    expect(r).toHaveProperty("buffers");
    const buffers = r.buffers as Record<string, unknown>;
    expect(typeof buffers.console).toBe("number");
    expect(typeof buffers.network).toBe("number");

    expect(r).toHaveProperty("tabs");
    const tabs = r.tabs as Record<string, unknown>;
    expect(typeof tabs.owned).toBe("number");
  });

  it("responds to daemon.status with socket info", async () => {
    const result = await withSocket((s) => sendRequest(s, "daemon.status"));
    const r = result as Record<string, unknown>;

    expect(r).toHaveProperty("ok", true);
    expect(r).toHaveProperty("pid", process.pid);
    expect(r).toHaveProperty("socket");
    expect(typeof r.socket).toBe("string");
    expect(r.socket as string).toContain(TEST_WORKER_ID);
  });

  it("returns JSON-RPC error for unknown method", async () => {
    await withSocket(async (s) => {
      await expect(sendRequest(s, "no.such.method.xyz")).rejects.toThrow();
    });
  });

  it("returns error code -32601 for unknown method", async () => {
    await withSocket(async (s) => {
      try {
        await sendRequest(s, "no.such.method.xyz");
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        // client.ts stores code as String(resp.error.code)
        expect(e.code).toBe(String(-32601));
      }
    });
  });

  it("returns parse error for malformed JSON", async () => {
    const socket = await connectToSocket();
    try {
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let buffer = "";
        socket.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const idx = buffer.indexOf("\n");
          if (idx === -1) return;
          try {
            resolve(JSON.parse(buffer.slice(0, idx)) as Record<string, unknown>);
          } catch (e) {
            reject(e);
          }
        });
        socket.once("error", reject);
        socket.write("{ this is not valid json }\n");
      });

      expect(response).toHaveProperty("error");
      const error = response.error as Record<string, unknown>;
      expect(error.code).toBe(-32700);
    } finally {
      socket.end();
    }
  });

  it("returns invalid request error for valid JSON that is not JSON-RPC", async () => {
    const socket = await connectToSocket();
    try {
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let buffer = "";
        socket.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const idx = buffer.indexOf("\n");
          if (idx === -1) return;
          try {
            resolve(JSON.parse(buffer.slice(0, idx)) as Record<string, unknown>);
          } catch (e) {
            reject(e);
          }
        });
        socket.once("error", reject);
        // Valid JSON but missing jsonrpc/id/method fields
        socket.write(JSON.stringify({ foo: "bar" }) + "\n");
      });

      expect(response).toHaveProperty("error");
      const error = response.error as Record<string, unknown>;
      expect(error.code).toBe(-32600);
    } finally {
      socket.end();
    }
  });

  it("handles multiple sequential requests on the same connection", async () => {
    await withSocket(async (s) => {
      const r1 = await sendRequest(s, "daemon.status") as Record<string, unknown>;
      const r2 = await sendRequest(s, "daemon.health") as Record<string, unknown>;

      expect(r1.ok).toBe(true);
      expect(r2).toHaveProperty("daemon");
    });
  });

  it("call() convenience helper connects, sends, and returns result", async () => {
    // call() opens its own socket, sends one request, and closes — no manual socket management
    const result = await call("daemon.status") as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  it("call() rejects on error response", async () => {
    await expect(call("unknown.method.abc")).rejects.toThrow();
  });

  it("tryConnect() returns a socket when daemon is running", async () => {
    const socket = await tryConnect(2000);
    expect(socket).not.toBeNull();
    socket?.end();
  });

  it("tryConnect() returns null when no daemon is at the given path", async () => {
    // Temporarily point to a worker ID that has no running daemon
    const prev = process.env.JARVIS_WORKER_ID;
    process.env.JARVIS_WORKER_ID = "no-such-daemon-xyzzy";
    try {
      const socket = await tryConnect(500);
      expect(socket).toBeNull();
    } finally {
      process.env.JARVIS_WORKER_ID = prev ?? TEST_WORKER_ID;
    }
  });
});
