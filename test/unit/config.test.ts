// Unit tests for config.ts
// Tests pure functions and mocked I/O

import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.mock calls are hoisted — must appear before imports of mocked modules
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  readConfig,
  setConfigValue,
  resetConfig,
  isValidConfigKey,
  getDefaults,
} from "../../src/config.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockExistsSync = vi.mocked(existsSync);

describe("isValidConfigKey", () => {
  it("accepts all valid keys", () => {
    expect(isValidConfigKey("auto-retry")).toBe(true);
    expect(isValidConfigKey("retry-count")).toBe(true);
    expect(isValidConfigKey("retry-delay-ms")).toBe(true);
    expect(isValidConfigKey("default-timeout-ms")).toBe(true);
    expect(isValidConfigKey("screenshot-dir")).toBe(true);
    expect(isValidConfigKey("console-buffer-size")).toBe(true);
    expect(isValidConfigKey("network-buffer-size")).toBe(true);
    expect(isValidConfigKey("daemon-idle-timeout-m")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isValidConfigKey("foo")).toBe(false);
    expect(isValidConfigKey("")).toBe(false);
    expect(isValidConfigKey("auto_retry")).toBe(false);
    expect(isValidConfigKey("AUTO-RETRY")).toBe(false);
  });
});

describe("getDefaults", () => {
  it("returns separate object on each call (immutability)", () => {
    const d1 = getDefaults();
    const d2 = getDefaults();
    expect(d1).toEqual(d2);
    expect(d1).not.toBe(d2);
  });

  it("has expected default values", () => {
    const d = getDefaults();
    expect(d["auto-retry"]).toBe(false);
    expect(d["retry-count"]).toBe(2);
    expect(d["retry-delay-ms"]).toBe(500);
    expect(d["default-timeout-ms"]).toBe(10000);
    expect(d["screenshot-dir"]).toBe("/tmp");
    expect(d["console-buffer-size"]).toBe(500);
    expect(d["network-buffer-size"]).toBe(200);
    expect(d["daemon-idle-timeout-m"]).toBe(30);
  });
});

describe("readConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when config file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const config = await readConfig();
    expect(config["auto-retry"]).toBe(false);
    expect(config["retry-count"]).toBe(2);
    expect(config["retry-delay-ms"]).toBe(500);
  });

  it("merges file config with defaults", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ "auto-retry": true, "retry-count": 5 }) as unknown as Buffer,
    );
    const config = await readConfig();
    expect(config["auto-retry"]).toBe(true);
    expect(config["retry-count"]).toBe(5);
    expect(config["retry-delay-ms"]).toBe(500); // default preserved
    expect(config["default-timeout-ms"]).toBe(10000); // default preserved
  });

  it("returns defaults on JSON parse error", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue("invalid json" as unknown as Buffer);
    const config = await readConfig();
    expect(config["auto-retry"]).toBe(false);
    expect(config["retry-count"]).toBe(2);
  });

  it("returns defaults on readFile error", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockRejectedValue(new Error("Permission denied"));
    const config = await readConfig();
    expect(config["auto-retry"]).toBe(false);
  });
});

describe("setConfigValue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
  });

  it("sets boolean true", async () => {
    await setConfigValue("auto-retry", "true");
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(written["auto-retry"]).toBe(true);
  });

  it("sets boolean with '1'", async () => {
    await setConfigValue("auto-retry", "1");
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(written["auto-retry"]).toBe(true);
  });

  it("sets boolean false with '0'", async () => {
    await setConfigValue("auto-retry", "0");
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(written["auto-retry"]).toBe(false);
  });

  it("sets numeric value", async () => {
    await setConfigValue("retry-count", "7");
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(written["retry-count"]).toBe(7);
  });

  it("sets string value", async () => {
    await setConfigValue("screenshot-dir", "/var/screenshots");
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(written["screenshot-dir"]).toBe("/var/screenshots");
  });

  it("throws on invalid boolean value", async () => {
    await expect(setConfigValue("auto-retry", "yes")).rejects.toThrow(
      'Value for "auto-retry" must be true/false',
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("throws on non-numeric value for number key", async () => {
    await expect(setConfigValue("retry-count", "abc")).rejects.toThrow(
      'Value for "retry-count" must be a number',
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("resetConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined as unknown as void);
  });

  it("writes defaults to file", async () => {
    await resetConfig();
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(written["auto-retry"]).toBe(false);
    expect(written["retry-count"]).toBe(2);
    expect(written["retry-delay-ms"]).toBe(500);
    expect(written["default-timeout-ms"]).toBe(10000);
  });

  it("resets all 12 keys", async () => {
    await resetConfig();
    const written = JSON.parse((mockWriteFile.mock.calls[0]?.[1] ?? "{}") as string);
    expect(Object.keys(written)).toHaveLength(12);
  });
});
