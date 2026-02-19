import { describe, it, expect } from "vitest";
import {
  ERROR_CODES,
  METHODS,
  makeRequest,
  makeResponse,
  makeErrorResponse,
  isRpcError,
  validateRequest,
} from "../../src/protocol.js";

describe("ERROR_CODES", () => {
  it("has correct JSON-RPC standard codes", () => {
    expect(ERROR_CODES.PARSE_ERROR).toBe(-32700);
    expect(ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
  });

  it("has correct domain-specific codes", () => {
    expect(ERROR_CODES.BROWSER_NOT_CONNECTED).toBe(-32001);
    expect(ERROR_CODES.TAB_NOT_FOUND).toBe(-32002);
    expect(ERROR_CODES.REF_NOT_FOUND).toBe(-32003);
    expect(ERROR_CODES.ACTION_FAILED).toBe(-32004);
    expect(ERROR_CODES.NAVIGATION_FAILED).toBe(-32005);
    expect(ERROR_CODES.TIMEOUT).toBe(-32006);
    expect(ERROR_CODES.SECURITY_VIOLATION).toBe(-32007);
    expect(ERROR_CODES.TAB_OWNED_BY_OTHER).toBe(-32008);
  });
});

describe("METHODS", () => {
  it("contains connection methods", () => {
    expect(METHODS.STATUS).toBe("status");
    expect(METHODS.LAUNCH).toBe("launch");
    expect(METHODS.CONNECT).toBe("connect");
    expect(METHODS.STOP).toBe("stop");
  });

  it("contains tab methods", () => {
    expect(METHODS.TABS).toBe("tabs");
    expect(METHODS.OPEN).toBe("open");
    expect(METHODS.CLOSE).toBe("close");
    expect(METHODS.FOCUS).toBe("focus");
  });

  it("contains daemon management methods", () => {
    expect(METHODS.DAEMON_STATUS).toBe("daemon.status");
    expect(METHODS.DAEMON_HEALTH).toBe("daemon.health");
    expect(METHODS.DAEMON_STOP).toBe("daemon.stop");
  });
});

describe("makeRequest", () => {
  it("creates a valid JSON-RPC 2.0 request without params", () => {
    const req = makeRequest(1, "status");
    expect(req.jsonrpc).toBe("2.0");
    expect(req.id).toBe(1);
    expect(req.method).toBe("status");
    expect(req.params).toBeUndefined();
  });

  it("creates a request with params", () => {
    const req = makeRequest("abc", "navigate", { url: "https://example.com" });
    expect(req.jsonrpc).toBe("2.0");
    expect(req.id).toBe("abc");
    expect(req.method).toBe("navigate");
    expect(req.params).toEqual({ url: "https://example.com" });
  });

  it("omits params key entirely when undefined", () => {
    const req = makeRequest(1, "tabs");
    expect(Object.keys(req)).not.toContain("params");
  });
});

describe("makeResponse", () => {
  it("creates a success response", () => {
    const resp = makeResponse(42, { ok: true });
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(42);
    expect(resp.result).toEqual({ ok: true });
    expect(resp).not.toHaveProperty("error");
  });

  it("preserves null result", () => {
    const resp = makeResponse(1, null);
    expect(resp.result).toBeNull();
  });
});

describe("makeErrorResponse", () => {
  it("creates an error response without data", () => {
    const resp = makeErrorResponse(1, -32601, "Method not found");
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.error.code).toBe(-32601);
    expect(resp.error.message).toBe("Method not found");
    expect(resp.error.data).toBeUndefined();
  });

  it("creates an error response with data", () => {
    const resp = makeErrorResponse(2, -32001, "Browser not connected", { hint: "run launch first" });
    expect(resp.error.data).toEqual({ hint: "run launch first" });
  });

  it("accepts null id (for parse errors before id is known)", () => {
    const resp = makeErrorResponse(null, -32700, "Parse error");
    expect(resp.id).toBeNull();
  });

  it("omits data key when not provided", () => {
    const resp = makeErrorResponse(1, -32600, "Invalid request");
    expect(Object.keys(resp.error)).not.toContain("data");
  });
});

describe("isRpcError", () => {
  it("returns true for error responses", () => {
    const resp = makeErrorResponse(1, -32601, "Not found");
    expect(isRpcError(resp)).toBe(true);
  });

  it("returns false for success responses", () => {
    const resp = makeResponse(1, { ok: true });
    expect(isRpcError(resp)).toBe(false);
  });
});

describe("validateRequest", () => {
  it("accepts a valid request", () => {
    const obj = { jsonrpc: "2.0", id: 1, method: "status" };
    const result = validateRequest(obj);
    expect(result).not.toBeNull();
    expect(result?.method).toBe("status");
  });

  it("accepts a request with params", () => {
    const obj = { jsonrpc: "2.0", id: "req-1", method: "navigate", params: { url: "https://x.com" } };
    expect(validateRequest(obj)).not.toBeNull();
  });

  it("rejects non-object", () => {
    expect(validateRequest("string")).toBeNull();
    expect(validateRequest(42)).toBeNull();
    expect(validateRequest(null)).toBeNull();
  });

  it("rejects wrong jsonrpc version", () => {
    expect(validateRequest({ jsonrpc: "1.0", id: 1, method: "status" })).toBeNull();
    expect(validateRequest({ jsonrpc: "2.1", id: 1, method: "status" })).toBeNull();
  });

  it("rejects missing method", () => {
    expect(validateRequest({ jsonrpc: "2.0", id: 1 })).toBeNull();
  });

  it("rejects non-string method", () => {
    expect(validateRequest({ jsonrpc: "2.0", id: 1, method: 42 })).toBeNull();
  });

  it("rejects missing or null id", () => {
    expect(validateRequest({ jsonrpc: "2.0", method: "status" })).toBeNull();
    expect(validateRequest({ jsonrpc: "2.0", id: null, method: "status" })).toBeNull();
  });
});
