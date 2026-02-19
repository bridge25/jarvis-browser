// JSON-RPC client over Unix Domain Socket
// Used by cli.ts to communicate with the daemon process

import net from "node:net";
import { makeRequest, isRpcError, type RpcResponse } from "./protocol.js";

let _requestId = 0;
function nextId(): number {
  return ++_requestId;
}

export function getSocketPath(): string {
  const workerId = process.env.JARVIS_WORKER_ID;
  return workerId
    ? `/tmp/jarvis-browser-${workerId}.sock`
    : "/tmp/jarvis-browser.sock";
}

// Connect to daemon socket. Returns socket or throws.
export function connectToSocket(socketPath?: string): Promise<net.Socket> {
  const path = socketPath ?? getSocketPath();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

// Try to connect with timeout. Returns null if daemon is not running.
export async function tryConnect(timeoutMs = 1500): Promise<net.Socket | null> {
  try {
    return await Promise.race([
      connectToSocket(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("connection timeout")), timeoutMs),
      ),
    ]);
  } catch {
    return null;
  }
}

// Send one JSON-RPC request and receive one response (newline-delimited).
export function sendRequest(
  socket: net.Socket,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId();
    const req = makeRequest(id, method, params);

    let buffer = "";

    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf-8");
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) return;

      const line = buffer.slice(0, newlineIdx);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);

      try {
        const resp = JSON.parse(line) as RpcResponse;
        if (isRpcError(resp)) {
          const err = new Error(resp.error.message);
          (err as NodeJS.ErrnoException).code = String(resp.error.code);
          reject(err);
        } else {
          resolve(resp.result);
        }
      } catch {
        reject(new Error(`Daemon returned invalid JSON: ${line.slice(0, 200)}`));
      }
    }

    function onError(err: Error) {
      socket.removeListener("data", onData);
      reject(err);
    }

    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(JSON.stringify(req) + "\n");
  });
}

// Send request and automatically close socket when done.
export async function call(
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const socket = await connectToSocket();
  try {
    return await sendRequest(socket, method, params);
  } finally {
    socket.end();
  }
}
