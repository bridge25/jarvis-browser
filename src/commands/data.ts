// Data command handlers: snapshot, screenshot, evaluate, text, attribute, cookies

import { takeSnapshot, getCookies, setCookies, clearCookies } from "../browser.js";
import { screenshot, evaluate, getText, getAttribute } from "../actions.js";
import { fileOutput } from "../shared.js";

export async function handleSnapshot(params: {
  targetId?: string;
  mode?: "role" | "aria" | "ai";
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;
  maxChars?: number;
  outputFile?: string;
}): Promise<object> {
  const result = await takeSnapshot({
    targetId: params.targetId,
    mode: params.mode,
    maxChars: params.maxChars,
    options: {
      interactive: params.interactive,
      compact: params.compact,
      maxDepth: params.maxDepth,
    },
  });

  if (params.outputFile) {
    // Returns small pointer to stdout (snapshot → file)
    fileOutput(params.outputFile, result.snapshot, {
      refs: result.stats.refs,
      lines: result.snapshot.split("\n").length,
    });
    return result.stats;
  }

  return result;
}

export async function handleScreenshot(params: {
  ref?: string;
  path?: string;
  fullPage?: boolean;
  targetId?: string;
}): Promise<object> {
  return screenshot({
    ref: params.ref,
    path: params.path,
    fullPage: params.fullPage,
    targetId: params.targetId,
  });
}

export async function handleEvaluate(params: {
  expression: string;
  targetId?: string;
  outputFile?: string;
}): Promise<object> {
  const result = await evaluate({
    expression: params.expression,
    targetId: params.targetId,
  });

  if (params.outputFile && result.data !== undefined) {
    const content =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data, null, 2);
    fileOutput(params.outputFile, content, { type: typeof result.data });
    return { ok: true, message: `Output saved to ${params.outputFile}` };
  }

  return result;
}

export async function handleText(params: {
  ref?: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<object> {
  return getText({
    ref: params.ref,
    targetId: params.targetId,
    timeoutMs: params.timeoutMs,
  });
}

export async function handleAttribute(params: {
  ref: string;
  name: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<object> {
  return getAttribute({
    ref: params.ref,
    name: params.name,
    targetId: params.targetId,
    timeoutMs: params.timeoutMs,
  });
}

export async function handleCookies(params: {
  targetId?: string;
  url?: string;
  /** Substring filter on cookie domain (case-insensitive) */
  domain?: string;
  /** Exact filter on cookie name */
  name?: string;
}): Promise<unknown> {
  const raw = await getCookies(params.targetId, params.url ? [params.url] : undefined);
  const cookies = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];

  const domainFilter = params.domain ? params.domain.toLowerCase() : null;
  return cookies
    .filter((c) => !domainFilter || String(c.domain ?? "").toLowerCase().includes(domainFilter))
    .filter((c) => params.name === undefined || c.name === params.name);
}

export async function handleSetCookie(params: {
  cookieJson: string;
}): Promise<object> {
  const cookie = JSON.parse(params.cookieJson) as
    | Record<string, unknown>
    | Array<Record<string, unknown>>;
  const cookies = Array.isArray(cookie) ? cookie : [cookie];
  await setCookies(
    cookies as Parameters<typeof setCookies>[0],
  );
  return { ok: true, message: "Cookie(s) set" };
}

export async function handleClearCookies(params: {
  targetId?: string;
}): Promise<object> {
  await clearCookies(params.targetId);
  return { ok: true, message: "Cookies cleared" };
}
