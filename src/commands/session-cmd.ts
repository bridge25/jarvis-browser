// session-cmd.ts — RPC handlers for session.* commands

import { getPage } from "../browser.js";
import { ERROR_CODES } from "../protocol.js";
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  exportSession,
  importSession,
} from "../session.js";

export async function handleSessionSave(params: {
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
  const data = await saveSession(params.name, page);
  return {
    ok: true,
    name: data.name,
    origin: data.origin,
    saved_at: data.saved_at,
    cookies: data.cookies.length,
    localStorage_keys: Object.keys(data.localStorage).length,
    sessionStorage_keys: Object.keys(data.sessionStorage).length,
  };
}

export async function handleSessionLoad(params: {
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
  const result = await loadSession(params.name, page);
  return { ok: true, ...result };
}

export async function handleSessionList(_params: Record<string, unknown>): Promise<object> {
  const sessions = await listSessions();
  return { ok: true, sessions, count: sessions.length };
}

export async function handleSessionDelete(params: { name: string }): Promise<object> {
  if (!params.name) {
    throw Object.assign(new Error("name required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  await deleteSession(params.name);
  return { ok: true, deleted: params.name };
}

export async function handleSessionExport(params: {
  name: string;
  outputFile?: string;
  includeSecrets?: boolean;
}): Promise<object> {
  if (!params.name) {
    throw Object.assign(new Error("name required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const dest = await exportSession(params.name, params.outputFile, params.includeSecrets ?? false);
  return { ok: true, path: dest };
}

export async function handleSessionImport(params: {
  path: string;
  name?: string;
}): Promise<object> {
  if (!params.path) {
    throw Object.assign(new Error("path required"), { rpcCode: ERROR_CODES.ACTION_FAILED });
  }
  const sessionName = await importSession(params.path, params.name);
  return { ok: true, imported: sessionName };
}
