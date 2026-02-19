// session.ts — Save/load/export/import browser auth state (cookies + storage)
// File location: /tmp/jarvis-browser-sessions/<name>.json (plain) or .enc (encrypted)
// Security: 0600 permissions, domain-scoped cookies, httpOnly redaction on export
// v0.9.0 FM-8: AES-256-GCM encryption via JARVIS_BROWSER_ENCRYPTION_KEY env var

import { mkdir, readFile, writeFile, unlink, readdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { storageDump, storageSet } from "./storage.js";
import { encryptSession, decryptSession, getEncryptionKey } from "./crypto.js";

// --- Constants ---

const SESSIONS_DIR = "/tmp/jarvis-browser-sessions";
const SESSION_TTL_DAYS = 7;
const FILE_PERMS = 0o600 as const;

// --- Types ---

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface SessionData {
  version: 1;
  name: string;
  saved_at: string;
  origin: string;
  cookies: SessionCookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface SessionInfo {
  name: string;
  saved_at: string;
  origin: string;
  expired: boolean;
}

// --- Helpers ---

function sessionJsonPath(name: string): string {
  return join(SESSIONS_DIR, `${name}.json`);
}

function sessionEncPath(name: string): string {
  return join(SESSIONS_DIR, `${name}.enc`);
}

/** Returns the path of the session file that exists (.enc preferred over .json). */
function findSessionFile(name: string): string | null {
  const encPath = sessionEncPath(name);
  if (existsSync(encPath)) return encPath;
  const jsonPath = sessionJsonPath(name);
  if (existsSync(jsonPath)) return jsonPath;
  return null;
}

async function ensureDir(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true, mode: 0o700 });
}

function isExpired(savedAt: string): boolean {
  const saved = new Date(savedAt).getTime();
  const ttlMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - saved > ttlMs;
}

async function readSessionData(filePath: string): Promise<SessionData> {
  const isEncrypted = filePath.endsWith(".enc");
  if (isEncrypted) {
    const key = getEncryptionKey();
    if (!key) throw new Error("Session is encrypted but JARVIS_BROWSER_ENCRYPTION_KEY is not set");
    const raw = decryptSession(await readFile(filePath, "utf-8"), key);
    return JSON.parse(raw) as SessionData;
  }
  return JSON.parse(await readFile(filePath, "utf-8")) as SessionData;
}

// --- Public API ---

export async function saveSession(name: string, page: Page): Promise<SessionData> {
  await ensureDir();

  const url = page.url();
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error(`Cannot determine origin from URL: ${url}`);
  }

  // Domain-scoped: only capture cookies belonging to the current page origin
  const allCookies = await page.context().cookies();
  const originHost = new URL(origin).hostname;
  const cookies: SessionCookie[] = allCookies
    .filter((c) => {
      const cookieDomain = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      return originHost === cookieDomain || originHost.endsWith(`.${cookieDomain}`);
    })
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires ?? -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: c.sameSite ?? "None",
    }));

  const [localStorageData, sessionStorageData] = await Promise.all([
    storageDump(page, "local").catch((): Record<string, string> => ({})),
    storageDump(page, "session").catch((): Record<string, string> => ({})),
  ]);

  const data: SessionData = {
    version: 1,
    name,
    saved_at: new Date().toISOString(),
    origin,
    cookies,
    localStorage: localStorageData,
    sessionStorage: sessionStorageData,
  };

  const encKey = getEncryptionKey();
  const json = JSON.stringify(data, null, 2);

  let filePath: string;
  if (encKey) {
    filePath = sessionEncPath(name);
    await writeFile(filePath, encryptSession(json, encKey), "utf-8");
  } else {
    filePath = sessionJsonPath(name);
    await writeFile(filePath, json, "utf-8");
  }
  await chmod(filePath, FILE_PERMS);

  return data;
}

export async function loadSession(
  name: string,
  page: Page,
): Promise<{ cookies_restored: number; storage_restored: number }> {
  const filePath = findSessionFile(name);
  if (!filePath) {
    throw new Error(`Session "${name}" not found`);
  }

  const data = await readSessionData(filePath);

  if (data.version !== 1) {
    throw new Error(`Unsupported session format version: ${data.version}`);
  }
  if (isExpired(data.saved_at)) {
    throw new Error(`Session "${name}" has expired (saved: ${data.saved_at})`);
  }

  // Restore cookies
  const context = page.context();
  if (data.cookies.length > 0) {
    await context.addCookies(
      data.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        ...(c.expires > 0 ? { expires: c.expires } : {}),
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite as "Strict" | "Lax" | "None",
      })),
    );
  }

  // Restore storage
  const lsEntries = Object.entries(data.localStorage);
  const ssEntries = Object.entries(data.sessionStorage);

  await Promise.all([
    ...lsEntries.map(([k, v]) => storageSet(page, k, v, "local").catch(() => {})),
    ...ssEntries.map(([k, v]) => storageSet(page, k, v, "session").catch(() => {})),
  ]);

  return {
    cookies_restored: data.cookies.length,
    storage_restored: lsEntries.length + ssEntries.length,
  };
}

export async function listSessions(): Promise<SessionInfo[]> {
  await ensureDir();
  const files = await readdir(SESSIONS_DIR);

  // Build a map of session name → filename, preferring .enc over .json
  const sessionFiles = new Map<string, string>();
  for (const file of files) {
    if (file.endsWith(".enc")) sessionFiles.set(file.slice(0, -4), file);
  }
  for (const file of files) {
    if (file.endsWith(".json")) {
      const name = file.slice(0, -5);
      if (!sessionFiles.has(name)) sessionFiles.set(name, file);
    }
  }

  const results: SessionInfo[] = [];

  for (const [, file] of sessionFiles) {
    const filePath = join(SESSIONS_DIR, file);
    try {
      const data = await readSessionData(filePath);
      results.push({
        name: data.name,
        saved_at: data.saved_at,
        origin: data.origin,
        expired: isExpired(data.saved_at),
      });
    } catch {
      // Skip malformed / undecryptable files
    }
  }

  return results.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

export async function deleteSession(name: string): Promise<void> {
  const encPath = sessionEncPath(name);
  const jsonPath = sessionJsonPath(name);
  const encExists = existsSync(encPath);
  const jsonExists = existsSync(jsonPath);

  if (!encExists && !jsonExists) {
    throw new Error(`Session "${name}" not found`);
  }
  if (encExists) await unlink(encPath);
  if (jsonExists) await unlink(jsonPath);
}

export async function exportSession(
  name: string,
  outputPath?: string,
  includeSecrets = false,
): Promise<string> {
  const filePath = findSessionFile(name);
  if (!filePath) {
    throw new Error(`Session "${name}" not found`);
  }

  const data = await readSessionData(filePath);

  // Redact httpOnly cookie values unless --include-secrets
  const exported: SessionData = includeSecrets
    ? data
    : {
        ...data,
        cookies: data.cookies.map((c) => ({
          ...c,
          value: c.httpOnly ? "[REDACTED]" : c.value,
        })),
      };

  const dest = outputPath ?? `/tmp/jarvis-browser-session-export-${name}.json`;
  await writeFile(dest, JSON.stringify(exported, null, 2), "utf-8");
  await chmod(dest, FILE_PERMS);
  return dest;
}

export async function importSession(filePath: string, name?: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = await readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as SessionData;

  if (data.version !== 1) {
    throw new Error(`Unsupported session format version: ${data.version}`);
  }
  if (!data.name || !data.saved_at || !data.origin) {
    throw new Error("Invalid session file: missing required fields (name, saved_at, origin)");
  }

  await ensureDir();
  const sessionName = name ?? data.name;
  const importData: SessionData = { ...data, name: sessionName };
  const json = JSON.stringify(importData, null, 2);

  const encKey = getEncryptionKey();
  let dest: string;
  if (encKey) {
    dest = sessionEncPath(sessionName);
    await writeFile(dest, encryptSession(json, encKey), "utf-8");
  } else {
    dest = sessionJsonPath(sessionName);
    await writeFile(dest, json, "utf-8");
  }
  await chmod(dest, FILE_PERMS);

  return sessionName;
}
