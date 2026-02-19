// get-cmd.ts — Compound data query commands (v0.7.0)
// get text/html/value/attr/title/url/count/box
// Wraps Playwright locator methods behind the ref system.

import { getPage, refLocator, getStoredRefs } from "../browser.js";
import type { ActionResult } from "../types.js";

// --- Helpers ---

async function getLocator(ref: string, targetId?: string) {
  const page = await getPage(targetId);
  const state = getStoredRefs(targetId ?? "default");
  return { page, locator: refLocator(page, ref, state) };
}

// --- get text ---

export async function handleGetText(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const text = await locator.textContent({ timeout: params.timeoutMs ?? 5000 });
  return { ok: true, data: text ?? "" };
}

// --- get html ---

export async function handleGetHtml(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const html = await locator.innerHTML({ timeout: params.timeoutMs ?? 5000 });
  return { ok: true, data: html };
}

// --- get value ---

export async function handleGetValue(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const value = await locator.inputValue({ timeout: params.timeoutMs ?? 5000 });
  return { ok: true, data: value };
}

// --- get attr ---

export async function handleGetAttr(params: {
  ref: string;
  attrName: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const value = await locator.getAttribute(params.attrName, { timeout: params.timeoutMs ?? 5000 });
  return { ok: true, data: value };
}

// --- get title ---

export async function handleGetTitle(params: {
  targetId?: string;
}): Promise<ActionResult> {
  const page = await getPage(params.targetId);
  const title = await page.title();
  return { ok: true, data: title };
}

// --- get url ---

export async function handleGetUrl(params: {
  targetId?: string;
}): Promise<ActionResult> {
  const page = await getPage(params.targetId);
  return { ok: true, data: page.url() };
}

// --- get count ---

export async function handleGetCount(params: {
  selector: string;
  targetId?: string;
}): Promise<ActionResult> {
  const page = await getPage(params.targetId);
  const count = await page.locator(params.selector).count();
  return { ok: true, data: count };
}

// --- get box ---

export async function handleGetBox(params: {
  ref: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  const { locator } = await getLocator(params.ref, params.targetId);
  const box = await locator.boundingBox({ timeout: params.timeoutMs ?? 5000 });
  if (!box) return { ok: false, error: `No bounding box for ref "${params.ref}"`, suggestion: "Element may not be visible" };
  return {
    ok: true,
    data: { x: box.x, y: box.y, w: box.width, h: box.height },
  };
}
