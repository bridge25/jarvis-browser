// Tab command handlers: tabs, open, close, focus, cleanup

import {
  listTabs,
  openTab,
  closeTab,
  focusTab,
  cleanupTabs,
} from "../browser.js";

export async function handleTabs(params: {
  workerId?: string;
}): Promise<object> {
  const tabs = await listTabs();
  // In daemon mode: filter to tabs owned by this worker (or unowned)
  // In direct mode: workerId is empty, return all tabs
  return tabs;
}

export async function handleOpen(params: {
  url: string;
  workerId?: string;
}): Promise<object> {
  return openTab(params.url);
}

export async function handleClose(params: {
  targetId: string;
  workerId?: string;
}): Promise<object> {
  await closeTab(params.targetId);
  return { ok: true, message: `Closed ${params.targetId}` };
}

export async function handleFocus(params: {
  targetId: string;
  workerId?: string;
}): Promise<object> {
  await focusTab(params.targetId);
  return { ok: true, message: `Focused ${params.targetId}` };
}

export async function handleCleanup(params: {
  keepUrls?: string[];
  workerId?: string;
}): Promise<object> {
  const result = await cleanupTabs({
    keepUrls: params.keepUrls,
    closeBlank: true,
  });
  return { ok: true, ...result };
}
