// Unit tests for state-cmd.ts (v0.7.0)
// Tests is.visible/hidden/enabled/checked/editable + wait-for-state handlers

import { vi, describe, it, expect, beforeEach } from "vitest";

// --- Mocks ---
// vi.mock is hoisted above variable declarations, so use vi.hoisted() for shared mock objects

const { mockLocator } = vi.hoisted(() => {
  const mockLocator = {
    isVisible: vi.fn().mockResolvedValue(true),
    isHidden: vi.fn().mockResolvedValue(false),
    isEnabled: vi.fn().mockResolvedValue(true),
    isChecked: vi.fn().mockResolvedValue(false),
    isEditable: vi.fn().mockResolvedValue(true),
    waitFor: vi.fn().mockResolvedValue(undefined),
  };
  return { mockLocator };
});

vi.mock("../../src/browser.js", () => ({
  getPage: vi.fn().mockResolvedValue({}),
  refLocator: vi.fn().mockReturnValue(mockLocator),
  getStoredRefs: vi.fn().mockReturnValue({}),
}));

import {
  handleIsVisible,
  handleIsHidden,
  handleIsEnabled,
  handleIsChecked,
  handleIsEditable,
  handleWaitVisible,
  handleWaitHidden,
  handleWaitEnabled,
  handleWaitChecked,
} from "../../src/commands/state-cmd.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockLocator.isVisible.mockResolvedValue(true);
  mockLocator.isHidden.mockResolvedValue(false);
  mockLocator.isEnabled.mockResolvedValue(true);
  mockLocator.isChecked.mockResolvedValue(false);
  mockLocator.isEditable.mockResolvedValue(true);
  mockLocator.waitFor.mockResolvedValue(undefined);
});

// --- Point-in-time state checks ---

describe("handleIsVisible", () => {
  it("returns true when element is visible", async () => {
    mockLocator.isVisible.mockResolvedValue(true);
    const result = await handleIsVisible({ ref: "e1" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(true);
  });

  it("returns false when element is not visible", async () => {
    mockLocator.isVisible.mockResolvedValue(false);
    const result = await handleIsVisible({ ref: "e1" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(false);
  });
});

describe("handleIsHidden", () => {
  it("returns true when element is hidden", async () => {
    mockLocator.isHidden.mockResolvedValue(true);
    const result = await handleIsHidden({ ref: "e2" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(true);
  });
});

describe("handleIsEnabled", () => {
  it("returns enabled state", async () => {
    const result = await handleIsEnabled({ ref: "e3" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(true);
  });

  it("returns false for disabled element", async () => {
    mockLocator.isEnabled.mockResolvedValue(false);
    const result = await handleIsEnabled({ ref: "e3" });
    expect(result.data).toBe(false);
  });
});

describe("handleIsChecked", () => {
  it("returns checked state (false by default)", async () => {
    const result = await handleIsChecked({ ref: "e4" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(false);
  });

  it("returns true when checked", async () => {
    mockLocator.isChecked.mockResolvedValue(true);
    const result = await handleIsChecked({ ref: "e4" });
    expect(result.data).toBe(true);
  });
});

describe("handleIsEditable", () => {
  it("returns editable state", async () => {
    const result = await handleIsEditable({ ref: "e5" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(true);
  });
});

// --- Wait-for-state handlers ---

describe("handleWaitVisible", () => {
  it("resolves ok when element becomes visible", async () => {
    mockLocator.waitFor.mockResolvedValue(undefined);
    const result = await handleWaitVisible({ ref: "e1", timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(mockLocator.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1000 });
  });

  it("returns error on timeout", async () => {
    mockLocator.waitFor.mockRejectedValue(new Error("Timeout"));
    const result = await handleWaitVisible({ ref: "e1", timeoutMs: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("e1");
    expect(result.suggestion).toBeDefined();
  });
});

describe("handleWaitHidden", () => {
  it("resolves ok when element becomes hidden", async () => {
    const result = await handleWaitHidden({ ref: "e1" });
    expect(result.ok).toBe(true);
    expect(mockLocator.waitFor).toHaveBeenCalledWith({ state: "hidden", timeout: 10000 });
  });
});

describe("handleWaitEnabled", () => {
  it("resolves ok when element is enabled (poll-based)", async () => {
    mockLocator.isEnabled.mockResolvedValue(true);
    const result = await handleWaitEnabled({ ref: "e3", timeoutMs: 500 });
    expect(result.ok).toBe(true);
  });

  it("returns error when element never becomes enabled", async () => {
    mockLocator.isEnabled.mockResolvedValue(false);
    const result = await handleWaitEnabled({ ref: "e3", timeoutMs: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("e3");
  });
});

describe("handleWaitChecked", () => {
  it("resolves ok when element is checked (poll-based)", async () => {
    mockLocator.isChecked.mockResolvedValue(true);
    const result = await handleWaitChecked({ ref: "e4", timeoutMs: 500 });
    expect(result.ok).toBe(true);
  });

  it("returns error when element never becomes checked", async () => {
    mockLocator.isChecked.mockResolvedValue(false);
    const result = await handleWaitChecked({ ref: "e4", timeoutMs: 100 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("e4");
  });
});
