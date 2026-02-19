// find-cmd.ts — Semantic locator commands (v0.8.0 FM-6)
// Skip snapshot step by querying elements directly via Playwright semantic APIs.
// Supported strategies: role, text, label, placeholder, testid

import type { Locator } from "playwright-core";
import { getPage } from "../browser.js";
import type { ActionResult } from "../types.js";

// --- Types ---

export type FindStrategy = "role" | "text" | "label" | "placeholder" | "testid";
export type FindAction = "click" | "fill" | "type" | "hover" | "check" | "none";

export interface FindParams {
  value: string;
  action?: FindAction;
  actionArg?: string;
  /** ARIA role name (for getByRole only) */
  name?: string;
  /** Exact match for text/label/placeholder strategies */
  exact?: boolean;
  targetId?: string;
  timeoutMs?: number;
}

// --- Locator builders ---

function buildLocator(page: ReturnType<typeof Object.create>, strategy: FindStrategy, params: FindParams): Locator {
  const exact = params.exact ?? false;

  switch (strategy) {
    case "role":
      // getByRole(role, { name }) — ARIA role + optional accessible name
      return params.name
        ? page.getByRole(params.value, { name: params.name, exact })
        : page.getByRole(params.value);

    case "text":
      return page.getByText(params.value, { exact });

    case "label":
      return page.getByLabel(params.value, { exact });

    case "placeholder":
      return page.getByPlaceholder(params.value, { exact });

    case "testid":
      return page.getByTestId(params.value);

    default:
      throw new Error(`Unknown find strategy: ${String(strategy)}`);
  }
}

// --- Action executor ---

async function executeAction(
  locator: Locator,
  action: FindAction | undefined,
  actionArg: string | undefined,
  timeoutMs: number,
): Promise<string> {
  switch (action) {
    case "click":
      await locator.first().click({ timeout: timeoutMs });
      return "clicked";

    case "fill":
      await locator.first().fill(actionArg ?? "", { timeout: timeoutMs });
      return `filled "${actionArg ?? ""}"`;

    case "type":
      await locator.first().pressSequentially(actionArg ?? "", { timeout: timeoutMs });
      return `typed "${actionArg ?? ""}"`;

    case "hover":
      await locator.first().hover({ timeout: timeoutMs });
      return "hovered";

    case "check":
      await locator.first().check({ timeout: timeoutMs });
      return "checked";

    case "none":
    case undefined:
      // No action — just locate; verify the element exists
      await locator.first().waitFor({ state: "attached", timeout: timeoutMs });
      return "located";

    default:
      throw new Error(`Unknown find action: ${String(action)}`);
  }
}

// --- Core handler ---

async function handleFind(strategy: FindStrategy, params: FindParams): Promise<ActionResult> {
  const page = await getPage(params.targetId);
  if (!page) {
    return {
      ok: false,
      error: "No active page — Chrome not connected",
      suggestion: "Run: jarvis-browser connect",
    };
  }

  const timeoutMs = params.timeoutMs ?? 10000;

  try {
    const locator = buildLocator(page, strategy, params);
    const actionDone = await executeAction(locator, params.action, params.actionArg, timeoutMs);

    const label = params.name ? `${strategy}[${params.value}][name=${params.name}]` : `${strategy}[${params.value}]`;
    return {
      ok: true,
      data: { strategy, value: params.value, action: actionDone, label },
      message: `find ${label}: ${actionDone}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const label = params.name ? `${strategy}[${params.value}][name=${params.name}]` : `${strategy}[${params.value}]`;
    return {
      ok: false,
      error: `find ${label} failed: ${msg}`,
      suggestion: `Check the ${strategy} value is correct, or use snapshot + ref-based commands instead.`,
    };
  }
}

// --- Public handler exports ---

export function handleFindRole(params: FindParams): Promise<ActionResult> {
  return handleFind("role", params);
}

export function handleFindText(params: FindParams): Promise<ActionResult> {
  return handleFind("text", params);
}

export function handleFindLabel(params: FindParams): Promise<ActionResult> {
  return handleFind("label", params);
}

export function handleFindPlaceholder(params: FindParams): Promise<ActionResult> {
  return handleFind("placeholder", params);
}

export function handleFindTestid(params: FindParams): Promise<ActionResult> {
  return handleFind("testid", params);
}
