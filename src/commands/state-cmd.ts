// state-cmd.ts — Element state check commands (v0.7.0)
// is visible/enabled/checked/editable/hidden
// wait --visible/--enabled/--hidden/--checked

import { getPage, refLocator, getStoredRefs } from "../browser.js";
import type { ActionResult } from "../types.js";

// --- Helper: ref → locator ---

async function getLocator(ref: string, targetId?: string) {
  const page = await getPage(targetId);
  const state = getStoredRefs(targetId ?? "default");
  return { page, locator: refLocator(page, ref, state) };
}

// --- Point-in-time state checks ---

export async function handleIsVisible(params: { ref: string; targetId?: string }): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const visible = await locator.isVisible();
  return { ok: true, data: visible };
}

export async function handleIsHidden(params: { ref: string; targetId?: string }): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const hidden = await locator.isHidden();
  return { ok: true, data: hidden };
}

export async function handleIsEnabled(params: { ref: string; targetId?: string }): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const enabled = await locator.isEnabled();
  return { ok: true, data: enabled };
}

export async function handleIsChecked(params: { ref: string; targetId?: string }): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const checked = await locator.isChecked();
  return { ok: true, data: checked };
}

export async function handleIsEditable(params: { ref: string; targetId?: string }): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const editable = await locator.isEditable();
  return { ok: true, data: editable };
}

// --- Wait-for-state (blocks until condition or timeout) ---

type WaitState = "visible" | "hidden" | "attached" | "detached";

export async function handleWaitVisible(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  return waitForState(params.ref, "visible", params.targetId, params.timeoutMs);
}

export async function handleWaitHidden(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  return waitForState(params.ref, "hidden", params.targetId, params.timeoutMs);
}

export async function handleWaitEnabled(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  return waitForPoll(
    params.ref,
    "enabled",
    async (loc) => loc.isEnabled(),
    params.targetId,
    params.timeoutMs,
  );
}

export async function handleWaitChecked(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  return waitForPoll(
    params.ref,
    "checked",
    async (loc) => loc.isChecked(),
    params.targetId,
    params.timeoutMs,
  );
}

// --- Internal helpers ---

async function waitForState(
  ref: string,
  state: WaitState,
  targetId?: string,
  timeoutMs?: number,
): Promise<ActionResult> {
  const { locator } = await getLocator(ref, targetId);
  const timeout = timeoutMs ?? 10000;
  try {
    await locator.waitFor({ state, timeout });
    return { ok: true, data: true, message: `Element "${ref}" is ${state}` };
  } catch {
    return {
      ok: false,
      error: `Timed out waiting for element "${ref}" to be ${state} (${timeout}ms)`,
      suggestion: `Run snapshot to check if element "${ref}" exists`,
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitForPoll(
  ref: string,
  condition: string,
  check: (loc: ReturnType<typeof refLocator>) => Promise<boolean>,
  targetId?: string,
  timeoutMs?: number,
): Promise<ActionResult> {
  const { locator } = await getLocator(ref, targetId);
  const timeout = timeoutMs ?? 10000;
  const interval = 200;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      if (await check(locator)) {
        return { ok: true, data: true, message: `Element "${ref}" is ${condition}` };
      }
    } catch {
      // element may be detached - keep trying
    }
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }

  return {
    ok: false,
    error: `Timed out waiting for element "${ref}" to be ${condition} (${timeout}ms)`,
    suggestion: `Run snapshot to check if element "${ref}" exists`,
  };
}
