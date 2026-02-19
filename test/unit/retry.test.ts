// Unit tests for retry.ts
// Tests pure functions (classifyError, findMatchingRef) and withRetry loop logic

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock browser.js — takeSnapshot is called by attemptRecovery during stale_ref / strict_mode recovery
// getPendingDialogs is called by withRetry (v0.7.0) for dialog_blocking error classification
vi.mock("../../src/browser.js", () => ({
  takeSnapshot: vi.fn().mockResolvedValue({ snapshot: "", stats: {}, refs: {} }),
  getPendingDialogs: vi.fn().mockReturnValue([]),
}));

import { classifyError, findMatchingRef, withRetry, type RetryOptions } from "../../src/retry.js";
import type { RoleRefMap } from "../../src/types.js";

// --- classifyError ---

describe("classifyError", () => {
  it("classifies stale ref errors", () => {
    expect(classifyError("Unknown ref e5")).toBe("stale_ref");
    expect(classifyError("Element not found or not visible after 5000ms")).toBe("stale_ref");
    expect(classifyError("Run a new snapshot to get updated refs")).toBe("stale_ref");
  });

  it("classifies strict mode (multiple match) errors", () => {
    expect(classifyError("Locator matched 3 elements")).toBe("strict_mode");
    expect(classifyError("matched 2 elements — use nth()")).toBe("strict_mode");
  });

  it("classifies not_interactable errors", () => {
    expect(classifyError("Element is not interactable")).toBe("not_interactable");
    expect(classifyError("Element is hidden or covered")).toBe("not_interactable");
    expect(classifyError("Another element intercepts pointer events")).toBe("not_interactable");
    expect(classifyError("Element does not receive pointer events")).toBe("not_interactable");
  });

  it("classifies unknown errors as unknown", () => {
    expect(classifyError("Timeout exceeded 10000ms")).toBe("unknown");
    expect(classifyError("Network request failed")).toBe("unknown");
    expect(classifyError("Page crashed")).toBe("unknown");
    expect(classifyError("")).toBe("unknown");
  });
});

// --- findMatchingRef ---

describe("findMatchingRef", () => {
  const refs: RoleRefMap = {
    e1: { role: "button", name: "Submit" },
    e2: { role: "button", name: "Cancel" },
    e3: { role: "textbox", name: "Email address" },
    e4: { role: "link", name: "Home" },
    e5: { role: "checkbox", name: "Accept terms" },
  };

  it("finds exact role + name match", () => {
    expect(findMatchingRef(refs, "button", "Submit")).toBe("e1");
    expect(findMatchingRef(refs, "button", "Cancel")).toBe("e2");
  });

  it("finds fuzzy name match (name contains)", () => {
    // "Email" is contained in "Email address"
    expect(findMatchingRef(refs, "textbox", "Email")).toBe("e3");
  });

  it("finds fuzzy name match (oldName contains ref name)", () => {
    // "Submit button" contains "Submit"
    expect(findMatchingRef(refs, "button", "Submit button")).toBe("e1");
  });

  it("finds unique role-only match when no name provided", () => {
    // Only one link, one textbox, one checkbox
    expect(findMatchingRef(refs, "link")).toBe("e4");
    expect(findMatchingRef(refs, "textbox")).toBe("e3");
    expect(findMatchingRef(refs, "checkbox")).toBe("e5");
  });

  it("returns null for ambiguous role-only (multiple buttons)", () => {
    // Two buttons → can't pick one
    expect(findMatchingRef(refs, "button")).toBeNull();
  });

  it("returns null when no match at all", () => {
    expect(findMatchingRef(refs, "combobox", "Language")).toBeNull();
    expect(findMatchingRef(refs, "radio", "Option A")).toBeNull();
  });
});

// --- withRetry ---

describe("withRetry", () => {
  const mockPage = {
    url: vi.fn().mockReturnValue("https://example.com"),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns result on first success (no retries needed)", async () => {
    const action = vi.fn().mockResolvedValue("done");
    const opts: RetryOptions = { page: mockPage as never, maxRetries: 2, delayMs: 0 };
    const r = await withRetry(action, opts);
    expect(r.result).toBe("done");
    expect(r.attempts).toBe(1);
    expect(r.recoveries).toHaveLength(0);
    expect(action).toHaveBeenCalledOnce();
  });

  it("retries on stale_ref error and succeeds on second attempt", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unknown ref e7"))
      .mockResolvedValueOnce("recovered");
    const opts: RetryOptions = { page: mockPage as never, maxRetries: 2, delayMs: 0 };
    const r = await withRetry(action, opts);
    expect(r.result).toBe("recovered");
    expect(r.attempts).toBe(2);
    expect(r.recoveries).toContain("resnap");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("retries on not_interactable and performs scroll-dismiss recovery", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("Element is not interactable"))
      .mockResolvedValueOnce("ok");
    const opts: RetryOptions = { page: mockPage as never, maxRetries: 1, delayMs: 0 };
    const r = await withRetry(action, opts);
    expect(r.result).toBe("ok");
    expect(r.recoveries).toContain("scroll-dismiss");
    expect(mockPage.mouse.wheel).toHaveBeenCalled();
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Escape");
  });

  it("performs resnap-nth recovery for strict_mode error", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("Locator matched 3 elements"))
      .mockResolvedValueOnce("ok");
    const opts: RetryOptions = { page: mockPage as never, maxRetries: 1, delayMs: 0 };
    const r = await withRetry(action, opts);
    expect(r.recoveries).toContain("resnap-nth");
  });

  it("fails fast on unknown error type (no retries)", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Navigation timeout exceeded"));
    const opts: RetryOptions = { page: mockPage as never, maxRetries: 3, delayMs: 0 };
    await expect(withRetry(action, opts)).rejects.toThrow("Navigation timeout exceeded");
    expect(action).toHaveBeenCalledOnce(); // no retries for unknown errors
  });

  it("fails fast when page=undefined (no recovery possible)", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Unknown ref e5"));
    const opts: RetryOptions = { maxRetries: 2, delayMs: 0 };
    await expect(withRetry(action, opts)).rejects.toThrow("Unknown ref e5");
    expect(action).toHaveBeenCalledOnce();
  });

  it("throws RichActionError with context after exhausting retries", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Unknown ref e1"));
    const opts: RetryOptions = { page: mockPage as never, ref: "e1", maxRetries: 2, delayMs: 0 };
    const err = await withRetry(action, opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const rich = err as { context: { ref: string; attempts: number; retry_log: string[]; console_errors: string[]; suggestion: string } };
    expect(rich.context).toBeDefined();
    expect(rich.context.ref).toBe("e1");
    expect(rich.context.attempts).toBe(3); // maxRetries(2) + 1
    expect(rich.context.retry_log).toHaveLength(2); // two resnap attempts
    expect(rich.context.console_errors).toEqual([]); // no Chrome attached in unit tests
    expect(rich.context.suggestion).toContain("snapshot");
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("maxRetries=0 means exactly one attempt (no retry)", async () => {
    const action = vi.fn().mockRejectedValue(new Error("Unknown ref e1"));
    const opts: RetryOptions = { page: mockPage as never, maxRetries: 0, delayMs: 0 };
    await expect(withRetry(action, opts)).rejects.toThrow();
    expect(action).toHaveBeenCalledOnce();
  });
});
