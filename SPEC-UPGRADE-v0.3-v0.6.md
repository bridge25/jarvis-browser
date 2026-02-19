# SPEC: jarvis-browser v0.3.0 — v0.6.0 Upgrade

> Agentic Browser Automation CLI — From Tool to Cognitive Infrastructure
>
> Design Philosophy: Optimize for the **Agent Cognitive Loop**
> `Perceive → Think → Act → Verify → Recover`

---

## 1. Executive Summary

### What
Upgrade jarvis-browser from a stateless CLI tool (v0.2.0, 33 commands, 2,157 LOC) into a **daemon-backed agentic browser platform** (v0.6.0, 62 commands, ~4,500 LOC) with observability, environment control, and self-healing capabilities.

### Why
Current jarvis-browser excels at Act (click, type, navigate) but is weak at:
- **Perceive**: Only DOM snapshots — no console, network, or event visibility
- **Verify**: Only ref-based wait — no text/URL/JS condition support
- **Recover**: Zero self-healing — errors terminate with no retry

These gaps force the AI agent to operate blind, brittle, and without fallback — the opposite of "agentic."

### How
Four phases, each strengthening one cognitive loop axis:

| Phase | Version | Codename | Focus | New Commands | LOC Delta |
|-------|---------|----------|-------|-------------|-----------|
| 1 | v0.3.0 | **Daemon** | Architecture foundation | 4 | +830 |
| 2 | v0.4.0 | **Observer** | Perceive + Verify | 10 | +600 |
| 3 | v0.5.0 | **Controller** | Act (environment) | 12 | +620 |
| 4 | v0.6.0 | **Resilient** | Recover (self-healing) | 3 | +400 |

### Non-Goals (Intentional Exclusions)

| Excluded | Reason |
|----------|--------|
| Rust CLI binary | Over-engineering for our scale. Node.js overhead (~50ms) is negligible vs AI thinking time |
| Self-managed Chromium | Attaching to existing Chrome (with cookies, sessions, CAPTCHA bypass) is our key differentiator |
| MCP server integration | CLI is more universal. MCP wrapper can be built separately |
| Cross-platform binaries | macOS-only simplifies testing and maintenance |
| 100+ commands | 55 well-built commands > 100 half-baked ones |

---

## 2. Design Principles

### 2.1 Agent Cognitive Loop Mapping

Every feature must map to one loop stage:

```
┌─────────────────────────────────────────────────────┐
│  PERCEIVE  │  snapshot, console, requests, observe  │ ← v0.4.0
│  THINK     │  (external: AI model)                  │
│  ACT       │  click, fill, navigate, route, storage │ ← v0.2.0 + v0.5.0
│  VERIFY    │  wait --text/--url/--js/--network-idle │ ← v0.4.0
│  RECOVER   │  auto-retry, self-healing, rich errors │ ← v0.6.0
└─────────────────────────────────────────────────────┘
```

### 2.2 Core Invariants (MUST preserve across all versions)

1. **Attach to existing Chrome** — never launch isolated Chromium
2. **Ref-based interaction** — `e1`, `e2`, `e3` from accessibility tree
3. **CLI-first** — every feature callable from shell
4. **JSON stdout** — machine-readable output for all commands
5. **Security constraints** — URL validation, SSRF blocking, screenshot path restriction
6. **Worker isolation** — `JARVIS_WORKER_ID` for parallel workers
7. **Backward compatibility** — all v0.2.0 commands work identically

### 2.3 Token Efficiency

Compact output that minimizes AI token consumption:
- Snapshots: ~200-400 tokens (vs ~3000-5000 for full DOM)
- `observe` command: single JSON with all page state (~100 tokens)
- Error messages: actionable suggestions, not stack traces

---

## 3. Architecture

### 3.1 Current (v0.2.0)

```
┌──────────┐     CDP      ┌──────────┐
│ CLI      │──────────────▶│ Chrome   │
│ (Node.js)│  reconnect    │ (CDP     │
│ 660 LOC  │  every call   │  :9222)  │
└──────────┘               └──────────┘
     │
     ▼
  /tmp/jarvis-browser-refs/  (disk cache for refs)
```

**Problem**: Each CLI invocation = new Node.js process + CDP reconnect + disk I/O.
No state persists between commands (except refs on disk).

### 3.2 Target (v0.3.0+)

```
┌──────────┐    Unix     ┌──────────┐     CDP      ┌──────────┐
│ CLI      │───Socket───▶│ Daemon   │──────────────▶│ Chrome   │
│ (client) │  JSON-RPC   │ (server) │  persistent   │ (CDP     │
│ ~200 LOC │             │ ~600 LOC │  connection   │  :9222)  │
└──────────┘             └──────────┘               └──────────┘
                              │
                         In-memory:
                         ├── ref cache
                         ├── console buffer (500)
                         ├── network buffer (200)
                         ├── route rules
                         └── session states
```

**Fallback**: If daemon unavailable, CLI falls back to direct CDP connection (v0.2.0 behavior).

### 3.3 File Structure (Target v0.6.0)

```
jarvis-browser/
├── src/
│   ├── cli.ts              (200)  CLI client: parse args → send to daemon
│   ├── daemon.ts           (350)  Daemon process: lifecycle, auto-start/stop
│   ├── server.ts           (250)  JSON-RPC server over Unix Domain Socket
│   ├── client.ts           (150)  JSON-RPC client (used by cli.ts)
│   ├── protocol.ts         (80)   RPC method names, error codes, types
│   ├── browser.ts          (600)  Chrome connection, page management, refs
│   ├── actions.ts          (650)  Element interactions + auto-retry + recovery chain
│   ├── snapshot.ts         (287)  Accessibility tree → ref-annotated snapshot
│   ├── observer.ts         (300)  Console, network, event collection
│   ├── network.ts          (250)  Route intercept, mock, block, capture
│   ├── session.ts          (200)  State save/load (cookies + storage + security)
│   ├── storage.ts          (80)   localStorage/sessionStorage access
│   ├── config.ts           (100)  Runtime configuration
│   ├── shared.ts           (220)  Validation, errors, output utilities
│   ├── types.ts            (120)  All TypeScript type definitions
│   └── commands/                  Command handlers (split from monolithic cli.ts)
│       ├── connection.ts   (80)
│       ├── tabs.ts         (80)
│       ├── navigation.ts   (60)
│       ├── interaction.ts  (150)
│       ├── data.ts         (80)
│       ├── observe.ts      (100)
│       ├── network-cmd.ts  (60)
│       ├── session-cmd.ts  (60)
│       └── batch.ts        (80)
├── test/
│   ├── unit/
│   │   ├── protocol.test.ts
│   │   ├── snapshot.test.ts
│   │   └── shared.test.ts
│   ├── integration/
│   │   ├── daemon.test.ts
│   │   ├── observer.test.ts
│   │   └── session.test.ts
│   └── scenario/
│       └── smartstore-crawl.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

Total: ~4,500 LOC (2.1x current), 21 source files

---

## 4. Phase 1: Daemon (v0.3.0)

### 4.1 Objective

Replace per-invocation process model with persistent daemon.
All existing commands work identically — zero breaking changes.

### 4.2 Daemon Lifecycle

#### Start

```bash
jarvis-browser daemon start [--port 9222]
```

1. Check for existing daemon: read PID from `/tmp/jarvis-browser-daemon.pid`
2. If running (kill -0 PID succeeds), print status and exit
3. Fork daemon process (detached, stdio to log file)
4. Daemon connects to Chrome CDP on specified port
5. Daemon listens on Unix Domain Socket

**Auto-start**: When any CLI command fails to connect to daemon socket, it auto-starts the daemon (fork + wait for ready signal).

#### Stop

```bash
jarvis-browser daemon stop
```

1. Read PID from pidfile
2. Send SIGTERM
3. Daemon closes CDP connection, removes socket file, removes pidfile
4. CLI waits up to 5s for clean shutdown, then SIGKILL

#### Health

```bash
jarvis-browser daemon health
```

Returns:
```json
{
  "daemon": { "pid": 12345, "uptime_s": 3600, "memory_mb": 45 },
  "chrome": { "connected": true, "tabs": 5, "cdp_url": "http://127.0.0.1:9222" },
  "buffers": { "console": 142, "network": 89, "routes": 3 },
  "refs": { "cached_targets": 8, "total_refs": 234 }
}
```

#### Auto-shutdown

Daemon shuts down automatically when:
- Chrome disconnects AND no reconnect within 60s
- Idle for 30 minutes (no RPC calls received)
- Receives SIGTERM or SIGINT

### 4.3 Socket Protocol

**Transport**: Unix Domain Socket at `/tmp/jarvis-browser.sock`

Worker isolation: `/tmp/jarvis-browser-{JARVIS_WORKER_ID}.sock`

**Protocol**: JSON-RPC 2.0 over newline-delimited frames

Request:
```json
{"jsonrpc":"2.0","id":1,"method":"click","params":{"ref":"e1","targetId":"abc-123"}}
```

Response:
```json
{"jsonrpc":"2.0","id":1,"result":{"ok":true,"message":"Clicked e1"}}
```

Error:
```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Unknown ref \"e99\"","data":{"suggestion":"Run snapshot to get current refs"}}}
```

**Error Codes**:

| Code | Meaning |
|------|---------|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32001 | Browser not connected |
| -32002 | Tab not found |
| -32003 | Ref not found |
| -32004 | Action failed (element not interactable) |
| -32005 | Navigation failed |
| -32006 | Timeout |
| -32007 | Security violation (blocked URL) |
| -32008 | Tab owned by another worker |

### 4.4 Worker Concurrency Model (Codex review addition)

Multiple workers sharing the same Chrome instance need conflict prevention:

**Tab Ownership**: Each worker claims tabs via `JARVIS_WORKER_ID`. The daemon tracks ownership:
```typescript
// Per-daemon state
tabOwnership: Map<targetId, workerId>  // which worker owns which tab
```

Rules:
1. `open <url>` assigns the new tab to the requesting worker
2. Commands on a tab check ownership — reject if another worker owns it (error code `-32008: Tab owned by another worker`)
3. `tabs` only lists tabs owned by the requesting worker (or unowned tabs)
4. `close` only allowed by the owning worker
5. Unowned tabs (opened manually in Chrome) are claimable by first worker that interacts

**Ref Versioning**: Each snapshot increments a per-tab version counter. Actions include the version they were planned against. If the tab has been re-snapshotted by another interaction since, the daemon warns (but does not block — the auto-retry system in v0.6.0 handles stale refs).

**No cross-worker locking**: Workers operate on separate tabs. Same-tab contention is prevented by ownership, not locks. This avoids deadlock complexity while matching our actual usage pattern (each worker crawls different pages).

### 4.5 CLI Client Rewrite

Current `cli.ts` (660 LOC monolithic switch) becomes:

```typescript
// cli.ts — lightweight client (~200 LOC)
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const params = parseArgs(command, args);

  // Try daemon first
  try {
    const result = await rpcCall(command, params);
    outputResult(result);
  } catch (socketError) {
    // Fallback: direct mode (v0.2.0 behavior)
    if (process.env.JARVIS_BROWSER_DIRECT === "1") {
      await directMode(command, params);
    } else {
      // Auto-start daemon, retry
      await startDaemon();
      const result = await rpcCall(command, params);
      outputResult(result);
    }
  }
}
```

### 4.6 Code Refactoring (Concurrent with Daemon)

**cli.ts decomposition**: 660-LOC switch statement → `commands/` directory with one file per category.

Each command file exports a handler:
```typescript
// commands/interaction.ts
export function handleClick(params: ClickParams): Promise<ActionResult> { ... }
export function handleType(params: TypeParams): Promise<ActionResult> { ... }
```

The daemon's server.ts routes RPC methods to these handlers.

### 4.7 Migration & Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| `jarvis-browser click e1` (daemon running) | CLI → socket → daemon → Chrome |
| `jarvis-browser click e1` (no daemon) | Auto-start daemon, then route via socket |
| `jarvis-browser click e1 --direct` | Bypass daemon, connect to Chrome directly (v0.2.0 mode) |
| `JARVIS_BROWSER_DIRECT=1 jarvis-browser click e1` | Same as --direct |
| Existing scripts using jarvis-browser | Work without any changes |
| Ref cache from v0.2.0 disk files | Loaded by daemon on startup, migrated to memory |

### 4.8 Deliverables

- [ ] `daemon.ts`: Fork, PID file, auto-shutdown, signal handling
- [ ] `server.ts`: JSON-RPC 2.0 over UDS, method routing
- [ ] `client.ts`: Socket connection, request/response, auto-start
- [ ] `protocol.ts`: Method names, error codes, types
- [ ] `cli.ts` rewrite: Lightweight client with direct-mode fallback
- [ ] `commands/` directory: Decomposed from monolithic switch
- [ ] `daemon start|stop|status|health` CLI commands
- [ ] PID file management with race condition prevention
- [ ] Daemon log file at `/tmp/jarvis-browser-daemon.log`
- [ ] Integration test: daemon start → command → daemon stop

---

## 5. Phase 2: Observer (v0.4.0)

### 5.1 Objective

Expand Perceive and Verify axes of the agent cognitive loop.
Agent gains multi-channel page awareness beyond DOM snapshots.

### 5.2 New Commands

#### 5.2.1 `console`

Retrieve JavaScript console messages captured by the daemon.

```bash
jarvis-browser console [--level error|warn|info|log|all] [--last N] [--clear] [--target <id>]
```

Output:
```json
{
  "ok": true,
  "messages": [
    { "level": "error", "text": "Uncaught TypeError: Cannot read property 'x' of null", "url": "https://...", "line": 42, "timestamp": 1708300000 },
    { "level": "warn", "text": "Deprecated API usage", "url": "https://...", "line": 15, "timestamp": 1708300001 }
  ],
  "total": 142,
  "filtered": 2
}
```

Implementation:
- Daemon subscribes to `page.on('console', msg => ...)` for each tracked page
- Ring buffer per targetId: max 500 messages, FIFO eviction
- Levels: `error`, `warning`, `info`, `log`, `debug`, `trace` (note: Playwright uses `warning` not `warn` — CLI accepts both as input, normalizes to `warning` internally)
- `--clear` flushes the buffer

#### 5.2.2 `errors`

Shortcut for uncaught JavaScript exceptions.

```bash
jarvis-browser errors [--last N] [--target <id>]
```

Output:
```json
{
  "ok": true,
  "errors": [
    { "message": "Uncaught TypeError: x is not a function", "stack": "at Object.<anonymous> ...", "timestamp": 1708300000 }
  ],
  "count": 1
}
```

Implementation:
- Daemon subscribes to `page.on('pageerror', err => ...)`
- Separate buffer from console (max 100 errors)

#### 5.2.3 `requests`

Retrieve network request history.

```bash
jarvis-browser requests [--filter all|failed|pending|api] [--url-pattern <glob>] [--last N] [--target <id>]
```

Output:
```json
{
  "ok": true,
  "requests": [
    {
      "url": "https://api.example.com/data",
      "method": "GET",
      "status": 200,
      "duration_ms": 342,
      "resource_type": "fetch",
      "timestamp": 1708300000
    },
    {
      "url": "https://api.example.com/auth",
      "method": "POST",
      "status": 401,
      "duration_ms": 89,
      "resource_type": "fetch",
      "timestamp": 1708300001,
      "failed": true
    }
  ],
  "summary": { "total": 34, "failed": 1, "pending": 0 }
}
```

Implementation:
- Daemon subscribes to `page.on('request')`, `page.on('response')`, `page.on('requestfailed')`
- Ring buffer per targetId: max 200 entries
- Filters:
  - `failed`: status >= 400 or requestfailed
  - `pending`: request started, no response yet
  - `api`: resource_type in ['fetch', 'xhr']
- `--url-pattern`: glob match against request URL
- Response body is NOT captured (memory/token efficiency)

#### 5.2.4 `observe`

Unified page state for agent situational awareness.

```bash
jarvis-browser observe [--target <id>] [--include dom,console,network,performance]
```

Output:
```json
{
  "ok": true,
  "page": {
    "title": "SmartStore - tokyoq",
    "url": "https://smartstore.naver.com/tokyoq",
    "viewport": { "width": 1280, "height": 720 }
  },
  "health": {
    "console_errors": 0,
    "console_warnings": 2,
    "js_exceptions": 0,
    "failed_requests": 0,
    "pending_requests": 0
  },
  "performance": {
    "dom_content_loaded_ms": 820,
    "load_ms": 1240,
    "dom_nodes": 1847
  },
  "snapshot_stale": true,
  "last_snapshot_age_s": 45
}
```

Design: This is the agent's "dashboard" — one command to understand page state before deciding next action. Token-efficient (~100 tokens).

#### 5.2.5 `page-info`

Lightweight version of observe (no buffers, no performance).

```bash
jarvis-browser page-info [--target <id>]
```

Output:
```json
{
  "ok": true,
  "title": "Product Detail",
  "url": "https://smartstore.naver.com/tokyoq/products/123",
  "cookies_count": 12,
  "localStorage_keys": 8,
  "sessionStorage_keys": 3
}
```

#### 5.2.6 Extended `wait` Strategies

```bash
# Text appearance (new)
jarvis-browser wait --text "주문 완료" [--timeout 10000] [--target <id>]

# URL pattern (new)
jarvis-browser wait --url "**/success**" [--timeout 10000] [--target <id>]

# JavaScript condition (new)
jarvis-browser wait --js "window.dataLoaded === true" [--timeout 10000] [--target <id>]

# Network idle (new)
jarvis-browser wait --network-idle [--timeout 10000] [--target <id>]

# Navigation (existing, enhanced)
jarvis-browser wait --navigation [--timeout 30000] [--target <id>]

# Element ref (existing, unchanged)
jarvis-browser wait --ref e5 [--state visible] [--timeout 10000] [--target <id>]
```

Implementation mapping:

| Flag | Playwright API |
|------|---------------|
| `--text <string>` | `page.getByText(text).waitFor({ state: 'visible' })` |
| `--url <pattern>` | `page.waitForURL(pattern)` |
| `--js <expr>` | `page.waitForFunction(expr)` |
| `--network-idle` | `page.waitForLoadState('networkidle')` |
| `--navigation` | `page.waitForLoadState('domcontentloaded')` |
| `--ref <ref>` | (existing behavior, unchanged) |

### 5.3 Observer Module Design

```typescript
// observer.ts
class PageObserver {
  private consoleBuffer: RingBuffer<ConsoleMessage>;  // max 500
  private errorBuffer: RingBuffer<JSError>;            // max 100
  private networkBuffer: RingBuffer<NetworkEntry>;     // max 200
  private attached: WeakSet<Page>;  // Prevent duplicate listener attachment
  private listenerRefs: Map<Page, Function[]>;  // Track listeners for cleanup

  attach(page: Page): void {
    // CRITICAL: Guard against duplicate attachment (Codex review finding)
    if (this.attached.has(page)) return;
    this.attached.add(page);
    // Store listener refs for deterministic cleanup
    const listeners = [
      page.on('console', handler),
      page.on('pageerror', handler),
      page.on('request', handler),
      // ...
    ];
    this.listenerRefs.set(page, listeners);
  }

  detach(page: Page): void {
    // Remove all listeners, clear from tracking
    for (const off of this.listenerRefs.get(page) ?? []) off();
    this.listenerRefs.delete(page);
    this.attached.delete(page);
  }

  // Called on tab close — force cleanup buffers + listeners
  destroy(page: Page): void {
    this.detach(page);
    // Buffers for this page are evicted (keyed by targetId)
  }

  getConsole(opts): ConsoleMessage[];
  getErrors(opts): JSError[];
  getRequests(opts): NetworkEntry[];
  getObservation(): Observation;  // Unified snapshot
  clear(channel?: string): void;
}

// Ring buffer: O(1) push, O(n) read, fixed memory
class RingBuffer<T> {
  constructor(private maxSize: number);
  push(item: T): void;
  getAll(): T[];
  getLast(n: number): T[];
  filter(predicate: (item: T) => boolean): T[];
  clear(): void;
  get size(): number;
}
```

### 5.4 Deliverables

- [ ] `observer.ts`: PageObserver class with ring buffers
- [ ] `commands/observe.ts`: console, errors, requests, observe, page-info handlers
- [ ] Extended wait strategies in `actions.ts`
- [ ] Daemon integration: observer attached per page on navigation
- [ ] Event cleanup on page close / navigation
- [ ] Unit tests for ring buffer, observer filters
- [ ] Integration test: navigate → trigger errors → console command → verify

---

## 6. Phase 3: Controller (v0.5.0)

### 6.1 Objective

Expand Act axis — agent can manipulate browser environment (storage, network, sessions).

### 6.2 New Commands

#### 6.2.1 `storage`

Access localStorage and sessionStorage.

```bash
# Read
jarvis-browser storage get <key> [--type local|session] [--target <id>]
jarvis-browser storage keys [--type local|session] [--target <id>]
jarvis-browser storage dump [--type local|session] [--target <id>]

# Write
jarvis-browser storage set <key> <value> [--type local|session] [--target <id>]

# Delete
jarvis-browser storage remove <key> [--type local|session] [--target <id>]
jarvis-browser storage clear [--type local|session] [--target <id>]
```

Default `--type` is `local` (localStorage).

Implementation: Thin wrapper over `page.evaluate()`:
```typescript
// storage.ts
export async function storageGet(page: Page, key: string, type: 'local' | 'session'): Promise<string | null> {
  const store = type === 'session' ? 'sessionStorage' : 'localStorage';
  return page.evaluate(([s, k]) => window[s].getItem(k), [store, key]);
}
```

#### 6.2.2 `session`

Save and restore browser authentication state (cookies + storage combined).

```bash
jarvis-browser session save <name> [--target <id>]
jarvis-browser session load <name> [--target <id>]
jarvis-browser session list
jarvis-browser session delete <name>
jarvis-browser session export <name> [--output <path>]
jarvis-browser session import <path> [--name <name>]
```

Storage format:
```json
{
  "version": 1,
  "name": "smartstore-auth",
  "saved_at": "2026-02-18T12:00:00Z",
  "origin": "https://smartstore.naver.com",
  "cookies": [ ... ],
  "localStorage": { "key": "value", ... },
  "sessionStorage": { "key": "value", ... }
}
```

File location: `/tmp/jarvis-browser-sessions/<name>.json`

**Security requirements** (Codex review finding):
- File permissions: `0600` (owner read/write only) — enforced on write
- Sensitive cookie fields (`httpOnly`, `secure`) preserved but redacted in `session export` unless `--include-secrets` flag
- TTL: Sessions expire after 7 days by default (`config set session-ttl-days 7`)
- Domain allowlist: `session save` only captures cookies for the current page origin (no cross-origin leakage)
- Future consideration: AES-256 encryption at rest (deferred — `/tmp` is per-user on macOS, acceptable for local dev)

**Key use case**: Save SmartStore login → use in headless mode → no re-authentication.

#### 6.2.3 `route`

Network interception rules (persistent across commands in daemon).

```bash
# Block resources (speed up crawling)
jarvis-browser route block "**/*.{png,jpg,gif,css}" [--target <id>]

# Mock API response
jarvis-browser route mock "https://api.example.com/data" --body '{"items":[]}' --status 200 [--target <id>]

# Capture API responses (stored in daemon buffer)
jarvis-browser route capture "/api/**" [--target <id>]

# List active rules
jarvis-browser route list [--target <id>]

# Remove specific rule
jarvis-browser route remove <rule-id> [--target <id>]

# Clear all rules
jarvis-browser route clear [--target <id>]
```

Implementation:
```typescript
// network.ts
class NetworkController {
  private rules: Map<string, RouteRule>;

  async addBlock(pattern: string, page: Page): Promise<string>;
  async addMock(pattern: string, response: MockResponse, page: Page): Promise<string>;
  async addCapture(pattern: string, page: Page): Promise<string>;
  getCaptured(pattern?: string): CapturedResponse[];
  async removeRule(ruleId: string, page: Page): Promise<void>;
  async clearAll(page: Page): Promise<void>;
  listRules(): RouteRule[];
}
```

#### 6.2.4 `frame`

Navigate iframe boundaries (code exists in browser.ts but is not CLI-exposed).

```bash
jarvis-browser frame list [--target <id>]
jarvis-browser frame switch <ref-or-name> [--target <id>]
jarvis-browser frame main [--target <id>]
```

Output of `frame list`:
```json
{
  "ok": true,
  "frames": [
    { "name": "main", "url": "https://example.com", "current": true },
    { "name": "payment-iframe", "url": "https://payment.provider.com/...", "current": false },
    { "name": "", "url": "about:blank", "current": false }
  ]
}
```

After `frame switch payment-iframe`, all subsequent commands (snapshot, click, etc.) operate within that frame until `frame main` is called.

### 6.3 Deliverables

- [ ] `storage.ts`: localStorage/sessionStorage access
- [ ] `session.ts`: Save/load/export/import browser state
- [ ] `network.ts`: Route intercept/mock/block/capture
- [ ] `commands/session-cmd.ts`: CLI handlers
- [ ] `commands/network-cmd.ts`: CLI handlers
- [ ] Frame switch exposed in `browser.ts` + CLI
- [ ] Session file format validation
- [ ] Integration test: save session → new context → load session → verify auth state
- [ ] Integration test: route block images → measure page load improvement

---

## 7. Phase 4: Resilient (v0.6.0)

### 7.1 Objective

Add self-healing capabilities — agent recovers from failures without human intervention.

### 7.2 Auto-Retry System

When an action fails, attempt automatic recovery before returning error.

#### Recovery Chain (ordered by likelihood):

```
Action fails
  │
  ├─ Error: "Unknown ref" (stale ref)
  │  └─ Strategy: Re-snapshot → find element by same role+name → retry with new ref
  │
  ├─ Error: "not interactable" (element covered or off-screen)
  │  └─ Strategy: scrollIntoViewIfNeeded → dismiss any dialog → retry
  │
  ├─ Error: "dialog blocking" (unexpected alert/confirm)
  │  └─ Strategy: Auto-dismiss dialog → retry action
  │
  ├─ Error: "strict mode violation" (multiple matches)
  │  └─ Strategy: Re-snapshot → use nth discriminator → retry
  │
  └─ Error: other
     └─ Return error with rich context (no retry)
```

#### Ref Re-matching Algorithm

When a ref becomes stale after page mutation:

```typescript
async function rematchRef(
  page: Page,
  staleRef: string,
  originalRole: string,
  originalName: string | undefined
): Promise<string | null> {
  // 1. Take fresh snapshot
  const { refs } = await takeSnapshot({ targetId, options: { compact: true } });

  // 2. Exact match: same role + same name
  for (const [newRef, info] of Object.entries(refs)) {
    if (info.role === originalRole && info.name === originalName) {
      return newRef;
    }
  }

  // 3. Fuzzy match: same role + name contains original (for dynamic text)
  if (originalName) {
    for (const [newRef, info] of Object.entries(refs)) {
      if (info.role === originalRole && info.name?.includes(originalName)) {
        return newRef;
      }
    }
  }

  // 4. No match found
  return null;
}
```

#### Configuration

```bash
jarvis-browser config set auto-retry true      # Enable (default: false)
jarvis-browser config set retry-count 2         # Max retries per action (default: 2)
jarvis-browser config set retry-delay-ms 500    # Delay between retries (default: 500)
```

Or per-command:
```bash
jarvis-browser click e1 --auto-retry --max-retries 3
```

### 7.3 Rich Error Context

When an action ultimately fails (after retries exhausted), return detailed context:

```json
{
  "ok": false,
  "error": "Element not interactable after 2 retries",
  "context": {
    "command": "click",
    "attempted_ref": "e1",
    "original_element": { "role": "button", "name": "Submit" },
    "page_url": "https://smartstore.naver.com/tokyoq/products/123",
    "console_errors": [
      "Uncaught TypeError: Cannot read property 'submit' of null"
    ],
    "retry_log": [
      { "attempt": 1, "strategy": "scroll_into_view", "result": "still_covered" },
      { "attempt": 2, "strategy": "dismiss_dialog", "result": "no_dialog_present" }
    ],
    "suggestion": "Page may have a modal overlay. Try: jarvis-browser evaluate 'document.querySelector(\".modal\")?.remove()' then retry."
  }
}
```

**Key insight**: This is NOT available in agent-browser. It's our differentiator.

The `suggestion` field provides actionable next steps for the AI agent, reducing back-and-forth.

### 7.4 Config System

```bash
jarvis-browser config get <key>
jarvis-browser config set <key> <value>
jarvis-browser config list
jarvis-browser config reset
```

Config file: `/tmp/jarvis-browser-config.json`

Available settings:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `auto-retry` | boolean | false | Enable automatic retry on failures |
| `retry-count` | number | 2 | Max retries per action |
| `retry-delay-ms` | number | 500 | Delay between retries |
| `default-timeout-ms` | number | 10000 | Default action timeout |
| `screenshot-dir` | string | /tmp | Default screenshot directory |
| `console-buffer-size` | number | 500 | Max console messages per tab |
| `network-buffer-size` | number | 200 | Max network entries per tab |
| `daemon-idle-timeout-m` | number | 30 | Daemon auto-shutdown after idle minutes |

### 7.5 Deliverables

- [ ] Auto-retry system in `actions.ts` (recovery chain)
- [ ] Ref re-matching algorithm
- [ ] Rich error context generation in `shared.ts`
- [ ] `config.ts`: JSON-based configuration
- [ ] `commands/config.ts`: CLI handlers
- [ ] Per-command `--auto-retry` and `--max-retries` flags
- [ ] Retry logging (included in error response)
- [ ] Integration test: click element → page mutates → auto-retry succeeds
- [ ] Integration test: covered element → scroll + retry → success

---

## 8. Complete Command Reference (v0.6.0)

### 8.1 Existing Commands (unchanged from v0.2.0)

| Category | Command | Args |
|----------|---------|------|
| Connection | `status` | `[--port]` |
| Connection | `launch` | `[--port] [--headless] [--no-sandbox]` |
| Connection | `connect` | `[--port] [--cdp-url]` |
| Connection | `stop` | |
| Tabs | `tabs` | |
| Tabs | `open` | `<url>` |
| Tabs | `close` | `<targetId>` |
| Tabs | `focus` | `<targetId>` |
| Tabs | `cleanup` | `[--keep <url>...]` |
| Navigation | `navigate` | `<url> [--target]` |
| Navigation | `reload` | `[--target]` |
| Navigation | `back` | `[--target]` |
| Navigation | `forward` | `[--target]` |
| Snapshot | `snapshot` | `[--mode] [--interactive] [--compact] [--max-depth] [--max-chars] [--output]` |
| Interaction | `click` | `<ref> [--double] [--button] [--auto-retry]` |
| Interaction | `type` | `<ref> <text> [--clear] [--enter]` |
| Interaction | `fill` | `<ref> <value>` |
| Interaction | `select` | `<ref> <values...>` |
| Interaction | `check` | `<ref> [--uncheck]` |
| Interaction | `hover` | `<ref>` |
| Interaction | `drag` | `<sourceRef> <targetRef>` |
| Interaction | `scroll` | `[--ref] [--direction] [--amount]` |
| Interaction | `press` | `<key> [--ref]` |
| Data | `text` | `[<ref>]` |
| Data | `attribute` | `<ref> <name>` |
| Data | `evaluate` | `<expression> [--file] [--output]` |
| Data | `screenshot` | `[--ref] [--path] [--full-page]` |
| Cookies | `cookies` | `[--url]` |
| Cookies | `set-cookie` | `<json>` |
| Cookies | `clear-cookies` | |
| Batch | `batch` | `--file <json> [--output]` |

### 8.2 New Commands (v0.3.0 — v0.6.0)

| Version | Category | Command | Args |
|---------|----------|---------|------|
| v0.3.0 | Daemon | `daemon start` | `[--port]` |
| v0.3.0 | Daemon | `daemon stop` | |
| v0.3.0 | Daemon | `daemon status` | |
| v0.3.0 | Daemon | `daemon health` | |
| v0.4.0 | Observe | `console` | `[--level] [--last N] [--clear]` |
| v0.4.0 | Observe | `errors` | `[--last N]` |
| v0.4.0 | Observe | `requests` | `[--filter] [--url-pattern] [--last N]` |
| v0.4.0 | Observe | `observe` | `[--include ...]` |
| v0.4.0 | Observe | `page-info` | |
| v0.4.0 | Wait | `wait --text` | `<text> [--timeout]` |
| v0.4.0 | Wait | `wait --url` | `<pattern> [--timeout]` |
| v0.4.0 | Wait | `wait --js` | `<expr> [--timeout]` |
| v0.4.0 | Wait | `wait --network-idle` | `[--timeout]` |
| v0.4.0 | Wait | `wait --navigation` | `[--timeout]` |
| v0.5.0 | Storage | `storage get` | `<key> [--type]` |
| v0.5.0 | Storage | `storage set` | `<key> <value> [--type]` |
| v0.5.0 | Storage | `storage keys` | `[--type]` |
| v0.5.0 | Storage | `storage dump` | `[--type]` |
| v0.5.0 | Storage | `storage remove` | `<key> [--type]` |
| v0.5.0 | Storage | `storage clear` | `[--type]` |
| v0.5.0 | Session | `session save` | `<name>` |
| v0.5.0 | Session | `session load` | `<name>` |
| v0.5.0 | Session | `session list` | |
| v0.5.0 | Session | `session delete` | `<name>` |
| v0.5.0 | Session | `session export` | `<name> [--output]` |
| v0.5.0 | Session | `session import` | `<path> [--name]` |
| v0.5.0 | Network | `route block` | `<pattern>` |
| v0.5.0 | Network | `route mock` | `<pattern> --body <json> [--status]` |
| v0.5.0 | Network | `route capture` | `<pattern>` |
| v0.5.0 | Network | `route list` | |
| v0.5.0 | Network | `route remove` | `<rule-id>` |
| v0.5.0 | Network | `route clear` | |
| v0.5.0 | Frame | `frame list` | |
| v0.5.0 | Frame | `frame switch` | `<ref-or-name>` |
| v0.5.0 | Frame | `frame main` | |
| v0.6.0 | Config | `config get` | `<key>` |
| v0.6.0 | Config | `config set` | `<key> <value>` |
| v0.6.0 | Config | `config list` | |
| v0.6.0 | Config | `config reset` | |

**Total**: 33 existing + 29 new = **62 commands**

---

## 9. Testing Strategy

### 9.1 Test Framework

- **Runner**: vitest (TypeScript-native, fast, ESM support)
- **Assertion**: vitest built-in (expect, describe, it)
- **Coverage target**: 70% for new code

### 9.2 Test Infrastructure Setup (Codex review addition)

Before any tests can run, the following must be bootstrapped in Phase 1:

```bash
# package.json additions
npm install -D vitest @vitest/coverage-v8

# vitest.config.ts
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], thresholds: { lines: 70 } },
    testTimeout: 30_000,  // browser operations are slow
  },
});

# Directory structure
mkdir -p test/{unit,integration,scenario}

# CI: headless Chrome via Playwright
# test/setup.ts — launch headless Chrome before test suite, teardown after
```

### 9.3 Test Layers

| Layer | Scope | Files | Mocking | CI-safe |
|-------|-------|-------|---------|---------|
| Unit | Pure functions | protocol, snapshot, shared, ring buffer | None | Yes |
| Integration | Daemon + Chrome | daemon, observer, session, network | Real Chrome (headless, local) | Yes |
| Scenario | End-to-end workflows | SmartStore crawl, auth flow | Real Chrome + real sites | **No** — nightly only |

**Key distinction** (Codex review finding): Integration tests use a local fixture HTTP server (`test/fixtures/server.ts`) serving static HTML/JS that triggers console errors, network failures, etc. This avoids CI flakiness from real site changes. Scenario tests against real sites run as nightly smoke tests only.

### 9.4 Key Test Scenarios

**Daemon lifecycle**:
1. `daemon start` → verify socket exists → `daemon health` → `daemon stop` → verify cleanup

**Observer pipeline**:
1. Navigate to page with JS errors → `console --level error` → verify captured
2. Navigate to page with failed API → `requests --filter failed` → verify captured
3. `observe` → verify unified output includes all channels

**Session persistence**:
1. Navigate + authenticate → `session save auth` → close context → new context → `session load auth` → verify still authenticated

**Auto-retry**:
1. Take snapshot → click button → page DOM mutates (button moves) → click old ref → verify auto-retry re-snapshots and succeeds

**Network control**:
1. `route block "**/*.png"` → navigate to image-heavy page → verify no image requests in `requests` output

---

## 10. Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Daemon crashes under load | Commands fail, need restart | Low | PID file auto-recovery, graceful degradation to direct mode |
| Chrome disconnects unexpectedly | All commands fail | Medium | Daemon reconnect loop (60s), event-based detection |
| Ref re-matching produces wrong element | Agent clicks wrong thing | Medium | Strict exact-match-first, fuzzy-match only as fallback, log all retries |
| Session file format changes | Old sessions unloadable | Low | Version field in session JSON, migration logic |
| UDS socket file left behind after crash | New daemon can't bind | Low | Stale socket detection (try connect, if refused → delete and recreate) |
| Ring buffer memory growth with many tabs | Daemon memory bloat | Low | Per-tab buffers, eviction on tab close, configurable limits |

---

## 11. Differentiation Analysis: jarvis-browser vs agent-browser (Codex review addition)

### 11.1 Honest Feature Comparison

| Feature | jarvis-browser v0.6.0 | agent-browser (Vercel) |
|---------|----------------------|------------------------|
| Architecture | Node.js daemon + UDS | Rust CLI + Node.js daemon |
| Chrome management | **Attach to existing** (key differentiator) | Manages own Chromium |
| Commands | 62 | 80+ |
| Self-healing / auto-retry | **Yes (v0.6.0)** | No |
| Rich error context + suggestions | **Yes (v0.6.0)** | No |
| Console/network observe | Yes (v0.4.0) | Yes (built-in) |
| Session save/load | Yes (v0.5.0) | Yes (with encryption) |
| Network interception | Yes (v0.5.0) | Yes (built-in) |
| State encryption at rest | Deferred (0600 perms only) | **Yes** |
| Trace/recording | Not planned | **Yes** |
| Streaming events | Not planned | **Yes** |
| Startup overhead | ~50ms (Node.js) | ~5ms (Rust) |
| Ecosystem | Internal tool | 14K+ GitHub stars |

### 11.2 Our True Differentiators

1. **Attach to existing Chrome** — CAPTCHA bypass, existing sessions, extensions. agent-browser cannot do this.
2. **Self-healing with ref re-matching** — No equivalent in agent-browser. Measurable KPIs:
   - Recovery success rate target: **>70%** for stale ref errors
   - False positive rate (wrong element matched): **<5%**
   - Max retry overhead: **<3s** per action
3. **Rich error context with AI suggestions** — Errors include console state, retry log, and actionable `suggestion` field. No equivalent in agent-browser.
4. **Token efficiency** — Optimized for AI agent consumption (~100 tokens for `observe` vs verbose output).

### 11.3 Where agent-browser is Stronger (acknowledged)

- Trace/recording for debugging complex flows
- Streaming events for real-time monitoring
- Encryption at rest for session data
- Rust binary startup speed
- Larger community and ecosystem

These gaps are acceptable because our use case (internal automation with existing Chrome) doesn't require them. Trace/streaming may be considered for v0.7.0+.

---

## 12. Version Comparison: v0.2.0 vs v0.6.0

| Dimension | v0.2.0 (Current) | v0.6.0 (Target) |
|-----------|-------------------|------------------|
| Architecture | Stateless CLI | Daemon + Client |
| Commands | 33 | 62 |
| Source files | 6 | 21 |
| LOC | 2,157 | ~4,500 |
| Test coverage | 0% | 70% |
| Perceive channels | 1 (DOM) | 5 (DOM, console, network, events, performance) |
| Verify strategies | 1 (ref wait) | 6 (ref, text, url, js, network-idle, navigation) |
| Recover capability | None | Auto-retry + self-healing + rich errors |
| Session persistence | None | Save/load auth state |
| Network control | None | Block, mock, capture |
| Frame support | Code exists, not exposed | Full CLI (list, switch, main) |
| Configuration | Hardcoded | Runtime config file |

---

*Document version: 1.1 (Codex cross-review applied)*
*Author: JARVIS (Computation-Engineered via Harness P1+P4+P5+P7)*
*Date: 2026-02-18*
*Review: Codex v0.98.0 — 8 findings (2 Critical, 3 High, 3 Medium), all addressed*
