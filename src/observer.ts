// Page observer: ring-buffered console, error, and network event capture
// Attached per-page by the daemon when a tab is opened.

import type { Page, ConsoleMessage, Request, Response } from "playwright-core";

// --- Types ---

export interface ConsoleEntry {
  level: string;       // Playwright msg.type(): 'log', 'warning', 'error', 'info', 'debug', etc.
  text: string;
  url: string;
  line: number;
  timestamp: number;   // Unix seconds
}

export interface ErrorEntry {
  message: string;
  stack: string;
  timestamp: number;   // Unix seconds
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number | null;   // null = requestfailed (no HTTP response)
  duration_ms: number;
  resource_type: string;
  timestamp: number;       // Unix seconds
  failed?: boolean;
  /** Response body text (only captured when network-body-max-kb > 0) */
  body?: string;
}

export interface Observation {
  console_errors: number;
  console_warnings: number;
  js_exceptions: number;
  failed_requests: number;
  pending_requests: number;
}

// --- RingBuffer ---

export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.buf = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Returns all items in insertion order (oldest first). */
  getAll(): T[] {
    if (this.count === 0) return [];
    const start = this.count < this.capacity ? 0 : this.head;
    return Array.from(
      { length: this.count },
      (_, i) => this.buf[(start + i) % this.capacity] as T,
    );
  }

  /** Returns the last N items (most recent). */
  getLast(n: number): T[] {
    const all = this.getAll();
    return n >= all.length ? all : all.slice(all.length - n);
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.getAll().filter(predicate);
  }

  clear(): void {
    this.buf = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}

// --- Network body capture config (v0.8.0) ---

/** Max KB of response body to capture. 0 = disabled. Controlled by network-body-max-kb config key. */
let networkBodyMaxKb = 0;

export function setNetworkBodyMaxKb(kb: number): void {
  networkBodyMaxKb = kb;
}

// --- Glob helper ---

/** Converts a simple glob pattern (*, **, ?) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // escape regex specials
    .replace(/\*\*/g, "__DS__")             // ** → placeholder
    .replace(/\*/g, "[^/]*")               // * → non-slash wildcard
    .replace(/\?/g, ".")                   // ? → any single char
    .replace(/__DS__/g, ".*");             // ** → any chars
  return new RegExp(escaped);
}

// --- Status filter helper (v0.8.0) ---

/**
 * Matches a network status code against a filter expression.
 * Supported: "2xx" | "4xx" | "5xx" | exact number string e.g. "404"
 */
function matchesStatusFilter(status: number | null, filter: string): boolean {
  if (status === null) return false;
  if (filter === "2xx") return status >= 200 && status < 300;
  if (filter === "4xx") return status >= 400 && status < 500;
  if (filter === "5xx") return status >= 500 && status < 600;
  const exact = Number(filter);
  return !Number.isNaN(exact) && status === exact;
}

// --- Per-page data ---

type ListenerOff = () => void;

interface PageData {
  consoleBuf: RingBuffer<ConsoleEntry>;
  errorBuf: RingBuffer<ErrorEntry>;
  networkBuf: RingBuffer<NetworkEntry>;
  pendingRequests: Map<object, number>;   // request object → startTime (ms)
}

export interface SnapshotAge {
  stale: boolean;      // true when last snapshot was taken > 30s ago
  age_s: number;       // seconds since last snapshot
}

// --- PageObserver ---

class PageObserver {
  private pages = new Map<string, PageData>();
  private cleanups = new Map<string, ListenerOff[]>();
  private attached = new Set<string>();
  private snapshotTimes = new Map<string, number>();

  /**
   * Attach event listeners to a page and begin buffering.
   * Idempotent: subsequent calls for the same targetId are no-ops.
   */
  attach(page: Page, targetId: string): void {
    if (this.attached.has(targetId)) return;
    this.attached.add(targetId);

    const data: PageData = {
      consoleBuf: new RingBuffer<ConsoleEntry>(500),
      errorBuf: new RingBuffer<ErrorEntry>(100),
      networkBuf: new RingBuffer<NetworkEntry>(200),
      pendingRequests: new Map<object, number>(),
    };
    this.pages.set(targetId, data);

    // Console messages
    const consoleHandler = (msg: ConsoleMessage) => {
      const loc = msg.location();
      data.consoleBuf.push({
        level: msg.type(),           // Playwright uses 'warning', not 'warn'
        text: msg.text(),
        url: loc.url,
        line: loc.lineNumber,
        timestamp: Math.floor(Date.now() / 1000),
      });
    };
    page.on("console", consoleHandler);

    // Uncaught JS exceptions
    const errorHandler = (err: Error) => {
      data.errorBuf.push({
        message: err.message,
        stack: err.stack ?? "",
        timestamp: Math.floor(Date.now() / 1000),
      });
    };
    page.on("pageerror", errorHandler);

    // Network: track start time
    const requestHandler = (req: Request) => {
      data.pendingRequests.set(req, Date.now());
    };
    page.on("request", requestHandler);

    // Network: completed response (v0.8.0: optional body capture)
    const responseHandler = (resp: Response) => {
      const req = resp.request();
      const startMs = data.pendingRequests.get(req) ?? Date.now();
      data.pendingRequests.delete(req);
      const status = resp.status();
      const entry: NetworkEntry = {
        url: resp.url(),
        method: req.method(),
        status,
        duration_ms: Date.now() - startMs,
        resource_type: req.resourceType(),
        timestamp: Math.floor(Date.now() / 1000),
        failed: status >= 400,
      };

      // Async body capture — fire-and-forget, push entry first then update body
      if (networkBodyMaxKb > 0) {
        data.networkBuf.push(entry);
        resp.body().then((buf) => {
          const maxBytes = networkBodyMaxKb * 1024;
          if (buf.length <= maxBytes) {
            entry.body = buf.toString("utf-8");
          } else {
            entry.body = buf.slice(0, maxBytes).toString("utf-8") + "…[truncated]";
          }
        }).catch(() => { /* body unavailable — ignore */ });
        return;
      }

      data.networkBuf.push(entry);
    };
    page.on("response", responseHandler);

    // Network: failed request (no response)
    const requestFailedHandler = (req: Request) => {
      const startMs = data.pendingRequests.get(req) ?? Date.now();
      data.pendingRequests.delete(req);
      data.networkBuf.push({
        url: req.url(),
        method: req.method(),
        status: null,
        duration_ms: Date.now() - startMs,
        resource_type: req.resourceType(),
        timestamp: Math.floor(Date.now() / 1000),
        failed: true,
      });
    };
    page.on("requestfailed", requestFailedHandler);

    this.cleanups.set(targetId, [
      () => page.off("console", consoleHandler),
      () => page.off("pageerror", errorHandler),
      () => page.off("request", requestHandler),
      () => page.off("response", responseHandler),
      () => page.off("requestfailed", requestFailedHandler),
    ]);
  }

  /** Remove listeners but keep buffered data for retrieval. */
  detach(targetId: string): void {
    const fns = this.cleanups.get(targetId) ?? [];
    fns.forEach((fn) => fn());
    this.cleanups.delete(targetId);
    this.attached.delete(targetId);
  }

  /** Remove listeners AND delete buffered data (call on tab close). */
  destroy(targetId: string): void {
    this.detach(targetId);
    this.pages.delete(targetId);
    this.snapshotTimes.delete(targetId);
  }

  /** Record that a snapshot was taken for this tab (called by server after snapshot command). */
  recordSnapshot(targetId: string): void {
    this.snapshotTimes.set(targetId, Date.now());
  }

  /**
   * Returns snapshot age for a tab, or null if no snapshot has been taken.
   * stale = true when the last snapshot was taken more than 30 seconds ago.
   */
  getSnapshotAge(targetId: string): SnapshotAge | null {
    const t = this.snapshotTimes.get(targetId);
    if (t === undefined) return null;
    const age_s = Math.floor((Date.now() - t) / 1000);
    return { stale: age_s > 30, age_s };
  }

  // --- Query methods ---

  getConsole(
    targetId: string,
    opts: { level?: string; last?: number; clear?: boolean } = {},
  ): { messages: ConsoleEntry[]; total: number } {
    const data = this.pages.get(targetId);
    if (!data) return { messages: [], total: 0 };

    const total = data.consoleBuf.size;

    if (opts.clear) {
      const all = data.consoleBuf.getAll();
      data.consoleBuf.clear();
      const msgs = opts.last !== undefined ? all.slice(-opts.last) : all;
      return { messages: msgs, total };
    }

    const raw = data.consoleBuf.getAll();
    // CLI accepts 'warn' but Playwright uses 'warning' internally
    const normalized = opts.level === "warn" ? "warning" : opts.level;
    const leveled =
      normalized && normalized !== "all"
        ? raw.filter((m) => m.level === normalized)
        : raw;
    const messages =
      opts.last !== undefined ? leveled.slice(-opts.last) : leveled;

    return { messages, total };
  }

  getErrors(targetId: string, opts: { last?: number } = {}): ErrorEntry[] {
    const data = this.pages.get(targetId);
    if (!data) return [];
    const all = data.errorBuf.getAll();
    return opts.last !== undefined ? all.slice(-opts.last) : all;
  }

  getRequests(
    targetId: string,
    opts: {
      filter?: string;
      urlPattern?: string;
      last?: number;
      /** HTTP method filter, e.g. "GET", "POST" (case-insensitive) */
      method?: string;
      /** Status filter: "2xx", "4xx", "5xx", or exact code string e.g. "404" */
      statusFilter?: string;
      /** When true, omit entries that have no body captured */
      withBody?: boolean;
    } = {},
  ): { requests: NetworkEntry[]; pending: number } {
    const data = this.pages.get(targetId);
    if (!data) return { requests: [], pending: 0 };

    const raw = data.networkBuf.getAll();

    // Existing filter: failed / api
    const typeFiltered =
      opts.filter === "failed"
        ? raw.filter((e) => e.failed === true)
        : opts.filter === "api"
          ? raw.filter(
              (e) => e.resource_type === "fetch" || e.resource_type === "xhr",
            )
          : raw;

    // URL pattern filter
    const pattern = opts.urlPattern;
    const urlFiltered = pattern
      ? typeFiltered.filter((e) => globToRegex(pattern).test(e.url))
      : typeFiltered;

    // v0.8.0: method filter (case-insensitive)
    const methodUpper = opts.method ? opts.method.toUpperCase() : null;
    const methodFiltered = methodUpper
      ? urlFiltered.filter((e) => e.method.toUpperCase() === methodUpper)
      : urlFiltered;

    // v0.8.0: status filter ("2xx", "4xx", "5xx", or exact number string)
    const sfVal = opts.statusFilter;
    const statusFiltered = sfVal
      ? methodFiltered.filter((e) => matchesStatusFilter(e.status, sfVal))
      : methodFiltered;

    // v0.8.0: body filter — only entries that have a body captured
    const bodyFiltered = opts.withBody
      ? statusFiltered.filter((e) => e.body !== undefined)
      : statusFiltered;

    const entries =
      opts.last !== undefined ? bodyFiltered.slice(-opts.last) : bodyFiltered;

    return { requests: entries, pending: data.pendingRequests.size };
  }

  getObservation(targetId: string): Observation {
    const data = this.pages.get(targetId);
    if (!data) {
      return {
        console_errors: 0,
        console_warnings: 0,
        js_exceptions: 0,
        failed_requests: 0,
        pending_requests: 0,
      };
    }
    const consoleMsgs = data.consoleBuf.getAll();
    const networkEntries = data.networkBuf.getAll();
    return {
      console_errors: consoleMsgs.filter((m) => m.level === "error").length,
      console_warnings: consoleMsgs.filter((m) => m.level === "warning").length,
      js_exceptions: data.errorBuf.size,
      failed_requests: networkEntries.filter((e) => e.failed === true).length,
      pending_requests: data.pendingRequests.size,
    };
  }

  /** Returns true when listeners are currently attached to this tab. */
  isAttached(targetId: string): boolean {
    return this.attached.has(targetId);
  }

  clearBuffers(targetId: string, channel?: string): void {
    const data = this.pages.get(targetId);
    if (!data) return;
    if (!channel || channel === "console") data.consoleBuf.clear();
    if (!channel || channel === "errors") data.errorBuf.clear();
    if (!channel || channel === "network") data.networkBuf.clear();
  }
}

/** Daemon-wide singleton observer. Attached per tab on open, destroyed on close. */
export const globalObserver = new PageObserver();
