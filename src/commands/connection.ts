// Connection command handlers: status, launch, connect, stop

import {
  checkStatus,
  launchChrome,
  connect,
  stopChrome,
  getConnectedBrowser,
} from "../browser.js";
import { readConfig } from "../config.js";

export async function handleStatus(params: {
  port?: number;
}): Promise<object> {
  const result = await checkStatus(params.port);
  const workerId = process.env.JARVIS_WORKER_ID ?? null;
  return { ...result, workerId };
}

export async function handleLaunch(params: {
  port?: number;
  headless?: boolean;
  noSandbox?: boolean;
}): Promise<object> {
  const config = await readConfig();
  const proxy = config["proxy"] || undefined;
  const proxyBypass = config["proxy-bypass"] || undefined;
  return launchChrome({
    port: params.port,
    headless: params.headless,
    noSandbox: params.noSandbox,
    ...(proxy ? { proxy } : {}),
    ...(proxyBypass ? { proxyBypass } : {}),
  });
}

export async function handleConnect(params: {
  cdpUrl?: string;
  port?: number;
}): Promise<object> {
  const browser = await connect(params.cdpUrl, params.port);
  return { ok: true, contexts: browser.contexts().length };
}

export async function handleStop(): Promise<object> {
  await stopChrome();
  return { ok: true, message: "Chrome stopped" };
}

export function handleGetConnected(): object {
  const b = getConnectedBrowser();
  return { connected: b !== null };
}
