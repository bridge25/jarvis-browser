// Observer command handlers: console, errors, requests, observe, page-info
// These commands require the daemon (observer buffers are populated per-tab).
// v0.9.0 FM-10: observe --export <path> [--format har|json]

import { getPage, getPendingDialogs } from "../browser.js";
import { globalObserver } from "../observer.js";
import { ERROR_CODES } from "../protocol.js";
import { exportToHar, exportToJson } from "../har-export.js";

// --- console ---

export async function handleConsole(params: {
  targetId?: string;
  level?: string;
  last?: number;
  clear?: boolean;
}): Promise<object> {
  const tid = params.targetId ?? "";
  const { messages, total } = globalObserver.getConsole(tid, {
    level: params.level,
    last: params.last,
    clear: params.clear,
  });
  return {
    ok: true,
    messages,
    total,
    filtered: messages.length,
  };
}

// --- errors ---

export async function handleErrors(params: {
  targetId?: string;
  last?: number;
}): Promise<object> {
  const tid = params.targetId ?? "";
  const errors = globalObserver.getErrors(tid, { last: params.last });
  return {
    ok: true,
    errors,
    count: errors.length,
  };
}

// --- requests ---

export async function handleRequests(params: {
  targetId?: string;
  filter?: string;
  urlPattern?: string;
  last?: number;
  /** HTTP method filter e.g. "GET", "POST" */
  method?: string;
  /** Status band filter: "2xx" | "4xx" | "5xx" | exact code string */
  statusFilter?: string;
  /** Only return entries where body was captured */
  withBody?: boolean;
}): Promise<object> {
  const tid = params.targetId ?? "";
  // Filtered view for the requests array
  const { requests, pending } = globalObserver.getRequests(tid, {
    filter: params.filter,
    urlPattern: params.urlPattern,
    last: params.last,
    method: params.method,
    statusFilter: params.statusFilter,
    withBody: params.withBody,
  });
  // Unfiltered view for accurate summary totals
  const { requests: allEntries } = globalObserver.getRequests(tid, {});
  return {
    ok: true,
    requests,
    summary: {
      total: allEntries.length,
      failed: allEntries.filter((e) => e.failed === true).length,
      pending,
    },
  };
}

// --- observe ---

export async function handleObserve(params: {
  targetId?: string;
  include?: string;
  /** Path to export file (triggers export mode) */
  export?: string;
  /** Export format: "json" | "har" (default: "json") */
  format?: string;
}): Promise<object> {
  const tid = params.targetId;
  const page = await getPage(tid);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }

  const title = await page.title();
  const url = page.url();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  const health = globalObserver.getObservation(tid ?? "");

  // Performance via Navigation Timing API
  let performance: Record<string, number> = {};
  try {
    performance = await page.evaluate(() => {
      const entries = window.performance.getEntriesByType(
        "navigation",
      ) as PerformanceNavigationTiming[];
      const nav = entries[0];
      if (!nav) return {} as Record<string, number>;
      return {
        dom_content_loaded_ms: Math.round(
          nav.domContentLoadedEventEnd - nav.startTime,
        ),
        load_ms: Math.round(nav.loadEventEnd - nav.startTime),
        dom_nodes: document.querySelectorAll("*").length,
      };
    });
  } catch {
    // Page may not have navigation timing (e.g., about:blank)
  }

  const snapshotAge = globalObserver.getSnapshotAge(tid ?? "");

  const response = {
    ok: true,
    page: { title, url, viewport },
    health,
    performance,
    snapshot_stale: snapshotAge?.stale ?? null,
    last_snapshot_age_s: snapshotAge?.age_s ?? null,
  };

  // Export mode: write to file and return short confirmation
  if (params.export) {
    const format = params.format ?? "json";
    if (format === "har") {
      const { requests } = globalObserver.getRequests(tid ?? "", {});
      await exportToHar(requests, params.export);
      return { ok: true, path: params.export, format: "har", entries: requests.length };
    }
    await exportToJson(response, params.export);
    return { ok: true, path: params.export, format: "json" };
  }

  return response;
}

// --- page-info ---

export async function handlePageInfo(params: {
  targetId?: string;
}): Promise<object> {
  const tid = params.targetId;
  const page = await getPage(tid);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }

  const title = await page.title();
  const url = page.url();

  const cookies = await page.context().cookies();

  const { localStorage_keys, sessionStorage_keys, readyState } = await page
    .evaluate(() => ({
      localStorage_keys: Object.keys(localStorage).length,
      sessionStorage_keys: Object.keys(sessionStorage).length,
      readyState: document.readyState,
    }))
    .catch(() => ({ localStorage_keys: 0, sessionStorage_keys: 0, readyState: "unknown" }));

  const devicePixelRatio = await page
    .evaluate(() => window.devicePixelRatio)
    .catch(() => 1);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const dialogs_pending = getPendingDialogs().length;
  const observers_active = globalObserver.isAttached(tid ?? "");

  return {
    ok: true,
    data: {
      title,
      url,
      viewport,
      devicePixelRatio,
      readyState,
      cookies: cookies.length,
      localStorage: localStorage_keys,
      sessionStorage: sessionStorage_keys,
      dialogs_pending,
      observers_active,
    },
  };
}

