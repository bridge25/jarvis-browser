// Unit tests for shared.ts v0.7.0 additions: formatOutput + errorResult

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatOutput, errorResult } from "../../src/shared.js";
import type { ActionResult } from "../../src/types.js";

// Capture stdout/stderr for assertions
function captureStreams() {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { out.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { err.push(String(chunk)); return true; });
  return {
    out,
    err,
    restore: () => { process.stdout.write = origOut; process.stderr.write = origErr; },
  };
}

describe("formatOutput — json mode (--json flag)", () => {
  it("outputs full envelope for ok result", () => {
    const { out, restore } = captureStreams();
    try {
      const result: ActionResult = { ok: true, data: "hello" };
      formatOutput(result, true);
      expect(out.join("")).toBe(JSON.stringify(result) + "\n");
    } finally { restore(); }
  });

  it("outputs full envelope for error result", () => {
    const { out, restore } = captureStreams();
    try {
      const result: ActionResult = { ok: false, error: "something failed", suggestion: "try again" };
      formatOutput(result, true);
      expect(out.join("")).toBe(JSON.stringify(result) + "\n");
    } finally { restore(); }
  });
});

describe("formatOutput — human-readable mode (no --json)", () => {
  it("outputs string data directly to stdout", () => {
    const { out, restore } = captureStreams();
    try {
      formatOutput({ ok: true, data: "page title" }, false);
      expect(out.join("")).toBe("page title\n");
    } finally { restore(); }
  });

  it("outputs boolean data as string", () => {
    const { out, restore } = captureStreams();
    try {
      formatOutput({ ok: true, data: true }, false);
      expect(out.join("")).toBe("true\n");
    } finally { restore(); }
  });

  it("outputs number data as string", () => {
    const { out, restore } = captureStreams();
    try {
      formatOutput({ ok: true, data: 42 }, false);
      expect(out.join("")).toBe("42\n");
    } finally { restore(); }
  });

  it("outputs object data as pretty JSON", () => {
    const { out, restore } = captureStreams();
    try {
      formatOutput({ ok: true, data: { x: 1, y: 2 } }, false);
      expect(out.join("")).toBe(JSON.stringify({ x: 1, y: 2 }, null, 2) + "\n");
    } finally { restore(); }
  });

  it("outputs message when no data", () => {
    const { out, restore } = captureStreams();
    try {
      formatOutput({ ok: true, message: "Done" }, false);
      expect(out.join("")).toBe("Done\n");
    } finally { restore(); }
  });

  it("outputs error to stderr", () => {
    const { err, restore } = captureStreams();
    try {
      formatOutput({ ok: false, error: "Element not found" }, false);
      expect(err.join("")).toContain("Element not found");
    } finally { restore(); }
  });

  it("outputs suggestion to stderr when present", () => {
    const { err, restore } = captureStreams();
    try {
      formatOutput({ ok: false, error: "Timeout", suggestion: "Run snapshot first" }, false);
      const combined = err.join("");
      expect(combined).toContain("Timeout");
      expect(combined).toContain("Run snapshot first");
    } finally { restore(); }
  });
});

describe("errorResult", () => {
  it("wraps Error object", () => {
    const result = errorResult(new Error("boom"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("wraps string error", () => {
    const result = errorResult("plain string error");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("plain string error");
  });

  it("includes suggestion when provided", () => {
    const result = errorResult(new Error("fail"), "try X instead");
    expect(result.suggestion).toBe("try X instead");
  });

  it("omits suggestion when not provided", () => {
    const result = errorResult(new Error("fail"));
    expect(result.suggestion).toBeUndefined();
  });
});
