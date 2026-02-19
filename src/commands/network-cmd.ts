// network-cmd.ts — RPC handlers for route.* commands

import { getPage } from "../browser.js";
import { globalNetwork } from "../network.js";
import { ERROR_CODES } from "../protocol.js";

function resolveTargetId(params: { targetId?: string }): string {
  return params.targetId ?? "default";
}

export async function handleRouteBlock(params: {
  pattern: string;
  targetId?: string;
}): Promise<object> {
  if (!params.pattern) {
    throw Object.assign(new Error("pattern required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }
  const ruleId = await globalNetwork.addBlock(params.pattern, page, resolveTargetId(params));
  return { ok: true, rule_id: ruleId, pattern: params.pattern };
}

export async function handleRouteMock(params: {
  pattern: string;
  body?: string;
  status?: number;
  contentType?: string;
  targetId?: string;
}): Promise<object> {
  if (!params.pattern) {
    throw Object.assign(new Error("pattern required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }
  const ruleId = await globalNetwork.addMock(
    params.pattern,
    { body: params.body, status: params.status, contentType: params.contentType },
    page,
    resolveTargetId(params),
  );
  return { ok: true, rule_id: ruleId, pattern: params.pattern };
}

export async function handleRouteCapture(params: {
  pattern: string;
  targetId?: string;
}): Promise<object> {
  if (!params.pattern) {
    throw Object.assign(new Error("pattern required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }
  const ruleId = await globalNetwork.addCapture(params.pattern, page, resolveTargetId(params));
  return { ok: true, rule_id: ruleId, pattern: params.pattern };
}

export async function handleRouteList(params: { targetId?: string }): Promise<object> {
  const rules = globalNetwork.listRules(resolveTargetId(params));
  return { ok: true, rules, count: rules.length };
}

export async function handleRouteRemove(params: {
  ruleId: string;
  targetId?: string;
}): Promise<object> {
  if (!params.ruleId) {
    throw Object.assign(new Error("rule_id required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const page = await getPage(params.targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }
  await globalNetwork.removeRule(params.ruleId, page, resolveTargetId(params));
  return { ok: true, removed: params.ruleId };
}

export async function handleRouteClear(params: { targetId?: string }): Promise<object> {
  const tid = resolveTargetId(params);
  const page = await getPage(params.targetId).catch(() => null);
  const count = page
    ? await globalNetwork.clearAll(page, tid)
    : (() => { globalNetwork.destroyTab(tid); return 0; })();
  return { ok: true, cleared: count };
}

export async function handleRouteCaptured(params: {
  pattern?: string;
  targetId?: string;
}): Promise<object> {
  const captured = globalNetwork.getCaptured(
    resolveTargetId(params),
    params.pattern,
  );
  return { ok: true, captured, count: captured.length };
}
