// Browser connection + session management
// Manages Chrome launch, CDP connection, page state, and ref cache.

import { chromium, type Browser, type Page, type Dialog } from "playwright-core";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { RoleRefMap } from "./types.js";
import {
  buildRoleSnapshotFromAriaSnapshot,
  buildRoleSnapshotFromAiSnapshot,
  getRoleSnapshotStats,
} from "./snapshot.js";
import type { RoleSnapshotOptions } from "./types.js";
import { validateNavigationUrl, validateNavigationUrlPermissive } from "./shared.js";

// --- v0.7.0: Dialog ring buffer ---

const DIALOG_BUFFER_CAPACITY = 10;

export type DialogEntry = {
  type: string;
  message: string;
  handled: "accepted" | "dismissed" | "pending";
  text?: string;       // text sent to prompt dialog
  timestamp: string;
  resolve?: (text?: string) => void;
};

const dialogBuffer: DialogEntry[] = [];
let dialogMode: "accept" | "dismiss" | "queue" = "accept";

export function getDialogMode(): "accept" | "dismiss" | "queue" {
  return dialogMode;
}

export function setDialogMode(mode: "accept" | "dismiss" | "queue"): void {
  dialogMode = mode;
}

export function getDialogBuffer(): readonly DialogEntry[] {
  return dialogBuffer;
}

export function getPendingDialogs(): DialogEntry[] {
  return dialogBuffer.filter((d) => d.handled === "pending");
}

export function getLastDialog(): DialogEntry | undefined {
  return dialogBuffer[dialogBuffer.length - 1];
}

/** Accept or dismiss the oldest pending dialog in queue mode. */
export function resolveOldestDialog(action: "accept" | "dismiss", text?: string): boolean {
  const idx = dialogBuffer.findIndex((d) => d.handled === "pending");
  if (idx === -1) return false;
  const entry = dialogBuffer[idx]!;
  entry.handled = action === "accept" ? "accepted" : "dismissed";
  entry.text = text;
  if (entry.resolve) entry.resolve(action === "accept" ? text : undefined);
  return true;
}

function addDialogEntry(entry: DialogEntry): void {
  dialogBuffer.push(entry);
  // Evict oldest when over capacity
  while (dialogBuffer.length > DIALOG_BUFFER_CAPACITY) {
    dialogBuffer.shift();
  }
}

function buildDialogHandler(page: Page): void {
  page.on("dialog", async (dialog: Dialog) => {
    const entry: DialogEntry = {
      type: dialog.type(),
      message: dialog.message(),
      handled: "pending",
      timestamp: new Date().toISOString(),
    };

    addDialogEntry(entry);

    if (dialogMode === "accept") {
      entry.handled = "accepted";
      await dialog.accept().catch(() => {});
    } else if (dialogMode === "dismiss") {
      entry.handled = "dismissed";
      await dialog.dismiss().catch(() => {});
    } else {
      // queue mode: store a resolver so resolveOldestDialog can act
      await new Promise<void>((resolve) => {
        entry.resolve = async (text?: string) => {
          if (entry.handled === "accepted") {
            await dialog.accept(text).catch(() => {});
          } else {
            await dialog.dismiss().catch(() => {});
          }
          resolve();
        };
      });
    }
  });
}

// --- Constants ---

const DEFAULT_PORT = 9222;
const MAX_REF_CACHE = 50;
const MAX_DISK_CACHE = 50;
const CHROME_LAUNCH_TIMEOUT_MS = 15_000;
const CHROME_LAUNCH_POLL_INITIAL_MS = 100;
const CHROME_LAUNCH_POLL_MAX_MS = 2_000;
const CDP_CONNECT_ATTEMPTS = 3;
const CDP_CONNECT_BASE_TIMEOUT_MS = 5_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

// --- Chrome executable discovery ---

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error("Chrome/Chromium not found. Set CHROME_PATH env variable.");
}

// --- State ---

type PageRoleState = {
  refs: RoleRefMap;
  mode: "role" | "aria";
  frameSelector?: string;
};

let browser: Browser | null = null;
let chromeProcess: ChildProcess | null = null;
const roleRefsByTarget = new Map<string, PageRoleState>();

// Track pages that already have dialog handlers registered (to avoid duplicates)
const dialogHandledPages = new WeakSet<Page>();

function ensureDialogHandler(page: Page): void {
  if (!dialogHandledPages.has(page)) {
    dialogHandledPages.add(page);
    buildDialogHandler(page);
  }
}

// --- Chrome launch ---

function getCdpUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function launchChrome(opts?: {
  port?: number;
  headless?: boolean;
  noSandbox?: boolean;
  executablePath?: string;
  userDataDir?: string;
  proxy?: string;
  proxyBypass?: string;
}): Promise<{ cdpUrl: string; pid: number }> {
  const port = opts?.port ?? DEFAULT_PORT;
  const exe = opts?.executablePath ?? process.env.CHROME_PATH ?? findChrome();
  const userDataDir = opts?.userDataDir ?? `/tmp/jarvis-browser-profile-${port}`;

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter",
    "--disable-blink-features=AutomationControlled",
    "--password-store=basic",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
  ];

  if (opts?.headless) {
    args.push("--headless=new", "--disable-gpu");
  }
  if (opts?.noSandbox) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  if (opts?.proxy) {
    args.push(`--proxy-server=${opts.proxy}`);
  }
  if (opts?.proxyBypass) {
    args.push(`--proxy-bypass-list=${opts.proxyBypass}`);
  }

  args.push("about:blank");

  const child = spawn(exe, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  chromeProcess = child;

  // Capture spawn errors for immediate feedback
  const spawnState = { error: null as Error | null };
  child.on("error", (err) => { spawnState.error = err; });

  // Wait for CDP to be ready (exponential backoff: 100ms → 200ms → 400ms → ... → 2s)
  const cdpUrl = getCdpUrl(port);
  const deadline = Date.now() + CHROME_LAUNCH_TIMEOUT_MS;
  let pollMs = CHROME_LAUNCH_POLL_INITIAL_MS;
  while (Date.now() < deadline) {
    if (spawnState.error) {
      throw new Error(`Chrome failed to launch: ${spawnState.error.message}`);
    }
    try {
      const resp = await fetch(`${cdpUrl}/json/version`);
      if (resp.ok) return { cdpUrl, pid: child.pid! };
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, pollMs));
    pollMs = Math.min(pollMs * 2, CHROME_LAUNCH_POLL_MAX_MS);
  }
  throw new Error(`Chrome did not start within ${CHROME_LAUNCH_TIMEOUT_MS / 1000}s on port ${port}`);
}

// --- CDP connection ---

export async function connect(cdpUrl?: string, port?: number): Promise<Browser> {
  const url = cdpUrl ?? getCdpUrl(port ?? DEFAULT_PORT);

  if (browser?.isConnected()) return browser;

  // Try to get WebSocket URL from /json/version
  let endpoint = url;
  try {
    const resp = await fetch(`${url}/json/version`);
    if (resp.ok) {
      const info = (await resp.json()) as { webSocketDebuggerUrl?: string };
      if (info.webSocketDebuggerUrl) {
        endpoint = info.webSocketDebuggerUrl;
      }
    }
  } catch {
    // Fall through to use HTTP URL
  }

  for (let attempt = 0; attempt < CDP_CONNECT_ATTEMPTS; attempt++) {
    try {
      const timeout = CDP_CONNECT_BASE_TIMEOUT_MS + attempt * 2000;
      browser = await chromium.connectOverCDP(endpoint, { timeout });
      browser.on("disconnected", () => { browser = null; });
      return browser;
    } catch {
      await new Promise((r) => setTimeout(r, 250 + attempt * 250));
    }
  }
  throw new Error(`Failed to connect to Chrome at ${url}. Is Chrome running with --remote-debugging-port?`);
}

export function getConnectedBrowser(): Browser | null {
  return browser?.isConnected() ? browser : null;
}

// --- Page management ---

async function getAllPages(): Promise<Page[]> {
  if (!browser?.isConnected()) throw new Error("Not connected to browser");
  return browser.contexts().flatMap((c) => c.pages());
}

async function getTargetId(page: Page): Promise<string | null> {
  const session = await page.context().newCDPSession(page);
  try {
    const info = (await session.send("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    return String(info?.targetInfo?.targetId ?? "").trim() || null;
  } finally {
    await session.detach().catch(() => {});
  }
}

export async function getPage(targetId?: string): Promise<Page> {
  const pages = await getAllPages();
  if (!pages.length) throw new Error("No pages available");

  let found: Page | undefined;
  if (!targetId) {
    found = pages[0];
  } else {
    for (const page of pages) {
      const tid = await getTargetId(page).catch(() => null);
      if (tid === targetId) { found = page; break; }
    }
    if (!found && pages.length === 1) found = pages[0];
  }

  if (!found) throw new Error(`Tab "${targetId}" not found`);
  ensureDialogHandler(found);
  return found;
}

export async function listTabs(): Promise<Array<{ targetId: string; title: string; url: string }>> {
  const pages = await getAllPages();
  const results: Array<{ targetId: string; title: string; url: string }> = [];
  for (const page of pages) {
    const tid = await getTargetId(page).catch(() => null);
    if (tid) {
      results.push({
        targetId: tid,
        title: await page.title().catch(() => ""),
        url: page.url(),
      });
    }
  }
  return results;
}

export async function openTab(url: string): Promise<{ targetId: string; title: string; url: string }> {
  if (!browser?.isConnected()) throw new Error("Not connected");
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  ensureDialogHandler(page);
  if (url && url !== "about:blank") {
    validateNavigationUrl(url);
    await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" }).catch((err) => {
      throw new Error(`Navigation to "${url}" failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  const tid = await getTargetId(page).catch(() => null);
  if (!tid) throw new Error("Failed to get targetId for new tab");
  return {
    targetId: tid,
    title: await page.title().catch(() => ""),
    url: page.url(),
  };
}

export async function closeTab(targetId: string): Promise<void> {
  const page = await getPage(targetId);
  await page.close();
}

export async function focusTab(targetId: string): Promise<void> {
  const page = await getPage(targetId);
  await page.bringToFront();
}

// --- Ref storage (in-memory + file-based persistence) ---

import { writeFile, readFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function getRefCacheDir(): string {
  const base = join(tmpdir(), "jarvis-browser-refs");
  const workerId = process.env.JARVIS_WORKER_ID;
  return workerId ? join(base, workerId) : base;
}

function getRefCachePath(targetId: string): string {
  return join(getRefCacheDir(), `${targetId.replace(/[^a-zA-Z0-9]/g, "_")}.json`);
}

async function cleanDiskCache(): Promise<void> {
  try {
    const cacheDir = getRefCacheDir();
    const entries = await readdir(cacheDir);
    const files = await Promise.all(
      entries
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const full = join(cacheDir, f);
          const s = await stat(full);
          return { path: full, mtime: s.mtimeMs };
        }),
    );
    files.sort((a, b) => a.mtime - b.mtime);
    while (files.length > MAX_DISK_CACHE) {
      const oldest = files.shift();
      if (oldest) await unlink(oldest.path);
    }
  } catch {
    // Best-effort cleanup
  }
}

function persistRefs(targetId: string, state: PageRoleState): void {
  try {
    mkdirSync(getRefCacheDir(), { recursive: true });
    writeFileSync(getRefCachePath(targetId), JSON.stringify(state), "utf-8");
  } catch {
    // Best-effort persistence
  }
  // Async disk cache cleanup — non-critical, OK to race with process.exit
  cleanDiskCache().catch(() => {});
}

function loadPersistedRefs(targetId: string): PageRoleState | undefined {
  // Sync read is intentional: needed before returning from getStoredRefs
  try {
    const data = readFileSync(getRefCachePath(targetId), "utf-8");
    return JSON.parse(data) as PageRoleState;
  } catch {
    return undefined;
  }
}

export function storeRefs(targetId: string, refs: RoleRefMap, mode: "role" | "aria", frameSelector?: string): void {
  const state: PageRoleState = { refs, mode, frameSelector };
  roleRefsByTarget.set(targetId, state);
  persistRefs(targetId, state);
  while (roleRefsByTarget.size > MAX_REF_CACHE) {
    const first = roleRefsByTarget.keys().next();
    if (first.done) break;
    roleRefsByTarget.delete(first.value);
  }
}

export function getStoredRefs(targetId: string): PageRoleState | undefined {
  return roleRefsByTarget.get(targetId) ?? loadPersistedRefs(targetId);
}

// --- refLocator: ref → Playwright locator ---

export function refLocator(page: Page, ref: string, state?: PageRoleState) {
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  if (/^e\d+$/.test(normalized)) {
    if (state?.mode === "aria") {
      const scope = state.frameSelector
        ? page.frameLocator(state.frameSelector)
        : page;
      return scope.locator(`aria-ref=${normalized}`);
    }
    const info = state?.refs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`,
      );
    }
    const scope = state?.frameSelector
      ? page.frameLocator(state.frameSelector)
      : page;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locAny = scope as any;
    const locator = info.name
      ? locAny.getByRole(info.role, { name: info.name, exact: true })
      : locAny.getByRole(info.role);
    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  return page.locator(`aria-ref=${normalized}`);
}

// --- Snapshot functions ---

type SnapshotForAI = {
  _snapshotForAI?: (opts?: { timeout?: number; track?: string }) => Promise<{ full: string }>;
};

export async function takeSnapshot(opts: {
  targetId?: string;
  mode?: "role" | "aria" | "ai";
  options?: RoleSnapshotOptions;
  maxChars?: number;
  /** v0.7.0: Scope snapshot to a CSS selector region */
  selector?: string;
  /** v0.7.0: Include cursor:pointer elements even without ARIA role */
  cursor?: boolean;
}) {
  const page = await getPage(opts.targetId);
  const resolvedId = opts.targetId ?? (await getTargetId(page)) ?? "default";
  const mode = opts.mode ?? "role";

  // Store under both resolved ID and "default" alias for cross-process CLI usage
  const storeRefsWithAlias = (refs: RoleRefMap, refMode: "role" | "aria", frame?: string) => {
    storeRefs(resolvedId, refs, refMode, frame);
    if (resolvedId !== "default") {
      storeRefs("default", refs, refMode, frame);
    }
  };

  if (mode === "ai") {
    const maybe = page as unknown as SnapshotForAI;
    if (!maybe._snapshotForAI) {
      throw new Error("Playwright _snapshotForAI not available. Upgrade playwright-core.");
    }
    const result = await maybe._snapshotForAI({ timeout: 5000, track: "response" });
    let snapshot = String(result?.full ?? "");
    let truncated = false;
    if (opts.maxChars && snapshot.length > opts.maxChars) {
      snapshot = `${snapshot.slice(0, opts.maxChars)}\n\n[...TRUNCATED]`;
      truncated = true;
    }
    const built = buildRoleSnapshotFromAiSnapshot(snapshot, opts.options);
    storeRefsWithAlias(built.refs, "aria");
    return {
      snapshot: built.snapshot,
      refs: built.refs,
      stats: getRoleSnapshotStats(built.snapshot, built.refs),
      truncated,
    };
  }

  if (mode === "aria") {
    // CDP-based accessibility tree
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Accessibility.enable").catch(() => {});
      const res = (await session.send("Accessibility.getFullAXTree")) as {
        nodes?: Array<{ nodeId: string; role?: { value?: string }; name?: { value?: string }; childIds?: string[] }>;
      };
      const nodes = Array.isArray(res?.nodes) ? res.nodes : [];
      // Simple formatting: just return raw node count for now
      const ariaText = nodes
        .slice(0, 500)
        .map((n) => `- ${n.role?.value ?? "unknown"} "${n.name?.value ?? ""}"`)
        .join("\n");
      const built = buildRoleSnapshotFromAriaSnapshot(ariaText, opts.options);
      storeRefsWithAlias(built.refs, "aria");
      return {
        snapshot: built.snapshot,
        refs: built.refs,
        stats: getRoleSnapshotStats(built.snapshot, built.refs),
      };
    } finally {
      await session.detach().catch(() => {});
    }
  }

  // Default: role mode using Playwright's ariaSnapshot()
  // v0.7.0: --selector scopes to a CSS region; --cursor appends cursor:pointer elements
  const rootSelector = opts.selector ?? ":root";
  const locator = page.locator(rootSelector);
  const ariaSnapshot = await locator.ariaSnapshot();
  let snapshotText = String(ariaSnapshot ?? "");

  // --cursor: append elements with cursor:pointer that have no ARIA role in the snapshot
  if (opts.cursor) {
    const cursorElements = await page.evaluate(() => {
      const results: string[] = [];
      const all = document.querySelectorAll("*");
      for (const el of all) {
        const style = window.getComputedStyle(el);
        if (style.cursor === "pointer" && !el.getAttribute("role")) {
          const tag = el.tagName.toLowerCase();
          const text = (el.textContent ?? "").trim().slice(0, 60);
          if (text) results.push(`- ${tag} "${text}" [cursor:pointer]`);
        }
      }
      return results.slice(0, 50); // cap at 50 cursor elements
    }).catch(() => [] as string[]);

    if (cursorElements.length > 0) {
      snapshotText += "\n\n# cursor:pointer elements:\n" + cursorElements.join("\n");
    }
  }

  const built = buildRoleSnapshotFromAriaSnapshot(snapshotText, opts.options);
  storeRefsWithAlias(built.refs, "role");
  return {
    snapshot: built.snapshot,
    refs: built.refs,
    stats: getRoleSnapshotStats(built.snapshot, built.refs),
    ...(opts.selector ? { scopedTo: opts.selector } : {}),
  };
}

// --- Cleanup ---

export async function stopChrome(): Promise<void> {
  if (browser?.isConnected()) {
    await browser.close().catch(() => {});
    browser = null;
  }
  if (chromeProcess) {
    chromeProcess.kill("SIGTERM");
    chromeProcess = null;
  }
}

export async function checkStatus(port?: number): Promise<{ connected: boolean; tabs: number; cdpUrl: string }> {
  const cdpUrl = getCdpUrl(port ?? DEFAULT_PORT);
  try {
    const resp = await fetch(`${cdpUrl}/json/version`);
    if (!resp.ok) return { connected: false, tabs: 0, cdpUrl };
    const listResp = await fetch(`${cdpUrl}/json/list`);
    const tabs = listResp.ok ? ((await listResp.json()) as unknown[]).length : 0;
    return { connected: true, tabs, cdpUrl };
  } catch {
    return { connected: false, tabs: 0, cdpUrl };
  }
}

// --- Navigation: reload, back, forward ---

export async function reloadPage(targetId?: string): Promise<{ url: string }> {
  const page = await getPage(targetId);
  await page.reload({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  return { url: page.url() };
}

export async function goBack(targetId?: string): Promise<{ url: string | null }> {
  const page = await getPage(targetId);
  const response = await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  return { url: response ? page.url() : null };
}

export async function goForward(targetId?: string): Promise<{ url: string | null }> {
  const page = await getPage(targetId);
  const response = await page.goForward({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  return { url: response ? page.url() : null };
}

// --- Tab cleanup ---

export async function cleanupTabs(opts?: {
  keepUrls?: string[];
  closeBlank?: boolean;
}): Promise<{ closed: number; remaining: number }> {
  const pages = await getAllPages();
  const keepPatterns = opts?.keepUrls ?? [];
  const closeBlank = opts?.closeBlank ?? true;
  let closed = 0;

  for (const page of pages) {
    const url = page.url();
    const isBlank = url === "about:blank" || url === "chrome://newtab/";
    const isKept = keepPatterns.some((p) => url.includes(p));

    if (isKept) continue;
    if (isBlank && closeBlank) {
      await page.close().catch(() => {});
      closed++;
    } else if (!isBlank && !isKept) {
      // Close non-blank pages that aren't in keepUrls
      // Only close if keepUrls is specified (selective mode)
      if (keepPatterns.length > 0) {
        await page.close().catch(() => {});
        closed++;
      }
    }
  }

  // If no keepUrls specified, close only blank tabs
  if (keepPatterns.length === 0 && !closeBlank) {
    // Nothing to close in this mode
  }

  const remaining = (await getAllPages()).length;
  return { closed, remaining };
}

// --- Ensure connected (used by CLI direct mode) ---

export async function ensureConnected(port?: number): Promise<void> {
  if (getConnectedBrowser()) return;

  // Try connecting to already-running Chrome first
  try {
    await connect(undefined, port);
    return;
  } catch {
    // Chrome not running — auto-launch it
  }

  const resolvedPort = port ?? DEFAULT_PORT;
  process.stderr.write(`[jarvis-browser] Chrome not running. Auto-launching on port ${resolvedPort}...\n`);
  await launchChrome({ port: resolvedPort });
  await connect(undefined, resolvedPort);
}

// --- Cookie management ---

export async function getCookies(targetId?: string, urls?: string[]): Promise<unknown[]> {
  const page = await getPage(targetId);
  const context = page.context();
  const cookies = await context.cookies(urls);
  return cookies;
}

export async function setCookies(cookies: Array<{
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}>): Promise<void> {
  if (!browser?.isConnected()) throw new Error("Not connected");
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context");
  await context.addCookies(cookies);
}

export async function clearCookies(targetId?: string): Promise<void> {
  const page = await getPage(targetId);
  await page.context().clearCookies();
}
