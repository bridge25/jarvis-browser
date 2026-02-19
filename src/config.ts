// config.ts — Runtime configuration for jarvis-browser daemon
// Config file: /tmp/jarvis-browser-config.json
// Keys and defaults define the contract; callers should use isValidConfigKey() before setConfigValue().

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export const CONFIG_PATH = "/tmp/jarvis-browser-config.json";

export interface RuntimeConfig {
  "auto-retry": boolean;
  "retry-count": number;
  "retry-delay-ms": number;
  "default-timeout-ms": number;
  "screenshot-dir": string;
  "console-buffer-size": number;
  "network-buffer-size": number;
  "daemon-idle-timeout-m": number;
  // v0.7.0: dialog handling mode
  "dialog-mode": "accept" | "dismiss" | "queue";
  // v0.8.0: max KB of response body to capture (0 = disabled)
  "network-body-max-kb": number;
  // v1.0.0: proxy support (empty = disabled)
  "proxy": string;
  "proxy-bypass": string;
}

export type ConfigKey = keyof RuntimeConfig;
export type ConfigValue = RuntimeConfig[ConfigKey];

const DEFAULTS: RuntimeConfig = {
  "auto-retry": false,
  "retry-count": 2,
  "retry-delay-ms": 500,
  "default-timeout-ms": 10000,
  "screenshot-dir": "/tmp",
  "console-buffer-size": 500,
  "network-buffer-size": 200,
  "daemon-idle-timeout-m": 30,
  "dialog-mode": "accept",
  "network-body-max-kb": 0,
  "proxy": "",
  "proxy-bypass": "",
};

const VALID_KEYS = new Set<string>(Object.keys(DEFAULTS));

export function isValidConfigKey(key: string): key is ConfigKey {
  return VALID_KEYS.has(key);
}

export function getDefaults(): RuntimeConfig {
  return { ...DEFAULTS };
}

export async function readConfig(): Promise<RuntimeConfig> {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeRuntimeConfig(config: RuntimeConfig): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function getConfigValue(key: ConfigKey): Promise<ConfigValue> {
  const config = await readConfig();
  return config[key];
}

export async function setConfigValue(key: ConfigKey, rawValue: string): Promise<void> {
  const config = await readConfig();
  const typed = coerceValue(key, rawValue);
  await writeRuntimeConfig({ ...config, [key]: typed } as RuntimeConfig);
}

export async function resetConfig(): Promise<void> {
  await writeRuntimeConfig({ ...DEFAULTS });
}

function coerceValue(key: ConfigKey, raw: string): ConfigValue {
  // Enum keys with specific allowed values
  if (key === "dialog-mode") {
    if (raw !== "accept" && raw !== "dismiss" && raw !== "queue") {
      throw new Error(`Value for "dialog-mode" must be accept|dismiss|queue, got "${raw}"`);
    }
    return raw as "accept" | "dismiss" | "queue";
  }
  const defaultVal = DEFAULTS[key];
  if (typeof defaultVal === "boolean") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    throw new Error(`Value for "${key}" must be true/false, got "${raw}"`);
  }
  if (typeof defaultVal === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Value for "${key}" must be a number, got "${raw}"`);
    return n;
  }
  return raw;
}
