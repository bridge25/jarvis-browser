// retry.ts — Auto-retry with recovery chain for stale/non-interactable elements
// v0.7.0: +dialog_blocking, +navigation_changed (3→5 error types)
// v0.8.0: +overlay_interference (6 types)
// v0.9.0: +captcha_detected (7 types) + retry statistics

import type { Page } from "playwright-core";
import { takeSnapshot } from "./browser.js";
import { globalObserver } from "./observer.js";
import type { RoleRef, RoleRefMap } from "./types.js";
import { recordRetryAttempt, recordRetryOutcome } from "./stats.js";

// --- Error classification ---

export type ErrorClass =
  | "stale_ref"
  | "not_interactable"
  | "strict_mode"
  | "dialog_blocking"       // v0.7.0
  | "navigation_changed"    // v0.7.0
  | "overlay_interference"  // v0.8.0
  | "captcha_detected"      // v0.9.0
  | "unknown";

export interface ErrorContext {
  hasUnhandledDialog?: boolean;
  preActionUrl?: string;
  currentUrl?: string;
  /** Count of consecutive not_interactable recoveries (used for overlay detection) */
  notInteractableCount?: number;
}

export function classifyError(message: string, ctx?: ErrorContext): ErrorClass {
  // Stale ref: element is gone or ref cache is outdated
  if (
    message.includes("Unknown ref") ||
    message.includes("not found or not visible") ||
    message.includes("Run a new snapshot")
  ) {
    // navigation_changed takes priority: stale ref due to URL change
    if (ctx?.preActionUrl && ctx.currentUrl && ctx.preActionUrl !== ctx.currentUrl) {
      return "navigation_changed";
    }
    return "stale_ref";
  }

  // Strict mode: selector matched multiple elements
  if (message.includes("matched") && message.includes("elements")) {
    return "strict_mode";
  }

  // Not interactable: element hidden, covered, or blocked
  if (
    message.includes("not interactable") ||
    message.includes("hidden or covered") ||
    message.includes("intercepts pointer events") ||
    message.includes("not receive pointer events")
  ) {
    return "not_interactable";
  }

  // dialog_blocking: timeout + pending dialog in buffer
  if (
    (message.includes("Timeout") || message.includes("timeout") || message.includes("timed out")) &&
    ctx?.hasUnhandledDialog
  ) {
    return "dialog_blocking";
  }

  // overlay_interference: not_interactable persists after 2+ recovery attempts
  // (caller tracks notInteractableCount and passes it via ctx)
  if (
    (message.includes("not interactable") ||
     message.includes("hidden or covered") ||
     message.includes("intercepts pointer events") ||
     message.includes("not receive pointer events")) &&
    (ctx?.notInteractableCount ?? 0) >= 2
  ) {
    return "overlay_interference";
  }

  // captcha_detected: CAPTCHA / bot-detection challenge (v0.9.0)
  if (
    message.toLowerCase().includes("captcha") ||
    message.includes("I'm not a robot") ||
    message.includes("Cloudflare") ||
    message.toLowerCase().includes("human verification") ||
    message.toLowerCase().includes("bot detection")
  ) {
    return "captcha_detected";
  }

  return "unknown";
}

// --- Rich error type ---

export interface RichActionError extends Error {
  context: {
    ref?: string;
    attempts: number;
    retry_log: string[];
    console_errors: string[];
    suggestion: string;
  };
}

function buildSuggestion(errorClass: ErrorClass, attempts: number): string {
  switch (errorClass) {
    case "stale_ref":
      return `Element ref became stale after ${attempts} attempt(s). Run a new snapshot and retry.`;
    case "not_interactable":
      return `Element not interactable after ${attempts} attempt(s). Check if element is visible and not overlapped.`;
    case "strict_mode":
      return `Ref matched multiple elements after ${attempts} attempt(s). Run a new snapshot to get a unique ref.`;
    case "dialog_blocking":
      return `Action timed out due to a blocking dialog. Run "dialog list" to see pending dialogs, or set dialog-mode to accept.`;
    case "navigation_changed":
      return `Page navigated during action after ${attempts} attempt(s). Run a new snapshot from the new page context.`;
    case "overlay_interference":
      return `Element blocked by an overlay (modal, cookie banner, or dialog) after ${attempts} attempt(s). An auto-dismiss was attempted. Run snapshot to verify overlay is gone.`;
    case "captcha_detected":
      return "Manual intervention required — solve the CAPTCHA in the browser and retry.";
    default:
      return `Action failed after ${attempts} attempt(s).`;
  }
}

function makeRichError(
  message: string,
  context: RichActionError["context"],
): RichActionError {
  const err = new Error(message) as RichActionError;
  err.context = context;
  return err;
}

// --- Recovery strategies ---

export async function attemptRecovery(
  page: Page,
  targetId: string | undefined,
  errorClass: ErrorClass,
  recoveries: string[],
): Promise<void> {
  switch (errorClass) {
    case "stale_ref":
      // Resnap to refresh the ref cache
      await takeSnapshot({ targetId, mode: "role", options: { compact: true }, maxChars: 50000 });
      recoveries.push("resnap");
      break;

    case "strict_mode":
      // Resnap without compact to get nth-disambiguated refs
      await takeSnapshot({ targetId, mode: "role", options: { compact: false }, maxChars: 50000 });
      recoveries.push("resnap-nth");
      break;

    case "not_interactable":
      // Scroll down to reveal element + press Escape to dismiss overlays
      await page.mouse.wheel(0, 200).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      recoveries.push("scroll-dismiss");
      break;

    case "dialog_blocking": {
      // Temporarily accept the pending dialog, then resnap
      const { resolveOldestDialog, setDialogMode, getDialogMode } = await import("./browser.js");
      const prevMode = getDialogMode();
      if (prevMode === "queue") {
        // Temporarily switch to accept and resolve oldest
        setDialogMode("accept");
        resolveOldestDialog("accept");
        setDialogMode(prevMode);
      } else {
        resolveOldestDialog("accept");
      }
      await takeSnapshot({ targetId, mode: "role", options: { compact: true }, maxChars: 50000 });
      recoveries.push("dialog-accepted");
      break;
    }

    case "navigation_changed":
      // Re-snapshot from new page context after navigation
      await takeSnapshot({ targetId, mode: "role", options: { compact: true }, maxChars: 50000 });
      recoveries.push("resnap-new-page");
      break;

    case "overlay_interference": {
      // Scan for common overlay selectors and try to dismiss them
      const overlaySelectors = [
        "[role=dialog]",
        ".modal",
        ".cookie-banner",
        "[aria-modal=true]",
      ];
      const dismissed = await (async () => {
        for (const sel of overlaySelectors) {
          try {
            const overlay = page.locator(sel).first();
            const isVisible = await overlay.isVisible({ timeout: 500 }).catch(() => false);
            if (!isVisible) continue;
            // Try close/dismiss buttons within the overlay
            const closeBtn = overlay.locator(
              "button[aria-label*='close' i], button[aria-label*='dismiss' i], button[aria-label*='accept' i], [data-dismiss], .close, .btn-close"
            ).first();
            const closeBtnVisible = await closeBtn.isVisible({ timeout: 300 }).catch(() => false);
            if (closeBtnVisible) {
              await closeBtn.click({ timeout: 2000 });
              return true;
            }
            // Fallback: press Escape
            await page.keyboard.press("Escape");
            return true;
          } catch {
            // Continue to next selector
          }
        }
        return false;
      })();
      if (!dismissed) {
        // Last resort: scroll + Escape
        await page.mouse.wheel(0, -300).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
      }
      await takeSnapshot({ targetId, mode: "role", options: { compact: true }, maxChars: 50000 });
      recoveries.push("overlay-dismissed");
      break;
    }

    default:
      // No recovery strategy for unknown errors
      break;
  }
}

// --- Ref re-matching after resnap ---

export function findMatchingRef(
  refs: RoleRefMap,
  oldRole: string,
  oldName?: string,
): string | null {
  // Exact match: same role + same name
  for (const [key, rr] of Object.entries(refs)) {
    if (rr.role === oldRole && rr.name === oldName) {
      return key;
    }
  }

  // Fuzzy match: same role, name contains or is contained in oldName
  if (oldName) {
    for (const [key, rr] of Object.entries(refs)) {
      if (rr.role === oldRole && rr.name) {
        if (rr.name.includes(oldName) || oldName.includes(rr.name)) {
          return key;
        }
      }
    }
  }

  // Role-only fallback (only if unique match)
  if (oldRole) {
    const roleMatches = Object.entries(refs).filter(([, rr]) => rr.role === oldRole);
    if (roleMatches.length === 1) {
      return roleMatches[0][0];
    }
  }

  return null;
}

// --- Core retry wrapper ---

export interface RetryOptions {
  /** Playwright Page object for recovery actions (scroll, dismiss, resnap) */
  page?: Page;
  /** Tab identifier for resnap recovery */
  targetId?: string;
  /** Element ref string for error context */
  ref?: string;
  /** Number of retries after first failure (total attempts = maxRetries + 1) */
  maxRetries: number;
  /** Milliseconds to wait between retry attempts */
  delayMs: number;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  recoveries: string[];
}

export async function withRetry<T>(
  action: () => Promise<T>,
  opts: RetryOptions,
): Promise<RetryResult<T>> {
  const recoveries: string[] = [];
  const maxAttempts = opts.maxRetries + 1;
  let lastError: Error = new Error("Action failed");

  // Capture pre-action URL for navigation_changed detection
  const preActionUrl = opts.page ? opts.page.url() : undefined;

  // v0.8.0: track consecutive not_interactable failures for overlay detection
  let notInteractableCount = 0;
  // v0.9.0: track whether any recovery was attempted for stats
  let retryAttempted = false;

  for (const attempt of Array.from({ length: maxAttempts }, (_, k) => k + 1)) {
    try {
      const result = await action();
      if (retryAttempted) recordRetryOutcome(true);
      return { result, attempts: attempt, recoveries };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Build context for error classification
      const { getPendingDialogs } = await import("./browser.js").catch(() => ({ getPendingDialogs: () => [] as unknown[] }));
      const ctx: ErrorContext = {
        hasUnhandledDialog: getPendingDialogs().length > 0,
        preActionUrl,
        currentUrl: opts.page ? opts.page.url() : undefined,
        notInteractableCount,
      };

      const errorClass = classifyError(lastError.message, ctx);

      // Update not_interactable counter for overlay detection
      if (errorClass === "not_interactable" || errorClass === "overlay_interference") {
        notInteractableCount++;
      } else {
        notInteractableCount = 0;
      }

      // Fail fast: unknown error type or CAPTCHA (no automated recovery possible)
      if (errorClass === "unknown" || errorClass === "captcha_detected") {
        throw lastError;
      }

      // Fail fast: no page available to perform recovery
      if (!opts.page) {
        throw lastError;
      }

      // Last attempt exhausted — break out to throw RichActionError
      if (attempt >= maxAttempts) {
        break;
      }

      // Record retry attempt stats (v0.9.0)
      recordRetryAttempt(errorClass);
      retryAttempted = true;

      // Attempt recovery before next retry
      await attemptRecovery(opts.page, opts.targetId, errorClass, recoveries);

      // Delay before retrying
      if (opts.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }
  }

  // All attempts exhausted — wrap in RichActionError
  if (retryAttempted) recordRetryOutcome(false);
  const { getPendingDialogs } = await import("./browser.js").catch(() => ({ getPendingDialogs: () => [] as unknown[] }));
  const finalCtx: ErrorContext = {
    hasUnhandledDialog: getPendingDialogs().length > 0,
    preActionUrl,
    currentUrl: opts.page ? opts.page.url() : undefined,
  };
  const finalClass = classifyError(lastError.message, finalCtx);
  const consoleErrors = globalObserver
    .getConsole(opts.targetId ?? "", { level: "error" })
    .messages.map((e) => e.text);
  throw makeRichError(lastError.message, {
    ref: opts.ref,
    attempts: maxAttempts,
    retry_log: recoveries,
    console_errors: consoleErrors,
    suggestion: buildSuggestion(finalClass, maxAttempts),
  });
}
