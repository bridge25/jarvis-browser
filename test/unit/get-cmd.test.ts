// Unit tests for get-cmd.ts (v0.7.0)
// Tests all 8 get handlers using mocked browser + locator

import { vi, describe, it, expect, beforeEach } from "vitest";

// --- Mocks ---
// vi.mock is hoisted above variable declarations, so use vi.hoisted() for shared mock objects

const { mockLocator, mockPage } = vi.hoisted(() => {
  const mockLocator = {
    textContent: vi.fn().mockResolvedValue("hello text"),
    innerHTML: vi.fn().mockResolvedValue("<b>inner</b>"),
    inputValue: vi.fn().mockResolvedValue("input val"),
    getAttribute: vi.fn().mockResolvedValue("attr-value"),
    boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 20, width: 100, height: 50 }),
    count: vi.fn().mockResolvedValue(3),
  };
  const mockPage = {
    title: vi.fn().mockResolvedValue("Test Page"),
    url: vi.fn().mockReturnValue("https://example.com/path"),
    locator: vi.fn().mockReturnValue(mockLocator),
  };
  return { mockLocator, mockPage };
});

vi.mock("../../src/browser.js", () => ({
  getPage: vi.fn().mockResolvedValue(mockPage),
  refLocator: vi.fn().mockReturnValue(mockLocator),
  getStoredRefs: vi.fn().mockReturnValue({}),
}));

import {
  handleGetText,
  handleGetHtml,
  handleGetValue,
  handleGetAttr,
  handleGetTitle,
  handleGetUrl,
  handleGetCount,
  handleGetBox,
} from "../../src/commands/get-cmd.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockLocator.textContent.mockResolvedValue("hello text");
  mockLocator.innerHTML.mockResolvedValue("<b>inner</b>");
  mockLocator.inputValue.mockResolvedValue("input val");
  mockLocator.getAttribute.mockResolvedValue("attr-value");
  mockLocator.boundingBox.mockResolvedValue({ x: 10, y: 20, width: 100, height: 50 });
  mockPage.title.mockResolvedValue("Test Page");
  mockPage.url.mockReturnValue("https://example.com/path");
});

describe("handleGetText", () => {
  it("returns text content of element", async () => {
    const result = await handleGetText({ ref: "e1" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("hello text");
  });

  it("returns empty string when textContent is null", async () => {
    mockLocator.textContent.mockResolvedValue(null);
    const result = await handleGetText({ ref: "e1" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("");
  });
});

describe("handleGetHtml", () => {
  it("returns innerHTML of element", async () => {
    const result = await handleGetHtml({ ref: "e2" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("<b>inner</b>");
  });
});

describe("handleGetValue", () => {
  it("returns input value", async () => {
    const result = await handleGetValue({ ref: "e3" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("input val");
  });
});

describe("handleGetAttr", () => {
  it("returns attribute value", async () => {
    const result = await handleGetAttr({ ref: "e4", attrName: "href" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("attr-value");
    expect(mockLocator.getAttribute).toHaveBeenCalledWith("href", expect.any(Object));
  });

  it("returns null for missing attribute", async () => {
    mockLocator.getAttribute.mockResolvedValue(null);
    const result = await handleGetAttr({ ref: "e4", attrName: "data-missing" });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe("handleGetTitle", () => {
  it("returns page title", async () => {
    const result = await handleGetTitle({});
    expect(result.ok).toBe(true);
    expect(result.data).toBe("Test Page");
  });
});

describe("handleGetUrl", () => {
  it("returns current page URL", async () => {
    const result = await handleGetUrl({});
    expect(result.ok).toBe(true);
    expect(result.data).toBe("https://example.com/path");
  });
});

describe("handleGetCount", () => {
  it("returns count of matching elements", async () => {
    const result = await handleGetCount({ selector: "button" });
    expect(result.ok).toBe(true);
    expect(result.data).toBe(3);
    expect(mockPage.locator).toHaveBeenCalledWith("button");
  });
});

describe("handleGetBox", () => {
  it("returns bounding box with x,y,w,h", async () => {
    const result = await handleGetBox({ ref: "e5" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it("returns error when element has no bounding box", async () => {
    mockLocator.boundingBox.mockResolvedValue(null);
    const result = await handleGetBox({ ref: "e5" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("e5");
    expect(result.suggestion).toBeDefined();
  });
});
