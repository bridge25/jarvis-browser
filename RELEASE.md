# jarvis-browser v1.0.0 Release Notes

**Date**: 2026-02-19
**LOC**: ~8,655 (40 TypeScript source files)
**Tests**: 306 (18 test files, 84.89% coverage)
**Dependency**: playwright-core ^1.58.0, vitest ^3.0.0

## Upgrade Summary (v0.6.0 -> v1.0.0)

4-phase upgrade implementing a **failure-mode elimination roadmap**:
Every feature exists because an autonomous agent failed during real-world browser automation.

| Phase | Version | Theme | New Files | Key Additions |
|-------|---------|-------|-----------|---------------|
| 5 | v0.7.0 | Autonomous Resilience | 4 src + 6 tests | Dialog, Upload, State, Get, --json |
| 6 | v0.8.0 | Intelligent Perception | 1 src | Semantic locators, Observer body capture |
| 7 | v0.9.0 | Hardened Operations | 4 src | Encryption, HAR export, Stats, Highlight |
| 8 | v1.0.0 | Platform | 3 src | Emulation, PDF, Recording, Proxy |

**Total commands: ~105** (62 in v0.6.0 + ~43 new)
**Recovery chain: 7 error types** (3 in v0.6.0 + 4 new)

---

## Phase 5: Autonomous Resilience (v0.7.0)

Eliminates 5 failure modes that caused agent sessions to die or require human intervention.

### FM-1: Dialog Blocking -> Auto-Handled
```bash
jarvis-browser dialog list                          # Show dialog history
jarvis-browser dialog last                          # Most recent dialog
jarvis-browser dialog accept                        # Accept current dialog
jarvis-browser dialog dismiss                       # Dismiss current dialog
jarvis-browser config set dialog-mode queue         # accept | dismiss | queue
```

Dialogs no longer block the page. Auto-handled based on `dialog-mode` config, logged for review.

### FM-2: File Upload -> CLI One-Liner
```bash
jarvis-browser upload e5 /path/to/file.pdf          # Upload via input ref
jarvis-browser upload --near e3 /path/to/image.png  # Hidden input detection
```

3-step hidden input discovery: tagName check -> input type scan -> parent DOM traversal.

### FM-3: Blind Action -> Pre-Check
```bash
jarvis-browser is visible e5                        # Check element state
jarvis-browser is enabled e3                        # Check interactability
jarvis-browser is checked e7                        # Checkbox state
jarvis-browser is editable e2                       # Input editability

jarvis-browser wait --visible e5                    # Wait for visibility
jarvis-browser wait --enabled e3                    # Wait for interactability
```

### FM-4: Unparseable Output -> --json Everywhere
```bash
jarvis-browser snapshot --json                      # Structured JSON envelope
jarvis-browser click e5 --json                      # {"ok":true,"data":{...}}
jarvis-browser get text e3 --json                   # Type-safe extraction
```

Every command supports `--json` via `formatOutput()` in shared.ts.

### FM-5: Download -> Wait + Save
```bash
jarvis-browser wait --download --save-to /tmp/      # Wait for download event
```

### Get Commands (Structured Data Extraction)
```bash
jarvis-browser get text e5                          # Element text content
jarvis-browser get html e5                          # Inner HTML
jarvis-browser get value e3                         # Input value
jarvis-browser get attr e5 href                     # Attribute value
jarvis-browser get title                            # Page title
jarvis-browser get url                              # Current URL
jarvis-browser get count "button"                   # Element count by selector
jarvis-browser get box e5                           # Bounding box
```

### Recovery Chain Expansion
| Error Type | Recovery | Added In |
|-----------|----------|----------|
| stale_ref | Re-snapshot + ref rematch | v0.6.0 |
| not_interactable | Scroll + Escape + retry | v0.6.0 |
| strict_mode | Re-snapshot with disambiguation | v0.6.0 |
| **dialog_blocking** | **Auto-dismiss + retry** | **v0.7.0** |
| **navigation_changed** | **Re-snapshot on new page** | **v0.7.0** |

---

## Phase 6: Intelligent Perception (v0.8.0)

Reduces snapshot cost and adds semantic element targeting.

### FM-6: Expensive Snapshot -> Semantic Locators
```bash
jarvis-browser find role button "Submit"            # By ARIA role + name
jarvis-browser find text "Welcome"                  # By visible text
jarvis-browser find label "Email"                   # By associated label
jarvis-browser find placeholder "Enter email"       # By placeholder text
jarvis-browser find testid "login-btn"              # By data-testid

# Find + Act in one command
jarvis-browser find role button "Submit" --action click
jarvis-browser find label "Email" --action fill --value "user@test.com"
```

No snapshot required. Direct Playwright semantic locators.

### FM-7: Overlay Interference -> Auto-Dismiss
Consecutive `not_interactable` errors trigger overlay detection and dismissal:
- Cookie consent banners
- Newsletter popups
- Modal overlays
- Chat widgets

### Observer Enhancements
```bash
jarvis-browser requests --method POST               # Filter by HTTP method
jarvis-browser requests --status 4xx                 # Filter by status range
jarvis-browser requests --with-body                  # Include response bodies
jarvis-browser config set network-body-max-kb 64     # Body size limit
```

### Enhanced Page Info
```bash
jarvis-browser page-info                             # Now includes:
# viewport, devicePixelRatio, readyState, dialog count
```

### Cookie Filter
```bash
jarvis-browser cookies --domain "example.com"        # Case-insensitive domain filter
jarvis-browser cookies --name "session_id"           # Exact name match
```

---

## Phase 7: Hardened Operations (v0.9.0)

Security, observability, and operational robustness.

### FM-8: Session Data Loss -> Encrypted Sessions
```bash
export JARVIS_BROWSER_ENCRYPTION_KEY="my-secret-key"
jarvis-browser session save "naver-login"            # Saved as .enc (encrypted)
jarvis-browser session load "naver-login"            # Auto-decrypts
```

AES-256-GCM + PBKDF2 (100,000 iterations). Backward compatible: loads unencrypted `.json` if `.enc` not found.

### HAR Export
```bash
jarvis-browser observe --export ./trace.har          # HAR 1.2 format
jarvis-browser observe --export ./trace.json --format json  # Raw JSON
```

### Retry Statistics
```bash
jarvis-browser daemon health --json                  # Includes retry_stats:
# { total, recovered, failed, by_type, recovery_rate }
```

### Element Highlight
```bash
jarvis-browser highlight e5                          # Red outline (default)
jarvis-browser highlight e5 --color blue --duration 5
```

CSS outline injection via `locator.evaluate()`. 7 colors supported.

### CAPTCHA Detection
CAPTCHA patterns detected -> fail-fast (no retry) with suggestion:
```json
{"ok":false,"error":"captcha_detected","suggestion":"Manual intervention required"}
```

---

## Phase 8: Platform (v1.0.0)

Market parity features for comprehensive browser automation.

### Device Emulation
```bash
jarvis-browser set device "iPhone 14"               # 8 preset devices
jarvis-browser set viewport 1920 1080               # Custom viewport
jarvis-browser set viewport 1920 1080 --dpr 2       # With device pixel ratio
jarvis-browser set geo 37.5665 126.9780             # Geolocation (Seoul)
jarvis-browser set headers "X-Custom: value"        # Custom HTTP headers
```

### PDF Generation
```bash
jarvis-browser pdf /tmp/page.pdf                    # Save as PDF
jarvis-browser pdf /tmp/page.pdf --landscape        # Landscape orientation
```

Headless mode required. Path restricted to `/tmp/`.

### Video Recording
```bash
jarvis-browser record start /tmp/session.webm       # Start recording
jarvis-browser record start --fps 10 --quality 80   # Custom settings
jarvis-browser record status                        # Check if recording
jarvis-browser record stop                          # Stop + save
```

CDP screencast-based. Configurable FPS, quality, max-frames.

### Proxy Support
```bash
jarvis-browser config set proxy "http://proxy:8080"
jarvis-browser config set proxy-bypass "localhost,*.internal"
```

---

## Architecture (v1.0.0)

```
jarvis-browser/
  src/
    cli.ts              (~1300 lines)  CLI parsing + routing + --json global
    server.ts           (~730 lines)   JSON-RPC server + retry stats
    browser.ts          (~620 lines)   Chrome CDP + page + dialog handler
    actions.ts          (~530 lines)   click, type, fill, upload, wait...
    observer.ts         (~420 lines)   Ring buffers + body capture
    snapshot.ts         (~350 lines)   Accessibility tree + scoping
    daemon.ts           (~300 lines)   Daemon lifecycle + PID management
    session.ts          (~320 lines)   Auth state + AES-256-GCM encryption
    retry.ts            (~360 lines)   7 error types + recovery chain + stats
    network.ts          (~200 lines)   Route block/mock/capture
    shared.ts           (~230 lines)   Validation, JSON envelope, output helpers
    upload.ts           (~130 lines)   File upload + hidden input detection
    crypto.ts           (~200 lines)   AES-256-GCM + PBKDF2
    har-export.ts       (~150 lines)   Network buffer -> HAR 1.2
    stats.ts            (~50 lines)    Retry statistics singleton
    protocol.ts         (~165 lines)   JSON-RPC 2.0 definitions (42 methods)
    client.ts           (~110 lines)   JSON-RPC client for UDS
    config.ts           (~120 lines)   Runtime config (12 keys)
    storage.ts          (~70 lines)    localStorage/sessionStorage CRUD
    types.ts            (~70 lines)    Type definitions
  src/commands/         (~20 files)    Command handlers
    dialog-cmd.ts       dialog list/accept/dismiss/last/mode
    get-cmd.ts          get text/html/value/attr/title/url/count/box
    state-cmd.ts        is visible/enabled/checked/editable/hidden + wait
    find-cmd.ts         find role/text/label/placeholder/testid + action
    highlight-cmd.ts    highlight element with CSS outline
    emulation.ts        set device/viewport/geo/headers
    pdf-cmd.ts          pdf save (headless only)
    recording.ts        record start/stop/status (CDP screencast)
    interaction.ts      click, type, fill, select, check, hover, drag, scroll, press
    navigation.ts       navigate, reload, back, forward, wait (extended)
    data.ts             snapshot, screenshot, evaluate, text, attr, cookies
    daemon-cmd.ts       daemon start/stop/status/health
    storage-cmd.ts      storage get/set/remove/keys/dump/clear
    session-cmd.ts      session save/load/list/delete/export/import
    network-cmd.ts      route block/mock/capture/list/remove/clear
    frame-cmd.ts        frame list/switch/main
    observe-cmd.ts      console/errors/requests/observe/page-info
    config-cmd.ts       config list/get/set/reset
    connection.ts       status/launch/connect/stop
  test/unit/            (12 files)
  test/integration/     (6 files)
  bin/
    jarvis-browser.mjs
```

## Config Keys (v1.0.0)

| Key | Default | Description |
|-----|---------|-------------|
| auto-retry | false | Auto-retry on stale/blocked elements |
| retry-count | 2 | Max retry attempts |
| retry-delay-ms | 500 | Delay between retries |
| default-timeout-ms | 10000 | Default operation timeout |
| screenshot-dir | /tmp | Screenshot output directory |
| console-buffer-size | 500 | Console ring buffer capacity |
| network-buffer-size | 200 | Network ring buffer capacity |
| daemon-idle-timeout-m | 30 | Daemon auto-shutdown (minutes) |
| dialog-mode | accept | Dialog handling: accept/dismiss/queue |
| network-body-max-kb | 0 | Network response body capture (0=off) |
| proxy | "" | HTTP proxy URL |
| proxy-bypass | "" | Proxy bypass patterns |

## Verified

| Check | Result |
|-------|--------|
| TypeScript strict | 0 errors |
| Tests | 306/306 pass (18 files) |
| Coverage | 84.89% (threshold 80%) |
| Backward compat | All v0.6.0 commands preserved |
| Recovery chain | 7/7 error types verified |
| Sisyphus Codex | 4/4 phases PASS |

## Version History

| Version | Date | Theme | Commit |
|---------|------|-------|--------|
| v0.2.0 | 2026-02-18 | Core CLI | f630389 |
| v0.6.0 | 2026-02-19 | Daemon + Observer + Controller + Resilient | 4dcdf93 |
| v1.0.0 | 2026-02-19 | Failure Mode Elimination (8/8) | 06cc564 |
