/**
 * Unit tests: NetworkController (no Chrome / no network required)
 *
 * page.route / page.unroute are mocked with vi.fn() so Playwright
 * never touches a real browser.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NetworkController } from "../../src/network.js";
import type { Page, Route } from "playwright-core";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPage(): Page {
  return {
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

function createMockRoute(url: string, method = "GET"): Route {
  const mockReq = { url: () => url, method: () => method };
  return {
    request: () => mockReq,
    abort: vi.fn().mockResolvedValue(undefined),
    fulfill: vi.fn().mockResolvedValue(undefined),
    continue: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockRejectedValue(new Error("no network")),
  } as unknown as Route;
}

// ---------------------------------------------------------------------------
// NetworkController — no-Chrome state queries
// ---------------------------------------------------------------------------

describe("NetworkController (no Chrome)", () => {
  let nc: NetworkController;

  beforeEach(() => {
    nc = new NetworkController();
  });

  it("listRules returns empty array for unknown targetId", () => {
    expect(nc.listRules("nonexistent-tab")).toEqual([]);
  });

  it("getCaptured returns empty array for unknown targetId", () => {
    expect(nc.getCaptured("nonexistent-tab")).toEqual([]);
  });

  it("totalRules is 0 on fresh instance", () => {
    expect(nc.totalRules).toBe(0);
  });

  it("destroyTab on unknown targetId is a no-op", () => {
    expect(() => nc.destroyTab("nonexistent")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// NetworkController — with mock Page (rule management)
// ---------------------------------------------------------------------------

describe("NetworkController (mock Page)", () => {
  let nc: NetworkController;
  let page: Page;
  const TID = "mock-tab-001";

  beforeEach(() => {
    nc = new NetworkController();
    page = createMockPage();
  });

  it("addBlock registers rule and calls page.route", async () => {
    const ruleId = await nc.addBlock("**/*.png", page, TID);

    expect(ruleId).toMatch(/^rule_\d+$/);
    expect(page.route).toHaveBeenCalledOnce();
    expect(page.route).toHaveBeenCalledWith("**/*.png", expect.any(Function));
  });

  it("addBlock route handler calls route.abort()", async () => {
    await nc.addBlock("**/*.png", page, TID);

    // Extract the registered handler
    const handler = (page.route as ReturnType<typeof vi.fn>).mock.calls[0][1] as (r: Route) => Promise<void>;
    const mockRoute = createMockRoute("https://example.com/img.png");
    await handler(mockRoute);

    expect(mockRoute.abort).toHaveBeenCalledOnce();
  });

  it("addMock registers rule with correct summary", async () => {
    const ruleId = await nc.addMock(
      "**/api/data",
      { status: 404, body: "not found", contentType: "text/plain" },
      page,
      TID,
    );

    const rules = nc.listRules(TID);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(ruleId);
    expect(rules[0].pattern).toBe("**/api/data");
    expect(rules[0].type).toBe("mock");
    expect(rules[0].mock_status).toBe(404);
    expect(rules[0].captured_count).toBe(0);
  });

  it("addMock route handler calls route.fulfill with options", async () => {
    await nc.addMock("**/api/data", { status: 200, body: '{"ok":true}', contentType: "application/json" }, page, TID);

    const handler = (page.route as ReturnType<typeof vi.fn>).mock.calls[0][1] as (r: Route) => Promise<void>;
    const mockRoute = createMockRoute("https://example.com/api/data");
    await handler(mockRoute);

    expect(mockRoute.fulfill).toHaveBeenCalledWith({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });

  it("addCapture registers rule and shows in listRules", async () => {
    const ruleId = await nc.addCapture("**/api/**", page, TID);

    const rules = nc.listRules(TID);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(ruleId);
    expect(rules[0].type).toBe("capture");
    expect(rules[0].captured_count).toBe(0);
  });

  it("listRules returns all rules in insertion order", async () => {
    await nc.addBlock("**/*.png", page, TID);
    await nc.addMock("**/api", {}, page, TID);
    await nc.addCapture("**/track", page, TID);

    const rules = nc.listRules(TID);
    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.type)).toEqual(["block", "mock", "capture"]);
  });

  it("totalRules counts across all tabs", async () => {
    const page2 = createMockPage();
    await nc.addBlock("**/*.png", page, TID);
    await nc.addBlock("**/*.jpg", page2, "other-tab");

    expect(nc.totalRules).toBe(2);
  });

  it("removeRule calls page.unroute and removes from list", async () => {
    const ruleId = await nc.addBlock("**/*.png", page, TID);
    await nc.removeRule(ruleId, page, TID);

    expect(page.unroute).toHaveBeenCalledOnce();
    expect(nc.listRules(TID)).toHaveLength(0);
  });

  it("removeRule throws for unknown ruleId", async () => {
    await expect(nc.removeRule("rule_9999", page, TID)).rejects.toThrow("not found");
  });

  it("clearAll removes all rules and returns count", async () => {
    await nc.addBlock("**/*.png", page, TID);
    await nc.addMock("**/api", {}, page, TID);

    const count = await nc.clearAll(page, TID);
    expect(count).toBe(2);
    expect(nc.listRules(TID)).toHaveLength(0);
    expect(nc.totalRules).toBe(0);
  });

  it("clearAll on empty tab returns 0", async () => {
    const count = await nc.clearAll(page, TID);
    expect(count).toBe(0);
  });

  it("destroyTab clears rules without calling unroute", async () => {
    await nc.addBlock("**/*.png", page, TID);
    expect(nc.totalRules).toBe(1);

    nc.destroyTab(TID);
    expect(nc.totalRules).toBe(0);
    expect(page.unroute).not.toHaveBeenCalled();
  });

  it("getCaptured returns empty before any captures fire", async () => {
    await nc.addCapture("**/api/**", page, TID);
    expect(nc.getCaptured(TID)).toEqual([]);
  });

  it("getCaptured filters by pattern when specified", async () => {
    await nc.addCapture("**/api/**", page, TID);
    await nc.addCapture("**/track/**", page, TID);

    // No entries yet, but pattern filter should still work
    expect(nc.getCaptured(TID, "**/api/**")).toEqual([]);
    expect(nc.getCaptured(TID, "**/missing/**")).toEqual([]);
  });

  it("rules for different tabs are isolated", async () => {
    const page2 = createMockPage();
    await nc.addBlock("**/*.png", page, TID);
    await nc.addMock("**/api", {}, page2, "other-tab");

    expect(nc.listRules(TID)).toHaveLength(1);
    expect(nc.listRules("other-tab")).toHaveLength(1);
    expect(nc.listRules("third-tab")).toHaveLength(0);
  });

  it("mock rule without status falls back to 200", async () => {
    await nc.addMock("**/api", {}, page, TID);

    const handler = (page.route as ReturnType<typeof vi.fn>).mock.calls[0][1] as (r: Route) => Promise<void>;
    const mockRoute = createMockRoute("https://example.com/api");
    await handler(mockRoute);

    expect(mockRoute.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 }),
    );
  });

  it("mock_status absent when no status option provided", async () => {
    await nc.addMock("**/api", {}, page, TID);
    const rules = nc.listRules(TID);
    expect(rules[0].mock_status).toBeUndefined();
  });
});
