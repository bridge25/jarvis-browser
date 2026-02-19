// emulation.ts — Device emulation, viewport, geolocation, HTTP headers (v1.0.0)

import { getPage } from "../browser.js";
import { ERROR_CODES } from "../protocol.js";

// --- Device presets ---

interface DeviceDescriptor {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  userAgent: string;
}

const DEVICE_PRESETS: Record<string, DeviceDescriptor> = {
  "iPhone 14": {
    width: 390, height: 844, deviceScaleFactor: 3, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 14 Pro": {
    width: 393, height: 852, deviceScaleFactor: 3, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 12": {
    width: 390, height: 844, deviceScaleFactor: 3, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  },
  "Pixel 7": {
    width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
  },
  "Pixel 5": {
    width: 393, height: 851, deviceScaleFactor: 2.75, isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Mobile Safari/537.36",
  },
  "Galaxy S21": {
    width: 360, height: 800, deviceScaleFactor: 3, isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Mobile Safari/537.36",
  },
  "iPad Pro 11": {
    width: 834, height: 1194, deviceScaleFactor: 2, isMobile: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  },
  "Desktop Chrome": {
    width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
};

export function getDeviceList(): string[] {
  return Object.keys(DEVICE_PRESETS);
}

// --- Handlers ---

export async function handleSetDevice(params: {
  device: string;
  targetId?: string;
}): Promise<object> {
  const descriptor = DEVICE_PRESETS[params.device];
  if (!descriptor) {
    const available = Object.keys(DEVICE_PRESETS).join(", ");
    throw Object.assign(
      new Error(`Unknown device "${params.device}". Available: ${available}`),
      { rpcCode: ERROR_CODES.INVALID_PARAMS },
    );
  }

  const page = await getPage(params.targetId);
  await page.setViewportSize({ width: descriptor.width, height: descriptor.height });

  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Network.setUserAgentOverride", {
      userAgent: descriptor.userAgent,
      platform: descriptor.isMobile ? "Android" : "MacIntel",
    });
  } finally {
    await session.detach().catch(() => {});
  }

  return {
    ok: true,
    device: params.device,
    viewport: { width: descriptor.width, height: descriptor.height },
    userAgent: descriptor.userAgent,
  };
}

export async function handleSetViewport(params: {
  width?: number;
  height?: number;
  reset?: boolean;
  targetId?: string;
}): Promise<object> {
  const page = await getPage(params.targetId);

  if (params.reset) {
    await page.setViewportSize({ width: 1280, height: 800 });
    return { ok: true, reset: true, viewport: { width: 1280, height: 800 } };
  }

  if (params.width === undefined || params.height === undefined) {
    throw Object.assign(
      new Error("width and height required (or use --reset)"),
      { rpcCode: ERROR_CODES.INVALID_PARAMS },
    );
  }

  await page.setViewportSize({ width: params.width, height: params.height });
  return { ok: true, viewport: { width: params.width, height: params.height } };
}

export async function handleSetGeo(params: {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  reset?: boolean;
  targetId?: string;
}): Promise<object> {
  const page = await getPage(params.targetId);
  const context = page.context();

  if (params.reset) {
    await context.setGeolocation(null);
    return { ok: true, reset: true };
  }

  if (params.latitude === undefined || params.longitude === undefined) {
    throw Object.assign(
      new Error("latitude and longitude required (or use --reset)"),
      { rpcCode: ERROR_CODES.INVALID_PARAMS },
    );
  }

  const geo = {
    latitude: params.latitude,
    longitude: params.longitude,
    accuracy: params.accuracy ?? 10,
  };
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(geo);

  return { ok: true, geolocation: geo };
}

export async function handleSetHeaders(params: {
  headersJson?: string;
  reset?: boolean;
  targetId?: string;
}): Promise<object> {
  const page = await getPage(params.targetId);
  const context = page.context();

  if (params.reset) {
    await context.setExtraHTTPHeaders({});
    return { ok: true, reset: true };
  }

  if (!params.headersJson) {
    throw Object.assign(
      new Error("headersJson required (or use --reset)"),
      { rpcCode: ERROR_CODES.INVALID_PARAMS },
    );
  }

  let headers: Record<string, string>;
  try {
    headers = JSON.parse(params.headersJson) as Record<string, string>;
  } catch {
    throw Object.assign(
      new Error("headersJson must be valid JSON"),
      { rpcCode: ERROR_CODES.INVALID_PARAMS },
    );
  }

  await context.setExtraHTTPHeaders(headers);
  return { ok: true, headers };
}
