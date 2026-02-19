import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  normalizeTimeoutMs,
  validateNavigationUrl,
  validateNavigationUrlPermissive,
  validateScreenshotPath,
  jsonOutput,
  textOutput,
  fileOutput,
} from "../../src/shared.js";

afterEach(() => {
  delete process.env.JARVIS_ALLOW_PRIVATE;
});

describe("normalizeTimeoutMs", () => {
  it("returns the value when within valid range", () => {
    expect(normalizeTimeoutMs(5000, 30000)).toBe(5000);
    expect(normalizeTimeoutMs(500, 30000)).toBe(500);
    expect(normalizeTimeoutMs(120_000, 30000)).toBe(120_000);
  });

  it("clamps below minimum to 500ms", () => {
    expect(normalizeTimeoutMs(0, 30000)).toBe(500);
    expect(normalizeTimeoutMs(100, 30000)).toBe(500);
    expect(normalizeTimeoutMs(-1000, 30000)).toBe(500);
  });

  it("clamps above maximum to 120_000ms", () => {
    expect(normalizeTimeoutMs(200_000, 30000)).toBe(120_000);
    expect(normalizeTimeoutMs(Infinity, 30000)).toBe(120_000);
  });

  it("uses fallback when timeoutMs is undefined", () => {
    expect(normalizeTimeoutMs(undefined, 30000)).toBe(30000);
    expect(normalizeTimeoutMs(undefined, 5000)).toBe(5000);
  });

  it("clamps fallback to valid range too", () => {
    expect(normalizeTimeoutMs(undefined, 0)).toBe(500);
    expect(normalizeTimeoutMs(undefined, 999_999)).toBe(120_000);
  });
});

describe("validateNavigationUrl", () => {
  it("allows http URLs", () => {
    expect(() => validateNavigationUrl("http://example.com")).not.toThrow();
    expect(() => validateNavigationUrl("http://example.com/path?q=1")).not.toThrow();
  });

  it("allows https URLs", () => {
    expect(() => validateNavigationUrl("https://github.com")).not.toThrow();
  });

  it("allows about: URLs", () => {
    expect(() => validateNavigationUrl("about:blank")).not.toThrow();
  });

  it("blocks file: scheme", () => {
    expect(() => validateNavigationUrl("file:///etc/passwd")).toThrow(/Blocked URL scheme/);
  });

  it("blocks javascript: scheme", () => {
    expect(() => validateNavigationUrl("javascript:alert(1)")).toThrow(/Blocked URL scheme/);
  });

  it("blocks ftp: scheme", () => {
    expect(() => validateNavigationUrl("ftp://example.com/file")).toThrow(/Blocked URL scheme/);
  });

  it("blocks AWS metadata endpoint", () => {
    expect(() => validateNavigationUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
      /Blocked URL host/,
    );
  });

  it("blocks GCP metadata endpoint", () => {
    expect(() => validateNavigationUrl("http://metadata.google.internal/computeMetadata/v1/")).toThrow(
      /Blocked URL host/,
    );
  });

  it("blocks Alibaba metadata endpoint", () => {
    expect(() => validateNavigationUrl("http://100.100.100.200/latest/meta-data/")).toThrow(
      /Blocked URL host/,
    );
  });

  it("blocks localhost", () => {
    expect(() => validateNavigationUrl("http://localhost:3000")).toThrow(/Blocked private\/local URL/);
  });

  it("blocks 127.0.0.1", () => {
    expect(() => validateNavigationUrl("http://127.0.0.1:8080")).toThrow(/Blocked private\/local URL/);
  });

  it("blocks private 192.168.x.x range", () => {
    expect(() => validateNavigationUrl("http://192.168.1.100")).toThrow(/Blocked private\/local URL/);
  });

  it("blocks private 10.x.x.x range", () => {
    expect(() => validateNavigationUrl("http://10.0.0.1")).toThrow(/Blocked private\/local URL/);
  });

  it("blocks private 172.16-31.x.x range", () => {
    expect(() => validateNavigationUrl("http://172.16.0.1")).toThrow(/Blocked private\/local URL/);
    expect(() => validateNavigationUrl("http://172.31.255.255")).toThrow(/Blocked private\/local URL/);
  });

  it("does NOT block 172.15.x.x (just outside range)", () => {
    expect(() => validateNavigationUrl("http://172.15.0.1")).not.toThrow();
  });

  it("throws on invalid URL", () => {
    expect(() => validateNavigationUrl("not a url")).toThrow(/Invalid URL/);
    expect(() => validateNavigationUrl("")).toThrow(/Invalid URL/);
  });
});

describe("validateNavigationUrlPermissive", () => {
  it("blocks private IPs without JARVIS_ALLOW_PRIVATE", () => {
    expect(() => validateNavigationUrlPermissive("http://localhost:3000")).toThrow(
      /Blocked private\/local URL/,
    );
  });

  it("allows private IPs with JARVIS_ALLOW_PRIVATE=1", () => {
    process.env.JARVIS_ALLOW_PRIVATE = "1";
    expect(() => validateNavigationUrlPermissive("http://localhost:3000")).not.toThrow();
    expect(() => validateNavigationUrlPermissive("http://192.168.1.1")).not.toThrow();
    expect(() => validateNavigationUrlPermissive("http://10.0.0.1")).not.toThrow();
  });

  it("still blocks cloud metadata with JARVIS_ALLOW_PRIVATE=1", () => {
    process.env.JARVIS_ALLOW_PRIVATE = "1";
    expect(() => validateNavigationUrlPermissive("http://169.254.169.254/meta")).toThrow(
      /Blocked cloud metadata host/,
    );
  });

  it("still blocks bad schemes with JARVIS_ALLOW_PRIVATE=1", () => {
    process.env.JARVIS_ALLOW_PRIVATE = "1";
    expect(() => validateNavigationUrlPermissive("file:///etc/passwd")).toThrow(/Blocked URL scheme/);
  });

  it("allows public https without env var", () => {
    expect(() => validateNavigationUrlPermissive("https://example.com")).not.toThrow();
  });
});

describe("validateScreenshotPath", () => {
  it("allows paths under /tmp", () => {
    // /tmp is always in the allowed list (resolves to /private/tmp on macOS)
    expect(() => validateScreenshotPath("/tmp/test-screenshot.png")).not.toThrow();
  });

  it("returns the resolved absolute path", () => {
    const result = validateScreenshotPath("/tmp/jarvis-test.png");
    expect(result).toMatch(/test\.png$/);
    // Should be absolute
    expect(result.startsWith("/")).toBe(true);
  });

  it("blocks paths outside /tmp", () => {
    expect(() => validateScreenshotPath("/var/screenshot.png")).toThrow(
      /outside allowed directories/,
    );
  });

  it("blocks home directory paths", () => {
    expect(() => validateScreenshotPath(`${process.env.HOME}/screenshot.png`)).toThrow(
      /outside allowed directories/,
    );
  });

  it("blocks path traversal attempts", () => {
    // /tmp/../etc/passwd resolves to /etc/passwd which is outside /tmp
    expect(() => validateScreenshotPath("/tmp/../etc/passwd")).toThrow(
      /outside allowed directories/,
    );
  });
});

describe("jsonOutput", () => {
  it("writes pretty-printed JSON followed by newline to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      jsonOutput({ key: "value", n: 42 });
      expect(spy).toHaveBeenCalledOnce();
      const written = (spy.mock.calls[0]?.[0] ?? "") as string;
      expect(written).toBe(JSON.stringify({ key: "value", n: 42 }, null, 2) + "\n");
    } finally {
      spy.mockRestore();
    }
  });

  it("handles null and arrays", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      jsonOutput([1, 2, 3]);
      const written = (spy.mock.calls[0]?.[0] ?? "") as string;
      expect(written).toContain("[");
      expect(written).toContain("1");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("textOutput", () => {
  it("writes text followed by newline to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      textOutput("hello world");
      expect(spy).toHaveBeenCalledWith("hello world\n");
    } finally {
      spy.mockRestore();
    }
  });

  it("handles empty string", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      textOutput("");
      expect(spy).toHaveBeenCalledWith("\n");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("fileOutput", () => {
  const TEST_FILE = "/tmp/jarvis-fileoutput-test.txt";

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it("writes content to file and prints metadata to stdout", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      fileOutput(TEST_FILE, "test content");
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(TEST_FILE)).toBe(true);
    expect(readFileSync(TEST_FILE, "utf-8")).toBe("test content");
  });

  it("stdout metadata includes ok, message, file, bytes", () => {
    const captured: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      captured.push(s as string);
      return true;
    });
    try {
      fileOutput(TEST_FILE, "hello");
    } finally {
      spy.mockRestore();
    }
    const meta = JSON.parse(captured[0] ?? "{}") as Record<string, unknown>;
    expect(meta.ok).toBe(true);
    expect(typeof meta.message).toBe("string");
    expect(meta.file).toContain("jarvis-fileoutput-test.txt");
    expect(typeof meta.bytes).toBe("number");
  });

  it("passes extra meta fields through to stdout", () => {
    const captured: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      captured.push(s as string);
      return true;
    });
    try {
      fileOutput(TEST_FILE, "data", { refs: 5, lines: 10 });
    } finally {
      spy.mockRestore();
    }
    const meta = JSON.parse(captured[0] ?? "{}") as Record<string, unknown>;
    expect(meta.refs).toBe(5);
    expect(meta.lines).toBe(10);
  });

  it("throws when output path is outside allowed directories", () => {
    expect(() => fileOutput("/etc/not-allowed.txt", "content")).toThrow(
      /outside allowed directories/,
    );
  });
});
