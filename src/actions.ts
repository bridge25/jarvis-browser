// Browser actions - ref-based interactions
// Ported from OpenClaw pw-tools-core.interactions.ts (MIT License)

import type { Page } from "playwright-core";
import { getPage, getStoredRefs, refLocator, takeSnapshot } from "./browser.js";
import { requireRef, normalizeTimeoutMs, toAIFriendlyError, jsonOutput, validateNavigationUrl, validateScreenshotPath } from "./shared.js";
import type { ActionResult } from "./types.js";

// --- Click ---

export async function click(opts: {
  targetId?: string;
  ref: string;
  button?: "left" | "right" | "middle";
  modifiers?: string[];
  doubleClick?: boolean;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    // Scroll element into view before interacting (fixes off-viewport clicks)
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});

    const clickOpts: {
      timeout: number;
      button?: "left" | "right" | "middle";
      modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[];
    } = { timeout };
    if (opts.button) clickOpts.button = opts.button;
    if (opts.modifiers?.length) {
      clickOpts.modifiers = opts.modifiers as ("Alt" | "Control" | "Meta" | "Shift")[];
    }

    if (opts.doubleClick) {
      await locator.dblclick(clickOpts);
    } else {
      await locator.click(clickOpts);
    }
    return { ok: true, message: `Clicked ${ref}` };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Type / Fill ---

export async function type(opts: {
  targetId?: string;
  ref: string;
  text: string;
  clearFirst?: boolean;
  pressEnter?: boolean;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    if (opts.clearFirst) {
      await locator.fill("", { timeout });
    }
    await locator.pressSequentially(opts.text, { timeout, delay: 50 });
    if (opts.pressEnter) {
      await locator.press("Enter", { timeout });
    }
    return { ok: true, message: `Typed into ${ref}` };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

export async function fill(opts: {
  targetId?: string;
  ref: string;
  value: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    await locator.fill(opts.value, { timeout });
    return { ok: true, message: `Filled ${ref}` };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Select ---

export async function selectOption(opts: {
  targetId?: string;
  ref: string;
  values: string[];
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    const selected = await locator.selectOption(opts.values, { timeout });
    return { ok: true, message: `Selected ${selected.length} option(s) on ${ref}`, data: selected };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Check / Uncheck ---

export async function setChecked(opts: {
  targetId?: string;
  ref: string;
  checked: boolean;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    await locator.setChecked(opts.checked, { timeout });
    return { ok: true, message: `Set ${ref} checked=${opts.checked}` };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Hover ---

export async function hover(opts: {
  targetId?: string;
  ref: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    await locator.hover({ timeout });
    return { ok: true, message: `Hovered ${ref}` };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Drag ---

export async function drag(opts: {
  targetId?: string;
  sourceRef: string;
  targetRef: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const srcRef = requireRef(opts.sourceRef);
  const tgtRef = requireRef(opts.targetRef);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const srcLocator = refLocator(page, srcRef, state);
  const tgtLocator = refLocator(page, tgtRef, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 10000);

  try {
    await srcLocator.dragTo(tgtLocator, { timeout });
    return { ok: true, message: `Dragged ${srcRef} → ${tgtRef}` };
  } catch (error) {
    throw toAIFriendlyError(error, `${srcRef} → ${tgtRef}`);
  }
}

// --- Scroll ---

export async function scroll(opts: {
  targetId?: string;
  ref?: string;
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const pixels = opts.amount ?? 500;

  const deltaX = opts.direction === "left" ? -pixels : opts.direction === "right" ? pixels : 0;
  const deltaY = opts.direction === "up" ? -pixels : opts.direction === "down" ? pixels : 0;

  try {
    if (opts.ref) {
      const state = getStoredRefs(opts.targetId ?? "default");
      const locator = refLocator(page, requireRef(opts.ref), state);
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    } else {
      await page.mouse.wheel(deltaX, deltaY);
    }
    return { ok: true, message: `Scrolled ${opts.direction} ${pixels}px` };
  } catch (error) {
    throw toAIFriendlyError(error, opts.ref ?? "page");
  }
}

// --- Navigate ---

export async function navigate(opts: {
  targetId?: string;
  url: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  validateNavigationUrl(opts.url);
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 30000);

  try {
    const response = await page.goto(opts.url, { timeout, waitUntil: "domcontentloaded" });
    return {
      ok: true,
      message: `Navigated to ${opts.url}`,
      data: { status: response?.status(), url: page.url() },
    };
  } catch (error) {
    throw new Error(`Navigation to "${opts.url}" failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Wait ---

export async function waitForNavigation(opts: {
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 30000);

  try {
    await page.waitForLoadState("domcontentloaded", { timeout });
    return { ok: true, message: `Page loaded: ${page.url()}`, data: { url: page.url() } };
  } catch (error) {
    throw new Error(`Wait timed out: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function waitForSelector(opts: {
  targetId?: string;
  ref: string;
  state?: "visible" | "hidden" | "attached" | "detached";
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 10000);

  try {
    await locator.waitFor({ state: opts.state ?? "visible", timeout });
    return { ok: true, message: `Element ${ref} is ${opts.state ?? "visible"}` };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Screenshot ---

export async function screenshot(opts: {
  targetId?: string;
  ref?: string;
  path?: string;
  fullPage?: boolean;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const outputPath = validateScreenshotPath(opts.path ?? `/tmp/jarvis-screenshot-${Date.now()}.png`);

  try {
    if (opts.ref) {
      const state = getStoredRefs(opts.targetId ?? "default");
      const locator = refLocator(page, requireRef(opts.ref), state);
      await locator.screenshot({ path: outputPath });
    } else {
      await page.screenshot({ path: outputPath, fullPage: opts.fullPage ?? false });
    }
    return { ok: true, message: `Screenshot saved to ${outputPath}`, data: { path: outputPath } };
  } catch (error) {
    throw new Error(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Evaluate JS ---

export async function evaluate(opts: {
  targetId?: string;
  expression: string;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);

  try {
    const result = await page.evaluate(opts.expression);
    return { ok: true, message: "Evaluated", data: result };
  } catch (error) {
    throw new Error(`Evaluate failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- Key press ---

export async function pressKey(opts: {
  targetId?: string;
  ref?: string;
  key: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    if (opts.ref) {
      const state = getStoredRefs(opts.targetId ?? "default");
      const locator = refLocator(page, requireRef(opts.ref), state);
      await locator.press(opts.key, { timeout });
    } else {
      await page.keyboard.press(opts.key);
    }
    return { ok: true, message: `Pressed ${opts.key}` };
  } catch (error) {
    throw toAIFriendlyError(error, opts.ref ?? "page");
  }
}

// --- Dialog handler ---

let dialogResult: { type: string; message: string } | null = null;

export function setupDialogHandler(page: Page, action: "accept" | "dismiss"): void {
  page.on("dialog", async (dialog) => {
    dialogResult = { type: dialog.type(), message: dialog.message() };
    if (action === "accept") {
      await dialog.accept().catch(() => {});
    } else {
      await dialog.dismiss().catch(() => {});
    }
  });
}

export function getLastDialog(): { type: string; message: string } | null {
  const result = dialogResult;
  dialogResult = null;
  return result;
}

// --- Get text / attribute ---

export async function getText(opts: {
  targetId?: string;
  ref?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    if (opts.ref) {
      const ref = requireRef(opts.ref);
      const state = getStoredRefs(opts.targetId ?? "default");
      const locator = refLocator(page, ref, state);
      const text = await locator.textContent({ timeout });
      return { ok: true, message: `Text of ${ref}`, data: text?.trim() ?? "" };
    }
    // No ref: get full page body text
    const text = await page.locator("body").innerText({ timeout });
    return { ok: true, message: "Page text", data: text.trim() };
  } catch (error) {
    throw toAIFriendlyError(error, opts.ref ?? "body");
  }
}

export async function getAttribute(opts: {
  targetId?: string;
  ref: string;
  name: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const ref = requireRef(opts.ref);
  const page = await getPage(opts.targetId);
  const state = getStoredRefs(opts.targetId ?? "default");
  const locator = refLocator(page, ref, state);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 5000);

  try {
    const value = await locator.getAttribute(opts.name, { timeout });
    return { ok: true, message: `${opts.name} of ${ref}`, data: value };
  } catch (error) {
    throw toAIFriendlyError(error, ref);
  }
}

// --- Extended wait strategies (v0.4.0) ---

export async function waitForText(opts: {
  targetId?: string;
  text: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 10000);
  try {
    await page.getByText(opts.text).first().waitFor({ state: "visible", timeout });
    return { ok: true, message: `Text "${opts.text}" is visible` };
  } catch (error) {
    throw new Error(`waitForText timed out: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function waitForUrl(opts: {
  targetId?: string;
  url: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 30000);
  try {
    await page.waitForURL(opts.url, { timeout });
    return { ok: true, message: `URL matches "${opts.url}"`, data: { url: page.url() } };
  } catch (error) {
    throw new Error(`waitForUrl timed out: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function waitForJS(opts: {
  targetId?: string;
  expression: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 10000);
  try {
    // Pass null as arg (no arg needed) and options as third param
    await page.waitForFunction(opts.expression, null, { timeout });
    return { ok: true, message: "JS expression is truthy" };
  } catch (error) {
    throw new Error(`waitForJS timed out: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function waitForNetworkIdle(opts: {
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const page = await getPage(opts.targetId);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 30000);
  try {
    await page.waitForLoadState("networkidle", { timeout });
    return { ok: true, message: "Network is idle" };
  } catch (error) {
    throw new Error(`waitForNetworkIdle timed out: ${error instanceof Error ? error.message : String(error)}`);
  }
}
