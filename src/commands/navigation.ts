// Navigation command handlers: navigate, reload, back, forward

import { reloadPage, goBack, goForward } from "../browser.js";
import { navigate } from "../actions.js";

export async function handleNavigate(params: {
  url: string;
  targetId?: string;
  timeoutMs?: number;
}): Promise<object> {
  return navigate({ url: params.url, targetId: params.targetId, timeoutMs: params.timeoutMs });
}

export async function handleReload(params: {
  targetId?: string;
}): Promise<object> {
  const result = await reloadPage(params.targetId);
  return { ok: true, message: "Reloaded", data: result };
}

export async function handleBack(params: {
  targetId?: string;
}): Promise<object> {
  const result = await goBack(params.targetId);
  return {
    ok: result.url !== null,
    message: result.url ? `Navigated back to ${result.url}` : "No previous page in history",
    data: result,
  };
}

export async function handleForward(params: {
  targetId?: string;
}): Promise<object> {
  const result = await goForward(params.targetId);
  return {
    ok: result.url !== null,
    message: result.url ? `Navigated forward to ${result.url}` : "No next page in history",
    data: result,
  };
}
