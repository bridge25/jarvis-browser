// Shared utilities - ported from OpenClaw (MIT License)

import { parseRoleRef } from "./snapshot.js";

export function requireRef(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const roleRef = raw ? parseRoleRef(raw) : null;
  const ref = roleRef ?? (raw.startsWith("@") ? raw.slice(1) : raw);
  if (!ref) throw new Error("ref is required");
  return ref;
}

export function normalizeTimeoutMs(timeoutMs: number | undefined, fallback: number) {
  return Math.max(500, Math.min(120_000, timeoutMs ?? fallback));
}

export function toAIFriendlyError(error: unknown, selector: string): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("strict mode violation")) {
    const countMatch = message.match(/resolved to (\d+) elements/);
    const count = countMatch ? countMatch[1] : "multiple";
    return new Error(
      `Selector "${selector}" matched ${count} elements. Run a new snapshot to get updated refs.`,
    );
  }

  if (
    (message.includes("Timeout") || message.includes("waiting for")) &&
    (message.includes("to be visible") || message.includes("not visible"))
  ) {
    return new Error(
      `Element "${selector}" not found or not visible. Run a new snapshot to see current elements.`,
    );
  }

  if (
    message.includes("intercepts pointer events") ||
    message.includes("not visible") ||
    message.includes("not receive pointer events")
  ) {
    return new Error(
      `Element "${selector}" is not interactable (hidden or covered). Try scrolling or re-snapshotting.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

// --- Security: URL validation ---

const ALLOWED_SCHEMES = new Set(["http:", "https:", "about:"]);
const BLOCKED_HOSTS = [
  /^169\.254\.169\.254$/,         // AWS metadata
  /^metadata\.google\.internal$/, // GCP metadata
  /^100\.100\.100\.200$/,         // Alibaba metadata
];

function isPrivateIP(hostname: string): boolean {
  // localhost
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  // 10.0.0.0/8
  if (/^10\./.test(hostname)) return true;
  // 172.16.0.0/12
  const m172 = hostname.match(/^172\.(\d+)\./);
  if (m172 && +m172[1] >= 16 && +m172[1] <= 31) return true;
  // 192.168.0.0/16
  if (/^192\.168\./.test(hostname)) return true;
  // 0.0.0.0
  if (hostname === "0.0.0.0") return true;
  return false;
}

export function validateNavigationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `Blocked URL scheme "${parsed.protocol}" — only http:, https:, about: are allowed`,
    );
  }

  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(parsed.hostname)) {
      throw new Error(`Blocked URL host "${parsed.hostname}" — cloud metadata endpoints are not allowed`);
    }
  }

  if (isPrivateIP(parsed.hostname)) {
    throw new Error(
      `Blocked private/local URL "${parsed.hostname}" — use public URLs only. ` +
      `Set JARVIS_ALLOW_PRIVATE=1 to override.`,
    );
  }
}

export function validateNavigationUrlPermissive(url: string): void {
  // Same validation but allows private IPs (for local dev servers)
  if (process.env.JARVIS_ALLOW_PRIVATE === "1") {
    // Only validate scheme + cloud metadata
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: "${url}"`); }
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Blocked URL scheme "${parsed.protocol}"`);
    }
    for (const pattern of BLOCKED_HOSTS) {
      if (pattern.test(parsed.hostname)) {
        throw new Error(`Blocked cloud metadata host "${parsed.hostname}"`);
      }
    }
    return;
  }
  validateNavigationUrl(url);
}

// --- Security: Screenshot path validation ---

import { resolve, sep, dirname, basename, join } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

function resolveReal(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

const SCREENSHOT_ALLOWED_DIRS = [
  resolveReal(tmpdir()),
  resolveReal("/tmp"),
].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

export function validateScreenshotPath(outputPath: string): string {
  // For new files, realpathSync fails. Resolve the parent dir (which exists) instead.
  const absPath = resolve(outputPath);
  const parentDir = resolveReal(dirname(absPath));
  const resolved = join(parentDir, basename(absPath));
  const allowed = SCREENSHOT_ALLOWED_DIRS.some(
    (dir) => resolved === dir || resolved.startsWith(dir + sep),
  );
  if (!allowed) {
    throw new Error(
      `Screenshot path "${outputPath}" is outside allowed directories (${SCREENSHOT_ALLOWED_DIRS.join(", ")}). ` +
      `Use --path /tmp/filename.png or omit --path for the default location.`,
    );
  }
  return resolved;
}

export function jsonOutput(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function textOutput(text: string): void {
  process.stdout.write(text + "\n");
}

// --- v0.7.0: ActionResult output formatter ---

import type { ActionResult } from "./types.js";

/**
 * Format an ActionResult based on --json flag.
 *
 * Without --json: human-readable text (data value as string, or "ok"/"error")
 * With --json:    {"ok":true,"data":...} envelope to stdout, stderr suppressed
 * Error + json:   {"ok":false,"error":"msg","suggestion":"..."} to stdout
 */
export function formatOutput(result: ActionResult, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  // Human-readable text mode
  if (!result.ok) {
    process.stderr.write((result.error ?? result.message ?? "Error") + "\n");
    if (result.suggestion) process.stderr.write(`Suggestion: ${result.suggestion}\n`);
    return;
  }

  if (result.data !== undefined) {
    if (typeof result.data === "string") {
      process.stdout.write(result.data + "\n");
    } else if (typeof result.data === "boolean" || typeof result.data === "number") {
      process.stdout.write(String(result.data) + "\n");
    } else {
      process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
    }
  } else if (result.message) {
    process.stdout.write(result.message + "\n");
  }
}

/**
 * Wrap an error in ActionResult format (for --json error output).
 */
export function errorResult(error: unknown, suggestion?: string): ActionResult {
  const msg = error instanceof Error ? error.message : String(error);
  return { ok: false, error: msg, ...(suggestion ? { suggestion } : {}) };
}

// --- File output: screenshot pattern for all commands ---

import { writeFileSync } from "node:fs";

/**
 * Write large data to file, return small pointer to stdout.
 * Follows the screenshot pattern: binary/large data → file, metadata → stdout.
 */
export function fileOutput(outputPath: string, content: string, meta?: Record<string, unknown>): void {
  const validated = validateOutputPath(outputPath);
  writeFileSync(validated, content, "utf-8");
  jsonOutput({
    ok: true,
    message: `Output saved to ${validated}`,
    file: validated,
    bytes: Buffer.byteLength(content, "utf-8"),
    ...meta,
  });
}

function validateOutputPath(outputPath: string): string {
  const absPath = resolve(outputPath);
  const parentDir = resolveReal(dirname(absPath));
  const resolved = join(parentDir, basename(absPath));
  // Allow /tmp and project-local paths
  const allowed = SCREENSHOT_ALLOWED_DIRS.some(
    (dir) => resolved === dir || resolved.startsWith(dir + sep),
  );
  if (!allowed) {
    // Also allow CWD subtree
    const cwd = resolve(".");
    if (!resolved.startsWith(cwd + sep)) {
      throw new Error(`Output path "${outputPath}" is outside allowed directories. Use /tmp/ or current project.`);
    }
  }
  return resolved;
}
