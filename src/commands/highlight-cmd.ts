// highlight-cmd.ts — CSS highlight ring injection for visual debugging
// v0.9.0 FM-4: highlight <ref> [--color red] [--duration 2]

import { getPage, refLocator, getStoredRefs } from "../browser.js";
import { ERROR_CODES } from "../protocol.js";

const VALID_COLORS = new Set(["red", "blue", "green", "orange", "yellow", "purple", "pink"]);
const DEFAULT_COLOR = "red";
const DEFAULT_DURATION_S = 2;

export async function handleHighlight(params: {
  ref: string;
  color?: string;
  duration?: number;
  targetId?: string;
}): Promise<object> {
  if (!params.ref) {
    throw Object.assign(new Error("ref is required"), { rpcCode: ERROR_CODES.INVALID_PARAMS });
  }

  const color = params.color ?? DEFAULT_COLOR;
  if (!VALID_COLORS.has(color)) {
    throw Object.assign(
      new Error(`Invalid color "${color}". Valid colors: ${[...VALID_COLORS].join(", ")}`),
      { rpcCode: ERROR_CODES.INVALID_PARAMS },
    );
  }

  const durationMs = (params.duration ?? DEFAULT_DURATION_S) * 1000;

  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }

  const state = getStoredRefs(params.targetId ?? "default");
  const locator = refLocator(page, params.ref, state);

  await locator.evaluate(
    (el: HTMLElement, args: { color: string; durationMs: number }) => {
      const prevOutline = el.style.outline;
      const prevTransition = el.style.transition;
      el.style.outline = `3px solid ${args.color}`;
      el.style.transition = "outline 0.1s";
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.transition = prevTransition;
      }, args.durationMs);
    },
    { color, durationMs },
  );

  return {
    ok: true,
    ref: params.ref,
    color,
    duration_ms: durationMs,
  };
}
