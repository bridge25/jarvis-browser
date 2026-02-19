// storage-cmd.ts — RPC handlers for storage.* commands
// These require a live page (daemon + Chrome connected).

import type { Page } from "playwright-core";
import { getPage } from "../browser.js";
import { ERROR_CODES } from "../protocol.js";
import {
  storageGet,
  storageSet,
  storageRemove,
  storageClear,
  storageKeys,
  storageDump,
  type StorageType,
} from "../storage.js";

function resolveType(raw: unknown): StorageType {
  return raw === "session" ? "session" : "local";
}

async function requirePage(targetId?: string): Promise<Page> {
  const page = await getPage(targetId);
  if (!page) {
    throw Object.assign(new Error("No active page — Chrome not connected"), {
      rpcCode: ERROR_CODES.BROWSER_NOT_CONNECTED,
    });
  }
  return page;
}

export async function handleStorageGet(params: {
  key: string;
  type?: unknown;
  targetId?: string;
}): Promise<object> {
  const page = await requirePage(params.targetId);
  const value = await storageGet(page, params.key, resolveType(params.type));
  return { ok: true, key: params.key, value, found: value !== null };
}

export async function handleStorageSet(params: {
  key: string;
  value: string;
  type?: unknown;
  targetId?: string;
}): Promise<object> {
  const page = await requirePage(params.targetId);
  await storageSet(page, params.key, String(params.value ?? ""), resolveType(params.type));
  return { ok: true, key: params.key };
}

export async function handleStorageRemove(params: {
  key: string;
  type?: unknown;
  targetId?: string;
}): Promise<object> {
  const page = await requirePage(params.targetId);
  await storageRemove(page, params.key, resolveType(params.type));
  return { ok: true, key: params.key };
}

export async function handleStorageClear(params: {
  type?: unknown;
  targetId?: string;
}): Promise<object> {
  const page = await requirePage(params.targetId);
  await storageClear(page, resolveType(params.type));
  return { ok: true, cleared: resolveType(params.type) };
}

export async function handleStorageKeys(params: {
  type?: unknown;
  targetId?: string;
}): Promise<object> {
  const page = await requirePage(params.targetId);
  const keys = await storageKeys(page, resolveType(params.type));
  return { ok: true, keys, count: keys.length };
}

export async function handleStorageDump(params: {
  type?: unknown;
  targetId?: string;
}): Promise<object> {
  const page = await requirePage(params.targetId);
  const data = await storageDump(page, resolveType(params.type));
  return { ok: true, data, count: Object.keys(data).length };
}
