// storage.ts — localStorage / sessionStorage access
// Thin wrappers over page.evaluate() — no daemon state required.

import type { Page } from "playwright-core";

export type StorageType = "local" | "session";

function storeName(type: StorageType): "localStorage" | "sessionStorage" {
  return type === "session" ? "sessionStorage" : "localStorage";
}

export async function storageGet(page: Page, key: string, type: StorageType = "local"): Promise<string | null> {
  const store = storeName(type);
  return page.evaluate(
    (args: string[]) =>
      (window as unknown as Record<string, Storage>)[args[0]].getItem(args[1]),
    [store, key],
  );
}

export async function storageSet(page: Page, key: string, value: string, type: StorageType = "local"): Promise<void> {
  const store = storeName(type);
  await page.evaluate(
    (args: string[]) =>
      (window as unknown as Record<string, Storage>)[args[0]].setItem(args[1], args[2]),
    [store, key, value],
  );
}

export async function storageRemove(page: Page, key: string, type: StorageType = "local"): Promise<void> {
  const store = storeName(type);
  await page.evaluate(
    (args: string[]) =>
      (window as unknown as Record<string, Storage>)[args[0]].removeItem(args[1]),
    [store, key],
  );
}

export async function storageClear(page: Page, type: StorageType = "local"): Promise<void> {
  const store = storeName(type);
  await page.evaluate(
    (s: string) => (window as unknown as Record<string, Storage>)[s].clear(),
    store,
  );
}

export async function storageKeys(page: Page, type: StorageType = "local"): Promise<string[]> {
  const store = storeName(type);
  return page.evaluate(
    (s: string) => Object.keys((window as unknown as Record<string, Storage>)[s]),
    store,
  );
}

export async function storageDump(page: Page, type: StorageType = "local"): Promise<Record<string, string>> {
  const store = storeName(type);
  return page.evaluate(
    (s: string): Record<string, string> => {
      const storage = (window as unknown as Record<string, Storage>)[s];
      return Object.fromEntries(
        Array.from({ length: storage.length }, (_, i) => {
          const key = storage.key(i) ?? "";
          return [key, storage.getItem(key) ?? ""] as [string, string];
        }).filter(([k]) => k !== ""),
      );
    },
    store,
  );
}
