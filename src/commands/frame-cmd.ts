// frame-cmd.ts — RPC handlers for frame.* commands
// Frame switching works by storing a frameSelector in the ref cache.
// Subsequent snapshot/click/type commands use that selector to scope to the frame.

import { getPage, storeRefs, getStoredRefs } from "../browser.js";
import { ERROR_CODES } from "../protocol.js";

export async function handleFrameList(params: { targetId?: string }): Promise<object> {
  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }

  const tid = params.targetId ?? "default";
  const currentState = getStoredRefs(tid);
  const currentSelector = currentState?.frameSelector;

  const frames = page.frames().map((frame, idx) => {
    const name = frame.name();
    const url = frame.url();
    const expectedSelector = name ? `iframe[name="${name}"]` : `iframe:nth-of-type(${idx + 1})`;
    const isCurrent = idx === 0
      ? !currentSelector   // main frame is current when no selector active
      : currentSelector === expectedSelector;
    return { name: name || `(unnamed #${idx})`, url, current: isCurrent };
  });

  // Ensure exactly one frame is marked current
  if (!currentSelector && frames.length > 0) {
    frames[0].current = true;
  }

  return { ok: true, frames };
}

export async function handleFrameSwitch(params: {
  name: string;
  targetId?: string;
}): Promise<object> {
  if (!params.name) {
    throw Object.assign(new Error("name required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }

  const frames = page.frames();
  const target = frames.find((f) => f.name() === params.name);
  if (!target) {
    throw Object.assign(
      new Error(`Frame "${params.name}" not found. Available frames: ${frames.map((f) => f.name() || "(unnamed)").join(", ")}`),
      { rpcCode: ERROR_CODES.ACTION_FAILED },
    );
  }

  const frameSelector = `iframe[name="${target.name()}"]`;
  const tid = params.targetId ?? "default";
  const currentState = getStoredRefs(tid);
  if (currentState) {
    storeRefs(tid, currentState.refs, currentState.mode, frameSelector);
  } else {
    storeRefs(tid, {}, "role", frameSelector);
  }

  return { ok: true, switched_to: params.name, selector: frameSelector };
}

export async function handleFrameMain(params: { targetId?: string }): Promise<object> {
  const tid = params.targetId ?? "default";
  const currentState = getStoredRefs(tid);
  if (currentState) {
    storeRefs(tid, currentState.refs, currentState.mode, undefined);
  }
  return { ok: true, switched_to: "main" };
}
