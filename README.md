# jarvis-browser

CLI browser automation tool for autonomous AI agents. Daemon-backed, ref-based interaction over Chrome CDP.

## Why

Every feature exists because an autonomous agent **failed** during real-world browser automation. This tool eliminates 8 failure modes that cause agent sessions to die or require human intervention.

## Quick Start

```bash
npm install
npm run build
npm link          # Makes 'jarvis-browser' available globally

jarvis-browser launch                    # Launch Chrome with CDP
jarvis-browser snapshot --compact        # Get refs (e1, e2, e3...)
jarvis-browser click e1                  # Click by ref
jarvis-browser fill e3 "search text"     # Fill input
```

## Core Flow: snapshot → act → verify

```bash
jarvis-browser snapshot --compact        # 1. Perceive (get refs)
jarvis-browser click e5                  # 2. Act (use refs)
jarvis-browser get text e5               # 3. Verify (check result)
```

## Architecture

- **Daemon**: Background process maintaining Chrome connection + ring buffers
- **Snapshot**: Accessibility tree reader, assigns refs (e1, e2...) to interactive elements
- **Recovery Chain**: 7 error types with automatic recovery (stale_ref, dialog_blocking, overlay_interference, etc.)
- **~105 commands** across connection, navigation, interaction, data extraction, sessions, network, and more

## Key Features

| Feature | Description |
|---------|-------------|
| Dialog Auto-Handle | Dialogs no longer block pages |
| File Upload | Hidden input detection + CLI one-liner |
| State Query | `is visible/enabled/checked/editable` pre-checks |
| Semantic Locators | Find by ARIA role, text, label — no snapshot needed |
| Encrypted Sessions | AES-256-GCM auth state persistence |
| HAR Export | Network traffic in HAR 1.2 format |
| Device Emulation | 8 preset devices + custom viewport/geo |
| PDF Generation | Headless PDF save |
| Video Recording | CDP screencast to WebM |
| --json Everywhere | Structured JSON output for all commands |

## Stats

- **~8,655 LOC** (40 TypeScript source files)
- **306 tests** (18 test files, 84.89% coverage)
- **Dependencies**: playwright-core, vitest

## Version History

| Version | Theme |
|---------|-------|
| v0.2.0 | Core CLI |
| v0.6.0 | Daemon + Observer + Controller + Resilient |
| v1.0.0 | Failure Mode Elimination (8/8) |

See [RELEASE.md](RELEASE.md) for detailed release notes.

## License

[MIT](LICENSE)
