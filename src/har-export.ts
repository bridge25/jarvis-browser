// har-export.ts — HAR 1.2 + JSON export from observer state
// v0.9.0 FM-10: observe --export <path> [--format har]

import { writeFile } from "node:fs/promises";
import type { NetworkEntry } from "./observer.js";

const HAR_VERSION = "1.2";
const CREATOR_NAME = "jarvis-browser";
const CREATOR_VERSION = "0.9.0";

// --- HAR 1.2 types (subset) ---

interface HarNameValue {
  name: string;
  value: string;
}

interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarNameValue[];
    queryString: HarNameValue[];
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarNameValue[];
    content: HarContent;
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
}

// --- Conversion ---

function parseQueryString(url: string): HarNameValue[] {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  } catch {
    return [];
  }
}

function networkEntryToHar(entry: NetworkEntry): HarEntry {
  const startMs = (entry.timestamp ?? 0) * 1000; // seconds → ms since epoch
  return {
    startedDateTime: startMs > 0 ? new Date(startMs).toISOString() : new Date().toISOString(),
    time: entry.duration_ms ?? 0,
    request: {
      method: entry.method,
      url: entry.url,
      httpVersion: "HTTP/1.1",
      headers: [],
      queryString: parseQueryString(entry.url),
      bodySize: -1,
    },
    response: {
      status: entry.status ?? 0,
      statusText: entry.status !== null && entry.status !== undefined ? String(entry.status) : "",
      httpVersion: "HTTP/1.1",
      headers: [],
      content: {
        size: entry.body !== undefined ? entry.body.length : -1,
        mimeType: entry.resource_type === "document" ? "text/html" : "application/octet-stream",
        ...(entry.body !== undefined ? { text: entry.body } : {}),
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: entry.body !== undefined ? entry.body.length : -1,
    },
    cache: {},
    timings: { send: 0, wait: entry.duration_ms ?? 0, receive: 0 },
  };
}

// --- Export functions ---

export async function exportToHar(entries: NetworkEntry[], destPath: string): Promise<void> {
  const har = {
    log: {
      version: HAR_VERSION,
      creator: { name: CREATOR_NAME, version: CREATOR_VERSION },
      entries: entries.map(networkEntryToHar),
    },
  };
  await writeFile(destPath, JSON.stringify(har, null, 2), "utf-8");
}

export async function exportToJson(data: object, destPath: string): Promise<void> {
  await writeFile(destPath, JSON.stringify(data, null, 2), "utf-8");
}
