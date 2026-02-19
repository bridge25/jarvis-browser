// JSON-RPC 2.0 protocol definitions for jarvis-browser daemon
// Transport: Unix Domain Socket, newline-delimited frames

export const ERROR_CODES = {
  PARSE_ERROR: -32700,         // Invalid JSON received
  INVALID_REQUEST: -32600,     // Invalid Request object
  METHOD_NOT_FOUND: -32601,    // Unknown method
  INVALID_PARAMS: -32602,      // Invalid method parameters
  BROWSER_NOT_CONNECTED: -32001, // Chrome CDP not connected
  TAB_NOT_FOUND: -32002,       // Target tab does not exist
  REF_NOT_FOUND: -32003,       // Element ref not in cache
  ACTION_FAILED: -32004,       // Element not interactable
  NAVIGATION_FAILED: -32005,   // Page navigation error
  TIMEOUT: -32006,             // Operation timed out
  SECURITY_VIOLATION: -32007,  // Blocked URL or path
  TAB_OWNED_BY_OTHER: -32008,  // Tab claimed by another worker
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// All supported RPC method names
export const METHODS = {
  // Connection
  STATUS: "status",
  LAUNCH: "launch",
  CONNECT: "connect",
  STOP: "stop",
  // Tabs
  TABS: "tabs",
  OPEN: "open",
  CLOSE: "close",
  FOCUS: "focus",
  CLEANUP: "cleanup",
  // Navigation
  NAVIGATE: "navigate",
  RELOAD: "reload",
  BACK: "back",
  FORWARD: "forward",
  // Snapshot
  SNAPSHOT: "snapshot",
  // Interaction
  CLICK: "click",
  TYPE: "type",
  FILL: "fill",
  SELECT: "select",
  CHECK: "check",
  HOVER: "hover",
  DRAG: "drag",
  SCROLL: "scroll",
  PRESS: "press",
  // Wait
  WAIT: "wait",
  // Data
  SCREENSHOT: "screenshot",
  EVALUATE: "evaluate",
  TEXT: "text",
  ATTRIBUTE: "attribute",
  // Cookies
  COOKIES: "cookies",
  SET_COOKIE: "set-cookie",
  CLEAR_COOKIES: "clear-cookies",
  // Batch
  BATCH: "batch",
  // Daemon management (v0.3.0)
  DAEMON_STATUS: "daemon.status",
  DAEMON_HEALTH: "daemon.health",
  DAEMON_STOP: "daemon.stop",
  // Observer (v0.4.0)
  CONSOLE: "console",
  ERRORS: "errors",
  REQUESTS: "requests",
  OBSERVE: "observe",
  PAGE_INFO: "page-info",
  // Config (v0.6.0)
  CONFIG_GET: "config.get",
  CONFIG_SET: "config.set",
  CONFIG_LIST: "config.list",
  CONFIG_RESET: "config.reset",
  // v1.0.0: Emulation
  SET_DEVICE: "set.device",
  SET_VIEWPORT: "set.viewport",
  SET_GEO: "set.geo",
  SET_HEADERS: "set.headers",
  // v1.0.0: PDF
  PDF: "pdf",
  // v1.0.0: Recording
  RECORD_START: "record.start",
  RECORD_STOP: "record.stop",
  RECORD_STATUS: "record.status",
} as const;

export type Method = (typeof METHODS)[keyof typeof METHODS];

// JSON-RPC 2.0 request
export interface RpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

// JSON-RPC 2.0 response (success)
export interface RpcSuccessResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

// JSON-RPC 2.0 response (error)
export interface RpcErrorResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  error: RpcError;
}

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Factory helpers

export function makeRequest(
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): RpcRequest {
  const req: RpcRequest = { jsonrpc: "2.0", id, method };
  if (params !== undefined) req.params = params;
  return req;
}

export function makeResponse(id: number | string, result: unknown): RpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): RpcErrorResponse {
  const err: RpcError = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}

// Type guard
export function isRpcError(resp: RpcResponse): resp is RpcErrorResponse {
  return "error" in resp;
}

// Validate incoming request shape (basic)
export function validateRequest(obj: unknown): RpcRequest | null {
  if (!obj || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;
  if (r.jsonrpc !== "2.0") return null;
  if (typeof r.method !== "string") return null;
  if (r.id === undefined || r.id === null) return null;
  return obj as RpcRequest;
}
