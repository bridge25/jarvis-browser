// dialog-cmd.ts — Dialog management commands (v0.7.0)
// Addresses FM-1: Dialog Blocking
//
// Architecture: daemon registers page.on('dialog') on every page.
// Mode (accept|dismiss|queue) determines auto-handling.
// queue mode: dialogs stored in ring buffer, agent resolves manually.

import {
  getDialogBuffer,
  getPendingDialogs,
  getLastDialog,
  resolveOldestDialog,
  getDialogMode,
} from "../browser.js";
import type { ActionResult } from "../types.js";

// --- dialog list ---

export function handleDialogList(): ActionResult {
  const pending = getPendingDialogs();
  return {
    ok: true,
    data: pending.map(({ type, message, handled, timestamp }) => ({
      type,
      message,
      handled,
      timestamp,
    })),
    message: `${pending.length} pending dialog(s)`,
  };
}

// --- dialog last ---

export function handleDialogLast(): ActionResult {
  const last = getLastDialog();
  if (!last) {
    return { ok: false, error: "No dialogs recorded yet", suggestion: "Trigger a page action that shows a dialog" };
  }
  const { type, message, handled, text, timestamp } = last;
  return { ok: true, data: { type, message, handled, text, timestamp } };
}

// --- dialog accept ---

export function handleDialogAccept(params: { text?: string }): ActionResult {
  const mode = getDialogMode();
  if (mode !== "queue") {
    return {
      ok: false,
      error: `dialog accept only works in queue mode (current: ${mode})`,
      suggestion: 'Run: jarvis-browser config set dialog-mode queue',
    };
  }
  const resolved = resolveOldestDialog("accept", params.text);
  if (!resolved) {
    return { ok: false, error: "No pending dialogs to accept", suggestion: "Run: jarvis-browser dialog list" };
  }
  return { ok: true, message: "Accepted oldest pending dialog" };
}

// --- dialog dismiss ---

export function handleDialogDismiss(): ActionResult {
  const mode = getDialogMode();
  if (mode !== "queue") {
    return {
      ok: false,
      error: `dialog dismiss only works in queue mode (current: ${mode})`,
      suggestion: 'Run: jarvis-browser config set dialog-mode queue',
    };
  }
  const resolved = resolveOldestDialog("dismiss");
  if (!resolved) {
    return { ok: false, error: "No pending dialogs to dismiss", suggestion: "Run: jarvis-browser dialog list" };
  }
  return { ok: true, message: "Dismissed oldest pending dialog" };
}

// --- dialog status (for recovery chain) ---

export function hasUnhandledDialog(): boolean {
  return getPendingDialogs().length > 0;
}

export function getDialogHistory(): readonly ReturnType<typeof getDialogBuffer>[number][] {
  return getDialogBuffer();
}
