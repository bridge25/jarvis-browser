// Interaction command handlers: click, type, fill, select, check, hover, drag, scroll, press, wait

import {
  click,
  type as typeAction,
  fill,
  selectOption,
  setChecked,
  hover,
  drag,
  scroll,
  pressKey,
  waitForSelector,
  waitForNavigation,
  waitForText,
  waitForUrl,
  waitForJS,
  waitForNetworkIdle,
} from "../actions.js";
import { withRetry } from "../retry.js";
import { readConfig } from "../config.js";
import { getPage } from "../browser.js";
import {
  handleWaitVisible,
  handleWaitHidden,
  handleWaitEnabled,
  handleWaitChecked,
} from "./state-cmd.js";
import { handleUpload } from "../upload.js";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

// --- Auto-retry helper (v0.6.0) ---
// Wraps an action with the retry/recovery chain when autoRetry is enabled.
// Per-request opts override global config values.

async function applyRetry<T>(
  action: () => Promise<T>,
  opts: {
    autoRetry?: boolean;
    maxRetries?: number;
    targetId?: string;
    ref?: string;
  },
): Promise<T> {
  const config = await readConfig();
  const shouldRetry = opts.autoRetry ?? config["auto-retry"];
  if (!shouldRetry) return action();

  const maxRetries = opts.maxRetries ?? config["retry-count"];
  const delayMs = config["retry-delay-ms"];

  // Attempt to get the page for recovery; no-page → fail-fast on first error
  const page = await getPage(opts.targetId).catch(() => undefined);

  const { result } = await withRetry(action, {
    page,
    targetId: opts.targetId,
    ref: opts.ref,
    maxRetries,
    delayMs,
  });

  return result;
}

export async function handleClick(params: {
  ref: string;
  targetId?: string;
  button?: "left" | "right" | "middle";
  doubleClick?: boolean;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      click({
        ref: params.ref,
        targetId: params.targetId,
        button: params.button,
        doubleClick: params.doubleClick,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleType(params: {
  ref: string;
  text: string;
  targetId?: string;
  clearFirst?: boolean;
  pressEnter?: boolean;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      typeAction({
        ref: params.ref,
        text: params.text,
        targetId: params.targetId,
        clearFirst: params.clearFirst,
        pressEnter: params.pressEnter,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleFill(params: {
  ref: string;
  value: string;
  targetId?: string;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      fill({
        ref: params.ref,
        value: params.value,
        targetId: params.targetId,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleSelect(params: {
  ref: string;
  values: string[];
  targetId?: string;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      selectOption({
        ref: params.ref,
        values: params.values,
        targetId: params.targetId,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleCheck(params: {
  ref: string;
  checked: boolean;
  targetId?: string;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      setChecked({
        ref: params.ref,
        checked: params.checked,
        targetId: params.targetId,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleHover(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      hover({
        ref: params.ref,
        targetId: params.targetId,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleDrag(params: {
  sourceRef: string;
  targetRef: string;
  targetId?: string;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      drag({
        sourceRef: params.sourceRef,
        targetRef: params.targetRef,
        targetId: params.targetId,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.sourceRef },
  );
}

export async function handleScroll(params: {
  direction: "up" | "down" | "left" | "right";
  ref?: string;
  targetId?: string;
  amount?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      scroll({
        direction: params.direction,
        ref: params.ref,
        targetId: params.targetId,
        amount: params.amount,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handlePress(params: {
  key: string;
  ref?: string;
  targetId?: string;
  timeoutMs?: number;
  autoRetry?: boolean;
  maxRetries?: number;
}): Promise<object> {
  return applyRetry(
    () =>
      pressKey({
        key: params.key,
        ref: params.ref,
        targetId: params.targetId,
        timeoutMs: params.timeoutMs,
      }),
    { autoRetry: params.autoRetry, maxRetries: params.maxRetries, targetId: params.targetId, ref: params.ref },
  );
}

export async function handleWait(params: {
  ref?: string;
  state?: "visible" | "hidden" | "attached" | "detached";
  targetId?: string;
  timeoutMs?: number;
  text?: string;
  url?: string;
  js?: string;
  networkIdle?: boolean;
  navigation?: boolean;
  // v0.7.0 state wait flags
  visible?: boolean;
  hidden?: boolean;
  enabled?: boolean;
  checked?: boolean;
  // v0.7.0 download
  download?: boolean;
  saveTo?: string;
}): Promise<object> {
  // v0.7.0: download wait
  if (params.download) {
    const page = await getPage(params.targetId);
    const timeout = params.timeoutMs ?? 30000;
    const dl = await page.waitForEvent("download", { timeout });
    let savedPath: string | undefined;
    if (params.saveTo) {
      const dir = resolve(params.saveTo);
      mkdirSync(dir, { recursive: true });
      const filename = dl.suggestedFilename();
      savedPath = join(dir, filename);
      await dl.saveAs(savedPath);
    }
    return {
      ok: true,
      data: {
        filename: dl.suggestedFilename(),
        url: dl.url(),
        ...(savedPath ? { savedPath } : {}),
      },
    };
  }

  // v0.7.0: state wait flags (require ref)
  if (params.ref && params.visible) {
    return handleWaitVisible({ ref: params.ref, targetId: params.targetId, timeoutMs: params.timeoutMs });
  }
  if (params.ref && params.hidden) {
    return handleWaitHidden({ ref: params.ref, targetId: params.targetId, timeoutMs: params.timeoutMs });
  }
  if (params.ref && params.enabled) {
    return handleWaitEnabled({ ref: params.ref, targetId: params.targetId, timeoutMs: params.timeoutMs });
  }
  if (params.ref && params.checked) {
    return handleWaitChecked({ ref: params.ref, targetId: params.targetId, timeoutMs: params.timeoutMs });
  }

  // Original wait strategies
  if (params.text) {
    return waitForText({ targetId: params.targetId, text: params.text, timeoutMs: params.timeoutMs });
  }
  if (params.url) {
    return waitForUrl({ targetId: params.targetId, url: params.url, timeoutMs: params.timeoutMs });
  }
  if (params.js) {
    return waitForJS({ targetId: params.targetId, expression: params.js, timeoutMs: params.timeoutMs });
  }
  if (params.networkIdle) {
    return waitForNetworkIdle({ targetId: params.targetId, timeoutMs: params.timeoutMs });
  }
  if (params.ref) {
    return waitForSelector({
      ref: params.ref,
      state: params.state,
      targetId: params.targetId,
      timeoutMs: params.timeoutMs,
    });
  }
  return waitForNavigation({
    targetId: params.targetId,
    timeoutMs: params.timeoutMs,
  });
}

// v0.7.0: file upload (FM-2)
export async function handleUploadFile(params: {
  ref?: string;
  selector?: string;
  files: string[];
  targetId?: string;
  timeoutMs?: number;
}): Promise<object> {
  return handleUpload(params);
}
