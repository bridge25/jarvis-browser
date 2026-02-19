// Unit tests for dialog-cmd.ts (v0.7.0)
// Tests dialog list/last/accept/dismiss handlers with mocked browser buffer

import { vi, describe, it, expect, beforeEach } from "vitest";

// --- Mocks ---

const pendingDialogs: Array<{ type: string; message: string; handled: boolean; timestamp: number }> = [];
const dialogBuffer: Array<{ type: string; message: string; handled: boolean; text?: string; timestamp: number }> = [];

vi.mock("../../src/browser.js", () => ({
  getPendingDialogs: vi.fn(() => pendingDialogs),
  getLastDialog: vi.fn(() => dialogBuffer[dialogBuffer.length - 1] ?? null),
  resolveOldestDialog: vi.fn().mockReturnValue(true),
  getDialogBuffer: vi.fn(() => dialogBuffer),
  getDialogMode: vi.fn().mockReturnValue("queue"),
}));

import {
  handleDialogList,
  handleDialogLast,
  handleDialogAccept,
  handleDialogDismiss,
} from "../../src/commands/dialog-cmd.js";

import { getPendingDialogs, getLastDialog, getDialogMode, resolveOldestDialog } from "../../src/browser.js";

beforeEach(() => {
  pendingDialogs.length = 0;
  dialogBuffer.length = 0;
  vi.mocked(getDialogMode).mockReturnValue("queue");
  vi.mocked(resolveOldestDialog).mockReturnValue(true);
});

// --- dialog list ---

describe("handleDialogList", () => {
  it("returns empty array when no pending dialogs", () => {
    const result = handleDialogList();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("returns pending dialog entries", () => {
    pendingDialogs.push({ type: "alert", message: "Are you sure?", handled: false, timestamp: Date.now() });
    const result = handleDialogList();
    expect(result.ok).toBe(true);
    expect((result.data as unknown[]).length).toBe(1);
    const first = (result.data as Array<{ type: string; message: string }>)[0];
    expect(first.type).toBe("alert");
    expect(first.message).toBe("Are you sure?");
  });

  it("includes dialog count in message", () => {
    pendingDialogs.push({ type: "confirm", message: "Delete?", handled: false, timestamp: Date.now() });
    pendingDialogs.push({ type: "alert", message: "Done", handled: false, timestamp: Date.now() });
    const result = handleDialogList();
    expect(result.message).toContain("2");
  });
});

// --- dialog last ---

describe("handleDialogLast", () => {
  it("returns error when no dialogs recorded", () => {
    vi.mocked(getLastDialog).mockReturnValue(null);
    const result = handleDialogLast();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns last dialog details", () => {
    const ts = Date.now();
    vi.mocked(getLastDialog).mockReturnValue({ type: "confirm", message: "Sure?", handled: true, text: undefined, timestamp: ts });
    const result = handleDialogLast();
    expect(result.ok).toBe(true);
    const data = result.data as { type: string; message: string; handled: boolean };
    expect(data.type).toBe("confirm");
    expect(data.message).toBe("Sure?");
    expect(data.handled).toBe(true);
  });
});

// --- dialog accept ---

describe("handleDialogAccept", () => {
  it("accepts oldest pending dialog in queue mode", () => {
    const result = handleDialogAccept({});
    expect(result.ok).toBe(true);
    expect(resolveOldestDialog).toHaveBeenCalledWith("accept", undefined);
  });

  it("passes prompt text to resolveOldestDialog", () => {
    handleDialogAccept({ text: "my input" });
    expect(resolveOldestDialog).toHaveBeenCalledWith("accept", "my input");
  });

  it("returns error when no pending dialogs to accept", () => {
    vi.mocked(resolveOldestDialog).mockReturnValue(false);
    const result = handleDialogAccept({});
    expect(result.ok).toBe(false);
  });

  it("returns error when not in queue mode", () => {
    vi.mocked(getDialogMode).mockReturnValue("accept");
    const result = handleDialogAccept({});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("queue mode");
  });
});

// --- dialog dismiss ---

describe("handleDialogDismiss", () => {
  it("dismisses oldest pending dialog in queue mode", () => {
    const result = handleDialogDismiss();
    expect(result.ok).toBe(true);
    expect(resolveOldestDialog).toHaveBeenCalledWith("dismiss");
  });

  it("returns error when no pending dialogs to dismiss", () => {
    vi.mocked(resolveOldestDialog).mockReturnValue(false);
    const result = handleDialogDismiss();
    expect(result.ok).toBe(false);
  });

  it("returns error when not in queue mode", () => {
    vi.mocked(getDialogMode).mockReturnValue("dismiss");
    const result = handleDialogDismiss();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("queue mode");
  });
});
