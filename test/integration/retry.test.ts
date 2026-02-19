// Integration tests for config.* RPC handlers and retry graceful failure
// No Chrome connection required — tests handlers and in-memory config I/O

import { vi, describe, it, expect, beforeEach } from "vitest";

// Hoist mocks before imports
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
  handleConfigGet,
  handleConfigSet,
  handleConfigList,
  handleConfigReset,
} from "../../src/commands/config-cmd.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockExistsSync = vi.mocked(existsSync);

// In-memory config store so set→get roundtrip works
function setupInMemoryStore(): void {
  let storedConfig: string | null = null;

  mockExistsSync.mockImplementation(() => storedConfig !== null);
  mockReadFile.mockImplementation(async () => {
    if (storedConfig) return storedConfig as unknown as Buffer;
    throw new Error("ENOENT");
  });
  mockWriteFile.mockImplementation(async (_path: unknown, content: unknown) => {
    storedConfig = content as string;
  });
}

describe("config.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it("returns default value for known key", async () => {
    const result = (await handleConfigGet({ key: "auto-retry" })) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.key).toBe("auto-retry");
    expect(result.value).toBe(false);
  });

  it("returns default numeric value", async () => {
    const result = (await handleConfigGet({ key: "retry-count" })) as Record<string, unknown>;
    expect(result.value).toBe(2);
  });

  it("returns default string value", async () => {
    const result = (await handleConfigGet({ key: "screenshot-dir" })) as Record<string, unknown>;
    expect(result.value).toBe("/tmp");
  });

  it("throws on unknown key", async () => {
    await expect(handleConfigGet({ key: "unknown-key" })).rejects.toThrow("Unknown config key");
  });

  it("throws on empty key", async () => {
    await expect(handleConfigGet({ key: "" })).rejects.toThrow("key is required");
  });
});

describe("config.set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInMemoryStore();
  });

  it("sets boolean value and returns updated value", async () => {
    const result = (await handleConfigSet({ key: "auto-retry", value: "true" })) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(true);
    expect(result.key).toBe("auto-retry");
    expect(result.value).toBe(true);
  });

  it("sets numeric value", async () => {
    const result = (await handleConfigSet({ key: "retry-count", value: "5" })) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(true);
    expect(result.value).toBe(5);
  });

  it("persists across subsequent get", async () => {
    await handleConfigSet({ key: "retry-count", value: "9" });
    const getResult = (await handleConfigGet({ key: "retry-count" })) as Record<string, unknown>;
    expect(getResult.value).toBe(9);
  });

  it("throws on unknown key", async () => {
    await expect(handleConfigSet({ key: "bad-key", value: "1" })).rejects.toThrow(
      "Unknown config key",
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("throws on invalid boolean value", async () => {
    await expect(handleConfigSet({ key: "auto-retry", value: "yes" })).rejects.toThrow(
      "must be true/false",
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("config.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it("returns all 12 config keys", async () => {
    const result = (await handleConfigList()) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.defaults).toBeDefined();
    const entries = result.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(12);
  });

  it("marks unmodified keys as modified=false", async () => {
    const result = (await handleConfigList()) as Record<string, unknown>;
    const entries = result.entries as Array<Record<string, unknown>>;
    for (const entry of entries) {
      expect(entry.modified).toBe(false);
    }
  });

  it("marks modified keys correctly after set", async () => {
    setupInMemoryStore();
    await handleConfigSet({ key: "auto-retry", value: "true" });
    const result = (await handleConfigList()) as Record<string, unknown>;
    const entries = result.entries as Array<Record<string, unknown>>;
    const autoRetryEntry = entries.find((e) => e.key === "auto-retry");
    expect(autoRetryEntry?.modified).toBe(true);
    expect(autoRetryEntry?.value).toBe(true);
  });
});

describe("config.reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInMemoryStore();
  });

  it("resets config and returns defaults in response", async () => {
    // First set a value
    await handleConfigSet({ key: "auto-retry", value: "true" });
    // Then reset
    const result = (await handleConfigReset()) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    const config = result.config as Record<string, unknown>;
    expect(config["auto-retry"]).toBe(false);
    expect(config["retry-count"]).toBe(2);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("reverts previously set values", async () => {
    await handleConfigSet({ key: "retry-count", value: "99" });
    await handleConfigReset();
    const result = (await handleConfigGet({ key: "retry-count" })) as Record<string, unknown>;
    expect(result.value).toBe(2);
  });
});

// --- Retry graceful failure without Chrome ---

describe("withRetry without page — fail-fast", () => {
  it("fails fast on first error when page=undefined", async () => {
    const { withRetry } = await import("../../src/retry.js");
    const action = vi.fn().mockRejectedValue(new Error("Unknown ref e5"));
    await expect(withRetry(action, { maxRetries: 3, delayMs: 0 })).rejects.toThrow("Unknown ref e5");
    expect(action).toHaveBeenCalledOnce(); // no retries
  });

  it("still fails fast on unknown error regardless of page", async () => {
    const { withRetry } = await import("../../src/retry.js");
    const mockPage = {
      url: vi.fn().mockReturnValue("https://example.com"),
      mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    };
    const action = vi.fn().mockRejectedValue(new Error("Page crashed unexpectedly"));
    await expect(
      withRetry(action, { page: mockPage as never, maxRetries: 3, delayMs: 0 }),
    ).rejects.toThrow("Page crashed");
    expect(action).toHaveBeenCalledOnce();
  });
});
