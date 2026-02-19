// config-cmd.ts — RPC handlers for runtime configuration management (v0.6.0)

import {
  readConfig,
  resetConfig,
  isValidConfigKey,
  getDefaults,
  setConfigValue,
  getConfigValue,
  type ConfigKey,
} from "../config.js";

export async function handleConfigGet(params: { key: string }): Promise<object> {
  if (!params.key) throw new Error("key is required");
  if (!isValidConfigKey(params.key)) {
    throw new Error(`Unknown config key: "${params.key}". Use config.list to see valid keys.`);
  }
  const value = await getConfigValue(params.key as ConfigKey);
  return { ok: true, key: params.key, value };
}

export async function handleConfigSet(params: { key: string; value: string }): Promise<object> {
  if (!params.key) throw new Error("key is required");
  if (!isValidConfigKey(params.key)) {
    throw new Error(`Unknown config key: "${params.key}". Use config.list to see valid keys.`);
  }
  if (params.value === undefined || params.value === null) {
    throw new Error("value is required");
  }
  await setConfigValue(params.key as ConfigKey, String(params.value));
  const updated = await getConfigValue(params.key as ConfigKey);
  return { ok: true, key: params.key, value: updated };
}

export async function handleConfigList(): Promise<object> {
  const config = await readConfig();
  const defaults = getDefaults();
  const entries = Object.entries(config).map(([key, value]) => ({
    key,
    value,
    default: defaults[key as ConfigKey],
    modified: value !== defaults[key as ConfigKey],
  }));
  return { ok: true, config, defaults, entries };
}

export async function handleConfigReset(): Promise<object> {
  await resetConfig();
  return { ok: true, message: "Config reset to defaults", config: getDefaults() };
}
