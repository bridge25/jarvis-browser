// Unit tests for retry.ts v0.7.0 additions:
// dialog_blocking + navigation_changed error classification + recovery

import { vi, describe, it, expect } from "vitest";

vi.mock("../../src/browser.js", () => ({
  takeSnapshot: vi.fn().mockResolvedValue({ snapshot: "", stats: {}, refs: {} }),
  getPendingDialogs: vi.fn().mockReturnValue([]),
  resolveOldestDialog: vi.fn(),
  getDialogMode: vi.fn().mockReturnValue("accept"),
  setDialogMode: vi.fn(),
}));

import { classifyError, withRetry, type RetryOptions } from "../../src/retry.js";
import type { ErrorContext } from "../../src/retry.js";

// --- classifyError with ErrorContext ---

describe("classifyError — v0.7.0 new error types", () => {
  it("classifies dialog_blocking when timeout + pending dialog", () => {
    const ctx: ErrorContext = { hasUnhandledDialog: true };
    expect(classifyError("Timeout waiting for element", ctx)).toBe("dialog_blocking");
    expect(classifyError("timed out after 10000ms", ctx)).toBe("dialog_blocking");
  });

  it("does NOT classify as dialog_blocking when no pending dialog", () => {
    const ctx: ErrorContext = { hasUnhandledDialog: false };
    // timeout without dialog → unknown
    expect(classifyError("Timeout waiting for element", ctx)).toBe("unknown");
  });

  it("classifies navigation_changed over stale_ref when URL changes", () => {
    const ctx: ErrorContext = {
      preActionUrl: "https://example.com/login",
      currentUrl: "https://example.com/dashboard",
    };
    expect(classifyError("Unknown ref e5", ctx)).toBe("navigation_changed");
    expect(classifyError("Run a new snapshot", ctx)).toBe("navigation_changed");
  });

  it("classifies stale_ref when same URL (no navigation)", () => {
    const ctx: ErrorContext = {
      preActionUrl: "https://example.com/page",
      currentUrl: "https://example.com/page",
    };
    expect(classifyError("Unknown ref e5", ctx)).toBe("stale_ref");
  });

  it("backward compat: no context still classifies known errors", () => {
    expect(classifyError("Unknown ref e5")).toBe("stale_ref");
    expect(classifyError("Element is not interactable")).toBe("not_interactable");
    expect(classifyError("matched 3 elements")).toBe("strict_mode");
  });

  it("dialog_blocking requires timeout keyword in message", () => {
    const ctx: ErrorContext = { hasUnhandledDialog: true };
    // non-timeout error + dialog → should NOT be dialog_blocking
    expect(classifyError("Element is not interactable", ctx)).toBe("not_interactable");
  });
});

// --- withRetry: fail-fast on unknown errors ---

describe("withRetry — fail-fast on unknown error type", () => {
  it("throws immediately on unknown error without retrying", async () => {
    let callCount = 0;
    const action = async () => {
      callCount++;
      throw new Error("Network request failed");
    };
    const opts: RetryOptions = { maxRetries: 3, delayMs: 0 };
    await expect(withRetry(action, opts)).rejects.toThrow("Network request failed");
    expect(callCount).toBe(1); // only 1 attempt, no retries
  });
});

// --- withRetry: retries on known error types ---

// Minimal page mock — url() needed for preActionUrl capture in v0.7.0
const mockPageForRetry = {
  url: vi.fn().mockReturnValue("https://example.com"),
  mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
  keyboard: { press: vi.fn().mockResolvedValue(undefined) },
};

describe("withRetry — retries on stale_ref", () => {
  it("retries up to maxRetries + 1 attempts on stale_ref", async () => {
    let callCount = 0;
    const action = async () => {
      callCount++;
      throw new Error("Unknown ref e5 — Run a new snapshot");
    };
    const opts: RetryOptions = { page: mockPageForRetry as never, maxRetries: 2, delayMs: 0 };
    await expect(withRetry(action, opts)).rejects.toMatchObject({
      context: { attempts: 3 },
    });
    expect(callCount).toBe(3); // 1 initial + 2 retries
  });

  it("resolves immediately when action succeeds on retry", async () => {
    let callCount = 0;
    const action = async () => {
      callCount++;
      if (callCount < 2) throw new Error("Unknown ref e5 — Run a new snapshot");
      return "ok";
    };
    const opts: RetryOptions = { page: mockPageForRetry as never, maxRetries: 3, delayMs: 0 };
    const { result, attempts } = await withRetry(action, opts);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});
