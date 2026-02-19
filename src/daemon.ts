// Daemon process lifecycle management
// Dual-purpose: (1) imported by cli.ts for start/stop/status, (2) runs as daemon process

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, openSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getSocketPath, tryConnect } from "./client.js";
import { startServer, stopServer, setShutdownCallback, setChromeStatus } from "./server.js";
import { connect, launchChrome, getConnectedBrowser } from "./browser.js";

// --- PID / log file paths ---

export function getPidFilePath(): string {
  const workerId = process.env.JARVIS_WORKER_ID;
  return workerId
    ? `/tmp/jarvis-browser-daemon-${workerId}.pid`
    : "/tmp/jarvis-browser-daemon.pid";
}

export function getLogFilePath(): string {
  const workerId = process.env.JARVIS_WORKER_ID;
  return workerId
    ? `/tmp/jarvis-browser-daemon-${workerId}.log`
    : "/tmp/jarvis-browser-daemon.log";
}

// --- Daemon status checks ---

export function isDaemonRunning(): boolean {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (isNaN(pid) || pid <= 0) return false;
    process.kill(pid, 0); // signal 0 = process existence check
    return true;
  } catch {
    return false;
  }
}

export function getDaemonPid(): number | null {
  const pidFile = getPidFilePath();
  if (!existsSync(pidFile)) return null;
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// --- Start daemon (invoked by CLI) ---

const DAEMON_START_TIMEOUT_MS = 12_000;
const DAEMON_SOCKET_POLL_MS = 150;

export async function startDaemon(opts?: { port?: number }): Promise<void> {
  if (isDaemonRunning()) {
    process.stderr.write("[jarvis-browser] Daemon already running.\n");
    return;
  }

  // Resolve path to the daemon entry point (dist/daemon.js)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const daemonEntry = join(__dirname, "daemon.js");

  if (!existsSync(daemonEntry)) {
    throw new Error(
      `Daemon entry not found: ${daemonEntry}. Run 'npm run build' first.`,
    );
  }

  const logPath = getLogFilePath();
  const logFd = openSync(logPath, "a");

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env.JARVIS_DAEMON_MODE = "1";
  if (opts?.port) env.JARVIS_CDP_PORT = String(opts.port);

  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env,
  });
  child.unref();

  // Wait until socket is ready to accept connections
  const socketPath = getSocketPath();
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(DAEMON_SOCKET_POLL_MS);
    if (existsSync(socketPath)) {
      const socket = await tryConnect(500);
      if (socket) {
        socket.end();
        return; // Daemon is ready
      }
    }
  }

  throw new Error(
    `Daemon failed to start within ${DAEMON_START_TIMEOUT_MS / 1000}s. ` +
    `Check log: ${logPath}`,
  );
}

// --- Stop daemon (invoked by CLI) ---

const DAEMON_STOP_TIMEOUT_MS = 5_000;

export async function stopDaemon(): Promise<void> {
  const pidFile = getPidFilePath();

  if (!isDaemonRunning()) {
    // Clean up stale files
    await unlink(pidFile).catch(() => {});
    await unlink(getSocketPath()).catch(() => {});
    throw new Error("Daemon is not running");
  }

  const pid = getDaemonPid()!;
  process.kill(pid, "SIGTERM");

  // Wait for PID file to be removed (daemon cleans up on exit)
  const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(100);
    if (!existsSync(pidFile)) return;
  }

  // Force kill if still running
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already dead
  }
  await unlink(pidFile).catch(() => {});
  await unlink(getSocketPath()).catch(() => {});
}

// --- Daemon health / status (via RPC) ---

export async function getDaemonStatusViaRpc(): Promise<unknown> {
  const socket = await tryConnect();
  if (!socket) return { running: false };
  try {
    const { sendRequest } = await import("./client.js");
    const result = await sendRequest(socket, "daemon.status");
    return { running: true, ...(result as object) };
  } finally {
    socket.end();
  }
}

export async function getDaemonHealthViaRpc(): Promise<unknown> {
  const socket = await tryConnect();
  if (!socket) throw new Error("Daemon is not running");
  try {
    const { sendRequest } = await import("./client.js");
    return await sendRequest(socket, "daemon.health");
  } finally {
    socket.end();
  }
}

// --- Daemon main (runs when JARVIS_DAEMON_MODE=1) ---

const CHROME_RECONNECT_INTERVAL_MS = 5_000;
const CHROME_DISCONNECT_GRACE_MS = 60_000;

async function runDaemonMain(): Promise<void> {
  const port = parseInt(process.env.JARVIS_CDP_PORT ?? "9222", 10);

  process.stderr.write(
    `[jarvis-daemon] Starting (pid=${process.pid}, port=${port})\n`,
  );

  // Write PID file
  const pidFile = getPidFilePath();
  writeFileSync(pidFile, String(process.pid), "utf-8");

  // Clean up on exit
  let cleanupDone = false;
  async function cleanup(): Promise<void> {
    if (cleanupDone) return;
    cleanupDone = true;
    process.stderr.write("[jarvis-daemon] Shutting down...\n");
    await stopServer().catch(() => {});
    await unlink(pidFile).catch(() => {});
    process.stderr.write("[jarvis-daemon] Done.\n");
  }

  process.on("SIGTERM", () => { cleanup().then(() => process.exit(0)); });
  process.on("SIGINT",  () => { cleanup().then(() => process.exit(0)); });

  setShutdownCallback(() => { cleanup().then(() => process.exit(0)); });

  // Connect to Chrome (non-fatal if not running — daemon still starts)
  await connectToChrome(port);

  // Start Chrome reconnect loop
  startChromeReconnectLoop(port);

  // Start JSON-RPC server
  await startServer();

  process.stderr.write("[jarvis-daemon] Ready.\n");
}

async function connectToChrome(port: number): Promise<void> {
  try {
    await connect(undefined, port);
    setChromeStatus(true, `http://127.0.0.1:${port}`);
    process.stderr.write(
      `[jarvis-daemon] Connected to Chrome on port ${port}\n`,
    );
  } catch {
    process.stderr.write(
      `[jarvis-daemon] Chrome not available on port ${port} — will retry\n`,
    );
  }
}

function startChromeReconnectLoop(port: number): void {
  let disconnectTime: number | null = null;

  setInterval(() => {
    const connected = getConnectedBrowser() !== null;

    if (connected) {
      disconnectTime = null;
      return;
    }

    // Chrome is disconnected
    if (disconnectTime === null) {
      disconnectTime = Date.now();
      setChromeStatus(false, "");
      process.stderr.write("[jarvis-daemon] Chrome disconnected, attempting reconnect...\n");
    }

    const elapsed = Date.now() - disconnectTime;
    if (elapsed > CHROME_DISCONNECT_GRACE_MS) {
      process.stderr.write(
        `[jarvis-daemon] Chrome disconnected for ${Math.round(elapsed / 1000)}s — shutting down.\n`,
      );
      process.emit("SIGTERM");
      return;
    }

    // Try to reconnect silently
    connect(undefined, port).then(() => {
      setChromeStatus(true, `http://127.0.0.1:${port}`);
    }).catch(() => {});
  }, CHROME_RECONNECT_INTERVAL_MS).unref();
}

// --- Entry point guard ---

// Run as daemon when JARVIS_DAEMON_MODE is set (spawned by startDaemon())
if (process.env.JARVIS_DAEMON_MODE === "1") {
  runDaemonMain().catch((err) => {
    process.stderr.write(`[jarvis-daemon] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

// --- Utility ---

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Re-export for CLI use
export { launchChrome };
