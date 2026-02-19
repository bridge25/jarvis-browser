/**
 * Unit tests: RingBuffer and PageObserver (no Chrome / no network required)
 *
 * The mock-Page section exercises attach() + event handlers + all query
 * branches by emitting synthetic Playwright events into an EventEmitter.
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, afterEach } from "vitest";
import { RingBuffer, globalObserver } from "../../src/observer.js";
import type { Page, ConsoleMessage, Request, Response } from "playwright-core";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPage(): { page: Page; emit: (event: string, ...args: unknown[]) => void } {
  const emitter = new EventEmitter();
  const page = {
    on: (event: string, handler: (...args: unknown[]) => void) => { emitter.on(event, handler); },
    off: (event: string, handler: (...args: unknown[]) => void) => { emitter.off(event, handler); },
  } as unknown as Page;
  return { page, emit: (event, ...args) => emitter.emit(event, ...args) };
}

function mockMsg(type: string, text: string, url = "http://test.com", line = 1): ConsoleMessage {
  return {
    type: () => type,
    text: () => text,
    location: () => ({ url, lineNumber: line, columnNumber: 0 }),
  } as unknown as ConsoleMessage;
}

function mockReq(url: string, method = "GET", resourceType = "document"): Request {
  return { url: () => url, method: () => method, resourceType: () => resourceType } as unknown as Request;
}

function mockResp(req: Request, status: number): Response {
  return { request: () => req, url: () => req.url(), status: () => status } as unknown as Response;
}

// ---------------------------------------------------------------------------
// RingBuffer
// ---------------------------------------------------------------------------

describe("RingBuffer", () => {
  it("starts empty", () => {
    const buf = new RingBuffer<number>(4);
    expect(buf.size).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it("capacity is exposed", () => {
    const buf = new RingBuffer<number>(8);
    expect(buf.capacity).toBe(8);
  });

  it("stores items in insertion order", () => {
    const buf = new RingBuffer<number>(4);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.getAll()).toEqual([1, 2, 3]);
    expect(buf.size).toBe(3);
  });

  it("fills to capacity without wrapping", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.size).toBe(3);
    expect(buf.getAll()).toEqual([10, 20, 30]);
  });

  it("wraps around and evicts oldest when over capacity", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // evicts 1
    expect(buf.size).toBe(3);
    expect(buf.getAll()).toEqual([2, 3, 4]);
  });

  it("continuous wrap keeps most recent N items", () => {
    const buf = new RingBuffer<number>(3);
    Array.from({ length: 10 }, (_, k) => k + 1).forEach((n) => buf.push(n));
    expect(buf.size).toBe(3);
    expect(buf.getAll()).toEqual([8, 9, 10]);
  });

  it("getLast returns the N most recent items", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);
    expect(buf.getLast(2)).toEqual([4, 5]);
    expect(buf.getLast(3)).toEqual([3, 4, 5]);
  });

  it("getLast with n >= size returns all", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    expect(buf.getLast(10)).toEqual([1, 2]);
    expect(buf.getLast(2)).toEqual([1, 2]);
  });

  it("getLast with n=0 returns empty", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    expect(buf.getLast(0)).toEqual([]);
  });

  it("filter returns matching items", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.filter((x) => x % 2 === 0)).toEqual([2, 4]);
  });

  it("filter on empty buffer returns empty", () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.filter(() => true)).toEqual([]);
  });

  it("clear resets the buffer", () => {
    const buf = new RingBuffer<number>(4);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it("can push after clear", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    buf.push(10);
    buf.push(20);
    expect(buf.getAll()).toEqual([10, 20]);
  });

  it("works with capacity=1", () => {
    const buf = new RingBuffer<string>(1);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.size).toBe(1);
    expect(buf.getAll()).toEqual(["c"]);
    expect(buf.getLast(1)).toEqual(["c"]);
  });

  it("getAll returns oldest-first after wrap", () => {
    const buf = new RingBuffer<number>(4);
    // Push 6 items — final state should be [3,4,5,6]
    buf.push(1); buf.push(2); buf.push(3);
    buf.push(4); buf.push(5); buf.push(6);
    const all = buf.getAll();
    expect(all[0]).toBeLessThan(all[1]); // oldest first
    expect(all).toEqual([3, 4, 5, 6]);
  });
});

// ---------------------------------------------------------------------------
// PageObserver — query methods without Chrome
// ---------------------------------------------------------------------------

describe("PageObserver (no Chrome)", () => {
  it("getConsole returns empty for unknown targetId", () => {
    const result = globalObserver.getConsole("unknown-tab-xyz");
    expect(result.messages).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("getErrors returns empty array for unknown targetId", () => {
    expect(globalObserver.getErrors("unknown-tab-xyz")).toEqual([]);
  });

  it("getRequests returns empty for unknown targetId", () => {
    const result = globalObserver.getRequests("unknown-tab-xyz");
    expect(result.requests).toEqual([]);
    expect(result.pending).toBe(0);
  });

  it("getObservation returns zeroed struct for unknown targetId", () => {
    const obs = globalObserver.getObservation("unknown-tab-xyz");
    expect(obs.console_errors).toBe(0);
    expect(obs.console_warnings).toBe(0);
    expect(obs.js_exceptions).toBe(0);
    expect(obs.failed_requests).toBe(0);
    expect(obs.pending_requests).toBe(0);
  });

  it("getConsole returns empty for empty string targetId", () => {
    const result = globalObserver.getConsole("");
    expect(result.messages).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PageObserver — with mock Page (covers attach, event handlers, data paths)
// ---------------------------------------------------------------------------

describe("PageObserver (mock Page)", () => {
  // Each test uses a unique targetId; afterEach destroys to prevent leakage.
  const usedIds: string[] = [];
  afterEach(() => {
    usedIds.splice(0).forEach((id) => globalObserver.destroy(id));
  });

  function tid(suffix: string): string {
    const id = `mock-${suffix}-${Date.now()}`;
    usedIds.push(id);
    return id;
  }

  it("attach populates console buffer via 'console' event", () => {
    const id = tid("console");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("log", "hello"));
    emit("console", mockMsg("error", "boom"));
    emit("console", mockMsg("warning", "careful"));

    const { messages, total } = globalObserver.getConsole(id);
    expect(total).toBe(3);
    expect(messages).toHaveLength(3);
    expect(messages[0].text).toBe("hello");
    expect(messages[1].level).toBe("error");
  });

  it("attach is idempotent — second call is a no-op", () => {
    const id = tid("idem");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);
    globalObserver.attach(page, id); // second call ignored

    emit("console", mockMsg("log", "once"));
    expect(globalObserver.getConsole(id).total).toBe(1);
  });

  it("getConsole level filter: 'error' returns only errors", () => {
    const id = tid("lvl");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("log", "info"));
    emit("console", mockMsg("error", "err1"));
    emit("console", mockMsg("error", "err2"));

    const { messages } = globalObserver.getConsole(id, { level: "error" });
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.level === "error")).toBe(true);
  });

  it("getConsole level filter: 'warn' normalises to 'warning'", () => {
    const id = tid("warn");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("warning", "w1"));
    emit("console", mockMsg("log", "info"));

    const { messages } = globalObserver.getConsole(id, { level: "warn" });
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("w1");
  });

  it("getConsole level 'all' returns everything", () => {
    const id = tid("all");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("log", "a"));
    emit("console", mockMsg("error", "b"));

    const { messages } = globalObserver.getConsole(id, { level: "all" });
    expect(messages).toHaveLength(2);
  });

  it("getConsole last param returns N most recent", () => {
    const id = tid("last");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("log", "a"));
    emit("console", mockMsg("log", "b"));
    emit("console", mockMsg("log", "c"));

    const { messages } = globalObserver.getConsole(id, { last: 2 });
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("b");
    expect(messages[1].text).toBe("c");
  });

  it("getConsole clear flag empties the buffer", () => {
    const id = tid("clear");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("log", "x"));
    emit("console", mockMsg("log", "y"));

    const first = globalObserver.getConsole(id, { clear: true });
    expect(first.total).toBe(2);
    expect(first.messages).toHaveLength(2);

    const second = globalObserver.getConsole(id);
    expect(second.total).toBe(0);
  });

  it("pageerror event populates errors buffer", () => {
    const id = tid("errors");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    const err = Object.assign(new Error("oops"), { stack: "Error: oops\n  at test" });
    emit("pageerror", err);

    const errors = globalObserver.getErrors(id);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("oops");
    expect(errors[0].stack).toContain("oops");
  });

  it("getErrors last param limits result", () => {
    const id = tid("errlast");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("pageerror", new Error("e1"));
    emit("pageerror", new Error("e2"));
    emit("pageerror", new Error("e3"));

    expect(globalObserver.getErrors(id, { last: 2 })).toHaveLength(2);
  });

  it("request + response events populate network buffer", () => {
    const id = tid("network");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    const req = mockReq("https://api.example.com/data", "GET", "fetch");
    emit("request", req);
    emit("response", mockResp(req, 200));

    const { requests, pending } = globalObserver.getRequests(id);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.example.com/data");
    expect(requests[0].status).toBe(200);
    expect(requests[0].method).toBe("GET");
    expect(pending).toBe(0);
  });

  it("requestfailed event marks entry as failed with null status", () => {
    const id = tid("reqfail");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    const req = mockReq("https://example.com/img.png");
    emit("request", req);
    emit("requestfailed", req);

    const { requests } = globalObserver.getRequests(id);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBeNull();
    expect(requests[0].failed).toBe(true);
  });

  it("getRequests filter='failed' returns only failed entries", () => {
    const id = tid("failed");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    const req1 = mockReq("https://ok.com/");
    const req2 = mockReq("https://fail.com/");
    emit("request", req1); emit("response", mockResp(req1, 200));
    emit("request", req2); emit("requestfailed", req2);

    const { requests } = globalObserver.getRequests(id, { filter: "failed" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://fail.com/");
  });

  it("getRequests filter='api' returns fetch/xhr only", () => {
    const id = tid("api");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    const apiReq = mockReq("https://api.com/data", "POST", "fetch");
    const docReq = mockReq("https://site.com/page", "GET", "document");
    emit("request", apiReq); emit("response", mockResp(apiReq, 200));
    emit("request", docReq); emit("response", mockResp(docReq, 200));

    const { requests } = globalObserver.getRequests(id, { filter: "api" });
    expect(requests).toHaveLength(1);
    expect(requests[0].resource_type).toBe("fetch");
  });

  it("getRequests urlPattern glob filter works", () => {
    const id = tid("url");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    const r1 = mockReq("https://api.example.com/users");
    const r2 = mockReq("https://api.example.com/posts");
    const r3 = mockReq("https://cdn.example.com/img.png");
    emit("request", r1); emit("response", mockResp(r1, 200));
    emit("request", r2); emit("response", mockResp(r2, 200));
    emit("request", r3); emit("response", mockResp(r3, 200));

    const { requests } = globalObserver.getRequests(id, { urlPattern: "*/api.example.com/*" });
    expect(requests).toHaveLength(2);
  });

  it("getObservation counts console errors, warnings, exceptions, failed", () => {
    const id = tid("obs");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("error", "e1"));
    emit("console", mockMsg("error", "e2"));
    emit("console", mockMsg("warning", "w1"));
    emit("pageerror", new Error("exc"));
    const failReq = mockReq("https://fail.com/");
    emit("request", failReq); emit("requestfailed", failReq);

    const obs = globalObserver.getObservation(id);
    expect(obs.console_errors).toBe(2);
    expect(obs.console_warnings).toBe(1);
    expect(obs.js_exceptions).toBe(1);
    expect(obs.failed_requests).toBe(1);
    expect(obs.pending_requests).toBe(0);
  });

  it("getObservation pending_requests counts in-flight requests", () => {
    const id = tid("pending");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("request", mockReq("https://slow.com/"));
    emit("request", mockReq("https://slow2.com/"));
    // No response emitted — both are pending

    expect(globalObserver.getObservation(id).pending_requests).toBe(2);
  });

  it("destroy removes buffered data", () => {
    const id = tid("destroy");
    const { page, emit } = createMockPage();
    globalObserver.attach(page, id);

    emit("console", mockMsg("log", "data"));
    expect(globalObserver.getConsole(id).total).toBe(1);

    globalObserver.destroy(id);
    // After destroy, behaves as if unknown targetId
    expect(globalObserver.getConsole(id).total).toBe(0);
    usedIds.pop(); // already destroyed, remove from afterEach list
  });

  // -------------------------------------------------------------------------
  // Snapshot tracking (recordSnapshot / getSnapshotAge)
  // -------------------------------------------------------------------------

  it("getSnapshotAge returns null before any snapshot", () => {
    const id = tid("snap-null");
    const { page } = createMockPage();
    globalObserver.attach(page, id);
    expect(globalObserver.getSnapshotAge(id)).toBeNull();
  });

  it("getSnapshotAge returns null for unknown targetId", () => {
    expect(globalObserver.getSnapshotAge("never-attached")).toBeNull();
  });

  it("recordSnapshot + getSnapshotAge returns fresh age", () => {
    const id = tid("snap-fresh");
    const { page } = createMockPage();
    globalObserver.attach(page, id);

    globalObserver.recordSnapshot(id);
    const age = globalObserver.getSnapshotAge(id);
    if (age === null) throw new Error("expected snapshot age to be non-null");
    expect(age.age_s).toBeLessThan(5);
    expect(age.stale).toBe(false);
  });

  it("destroy clears snapshot time", () => {
    const id = tid("snap-destroy");
    const { page } = createMockPage();
    globalObserver.attach(page, id);

    globalObserver.recordSnapshot(id);
    expect(globalObserver.getSnapshotAge(id)).not.toBeNull();

    globalObserver.destroy(id);
    expect(globalObserver.getSnapshotAge(id)).toBeNull();
    usedIds.pop(); // already destroyed, remove from afterEach list
  });
});
