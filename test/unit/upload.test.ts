// Unit tests for upload.ts (v0.7.0 FM-2)
// Tests file validation, discovery, and error paths

import { vi, describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Test fixtures ---

const TMP_DIR = join(tmpdir(), "jarvis-upload-test-" + process.pid);
const REAL_FILE = join(TMP_DIR, "test-upload.txt");

// Create temp dir and file before tests
mkdirSync(TMP_DIR, { recursive: true });
writeFileSync(REAL_FILE, "test content");

// --- Mocks ---
// vi.mock is hoisted above variable declarations, so use vi.hoisted() for shared mock objects

const { mockSetInputFiles, mockLocator, mockPage } = vi.hoisted(() => {
  const mockSetInputFiles = vi.fn().mockResolvedValue(undefined);
  const mockLocator = {
    evaluate: vi.fn(),
    locator: vi.fn(),
    setInputFiles: mockSetInputFiles,
    first: vi.fn(),
  };
  mockLocator.first.mockReturnValue(mockLocator);
  mockLocator.locator.mockReturnValue(mockLocator);
  const mockPage = {
    locator: vi.fn().mockReturnValue(mockLocator),
  };
  return { mockSetInputFiles, mockLocator, mockPage };
});

vi.mock("../../src/browser.js", () => ({
  getPage: vi.fn().mockResolvedValue(mockPage),
  refLocator: vi.fn().mockReturnValue(mockLocator),
  getStoredRefs: vi.fn().mockReturnValue({}),
}));

import { handleUpload } from "../../src/upload.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockSetInputFiles.mockResolvedValue(undefined);
  mockLocator.evaluate.mockResolvedValue("input");
  mockLocator.first.mockReturnValue(mockLocator);
  mockLocator.locator.mockReturnValue(mockLocator);
  mockPage.locator.mockReturnValue(mockLocator);
});

// --- File path validation ---

describe("handleUpload — file validation", () => {
  it("returns error for missing file", async () => {
    const result = await handleUpload({
      ref: "e1",
      files: ["/nonexistent/path/file.txt"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when no ref or selector provided", async () => {
    const result = await handleUpload({ files: [REAL_FILE] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ref or --selector required");
  });

  it("accepts real existing file path", async () => {
    // ref points to file input directly
    mockLocator.evaluate
      .mockResolvedValueOnce("input")  // tagName
      .mockResolvedValueOnce("file");  // type
    const result = await handleUpload({ ref: "e1", files: [REAL_FILE] });
    // setInputFiles should have been called (or we got an ok result)
    expect(result.ok).toBe(true);
  });
});

// --- Selector mode ---

describe("handleUpload — selector mode", () => {
  it("uses CSS selector directly when provided", async () => {
    const result = await handleUpload({
      selector: 'input[type="file"]',
      files: [REAL_FILE],
    });
    expect(mockPage.locator).toHaveBeenCalledWith('input[type="file"]');
    expect(result.ok).toBe(true);
  });
});

// --- Ref-based discovery ---

describe("handleUpload — ref-based discovery", () => {
  it("returns error when no file input found near ref", async () => {
    // Not a direct file input (tagName is "button"), parent scan also fails
    // 3 evaluate calls: tagName, inputType (ignored when tagName != "input"), parent scan
    mockLocator.evaluate
      .mockResolvedValueOnce("button")  // 1: tagName → not a file input
      .mockResolvedValueOnce("")        // 2: inputType → irrelevant (tagName != "input")
      .mockResolvedValueOnce(false);    // 3: parent scan → no file input found
    const result = await handleUpload({ ref: "e2", files: [REAL_FILE] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("e2");
    expect(result.suggestion).toContain("--selector");
  });

  it("succeeds when file input found in parent", async () => {
    // Not a direct file input, but parent scan finds one
    // 3 evaluate calls: tagName, inputType (ignored), parent scan
    mockLocator.evaluate
      .mockResolvedValueOnce("button")  // 1: tagName → not a file input
      .mockResolvedValueOnce("")        // 2: inputType → irrelevant
      .mockResolvedValueOnce(true);     // 3: parent scan → found file input
    const result = await handleUpload({ ref: "e3", files: [REAL_FILE] });
    expect(result.ok).toBe(true);
  });
});
