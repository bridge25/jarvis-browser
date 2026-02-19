#!/usr/bin/env node
// jarvis-browser CLI v1.0.0 — daemon-backed, with direct-mode fallback
// All v0.2.0/v0.3.0 commands work identically.

import { jsonOutput, textOutput, fileOutput, formatOutput } from "./shared.js";
import type { ActionResult } from "./types.js";
import { tryConnect, sendRequest, getSocketPath } from "./client.js";
import {
  startDaemon,
  stopDaemon,
  getDaemonStatusViaRpc,
  getDaemonHealthViaRpc,
  isDaemonRunning,
} from "./daemon.js";
import { ensureConnected } from "./browser.js";
import * as connCmd from "./commands/connection.js";
import * as tabsCmd from "./commands/tabs.js";
import * as navCmd from "./commands/navigation.js";
import * as interactCmd from "./commands/interaction.js";
import * as dataCmd from "./commands/data.js";
import * as batchCmd from "./commands/batch.js";

// --- Arg parsing helpers (preserved from v0.2.0) ---

const VALUE_FLAGS = new Set([
  "--target", "--timeout", "--port", "--mode", "--max-depth", "--max-chars",
  "--button", "--ref", "--direction", "--amount", "--state", "--path",
  "--cdp-url", "--keep", "--url", "--file", "--output",
  // v0.4.0 observer + extended wait
  "--level", "--url-pattern", "--last", "--include", "--text", "--js", "--filter",
  // v0.5.0 controller
  "--type", "--body", "--status", "--name", "--rule-id", "--content-type",
  // v0.6.0 config + retry
  "--key", "--max-retries",
  // v0.7.0 new commands
  "--selector", "--save-to", "--attr",
  // v0.8.0 new flags
  "--domain", "--method",
  // v0.9.0 new flags
  "--color", "--duration", "--export", "--format",
  // v1.0.0 new flags
  "--fps", "--quality", "--max-frames",
]);

function getPositionals(args: string[]): string[] {
  const result: string[] = [];
  const skip = new Set<number>();
  args.forEach((arg, i) => {
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.has(arg)) skip.add(i + 1);
    } else if (!skip.has(i)) {
      result.push(arg);
    }
  });
  return result;
}

function extractOption(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function getAllFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  args.forEach((arg, i) => {
    if (arg === flag) {
      const val = args[i + 1];
      if (val !== undefined) values.push(val);
    }
  });
  return values;
}

function parseIntOption(args: string[], flag: string): number | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  const raw = args[idx + 1];
  if (raw === undefined) throw new Error(`${flag} requires a value`);
  const num = Number(raw);
  if (Number.isNaN(num)) throw new Error(`${flag} must be a number, got "${raw}"`);
  return num;
}

function usage(): never {
  textOutput(`jarvis-browser v1.0.0 — ref-based browser automation

DAEMON:
  daemon start [--port]      Start persistent daemon process
  daemon stop                Stop daemon
  daemon status              Show daemon status
  daemon health              Show detailed health info

COMMANDS:
  status                     Check Chrome CDP connection
  launch [--port] [--headless]  Launch Chrome with CDP
  connect [--port] [--cdp-url]  Connect to running Chrome
  stop                       Stop Chrome and disconnect

  tabs                       List open tabs
  open <url>                 Open new tab
  close <targetId>           Close tab
  focus <targetId>           Bring tab to front
  cleanup [--keep <url>...]  Close stale tabs

  reload [--target]          Reload current page
  back [--target]            Navigate back
  forward [--target]         Navigate forward
  navigate <url> [--target]  Go to URL

  snapshot [--target] [--mode] [--interactive] [--compact] [--max-depth] [--output]
  click <ref> [--double] [--button] [--target]
  type <ref> <text> [--clear] [--enter] [--target]
  fill <ref> <value> [--target]
  select <ref> <values...> [--target]
  check <ref> [--uncheck] [--target]
  hover <ref> [--target]
  drag <sourceRef> <targetRef> [--target]
  scroll [--ref] [--direction] [--amount]
  press <key> [--ref] [--target]
  wait [--ref] [--state] [--text] [--url] [--js] [--network-idle] [--navigation] [--target]
  screenshot [--ref] [--path] [--full-page] [--target]
  evaluate <expression> [--file] [--output] [--target]
  text <ref> [--target]
  attribute <ref> <name> [--target]
  cookies [--target] [--url] [--domain <substr>] [--name <exact>]
  set-cookie <json>
  clear-cookies [--target]
  batch --file <json> [--output]

OBSERVER (v0.4.0 — daemon only):
  console [--target] [--level <log|warn|error>] [--last <n>]
  errors [--target] [--last <n>]
  requests [--target] [--filter failed|api] [--url-pattern <glob>] [--method <GET|POST|...>] [--status <2xx|4xx|5xx|404>] [--with-body] [--last <n>]
  observe [--target] [--include <console|errors|requests>...] [--last <n>] [--export <path>] [--format har|json]
  page-info [--target]

CONTROLLER (v0.5.0 — daemon only):
  storage get <key> [--type local|session] [--target]
  storage set <key> <value> [--type local|session] [--target]
  storage remove <key> [--type local|session] [--target]
  storage clear [--type local|session] [--target]
  storage keys [--type local|session] [--target]
  storage dump [--type local|session] [--target]

  session save <name> [--target]
  session load <name> [--target]
  session list
  session delete <name>
  session export <name> [--output <file>] [--include-secrets]
  session import <path> [--name <name>]

  route block <pattern> [--target]
  route mock <pattern> [--status <n>] [--body <text>] [--content-type <mime>] [--target]
  route capture <pattern> [--target]
  route list [--target]
  route remove <ruleId> [--target]
  route clear [--target]
  route captured [--url-pattern <glob>] [--target]

  frame list [--target]
  frame switch <name> [--target]
  frame main [--target]

CONFIG (v0.6.0 — daemon only):
  config get <key>
  config set <key> <value>
  config list
  config reset

  Keys: auto-retry, retry-count, retry-delay-ms, default-timeout-ms,
        screenshot-dir, console-buffer-size, network-buffer-size, daemon-idle-timeout-m,
        dialog-mode (accept|dismiss|queue)

GET (v0.7.0):
  get text <ref>           Get element text content
  get html <ref>           Get element inner HTML
  get value <ref>          Get input/select value
  get attr <ref> <name>    Get element attribute
  get title                Get page title
  get url                  Get current page URL
  get count <selector>     Count matching elements
  get box <ref>            Get bounding box {x,y,w,h}

IS (v0.7.0):
  is visible <ref>         Check if element is visible
  is hidden <ref>          Check if element is hidden
  is enabled <ref>         Check if element is enabled
  is checked <ref>         Check if element is checked
  is editable <ref>        Check if element is editable

DIALOG (v0.7.0):
  dialog list              List pending dialogs (queue mode)
  dialog last              Show last dialog details
  dialog accept [--text]   Accept oldest pending dialog
  dialog dismiss           Dismiss oldest pending dialog
  dialog mode <mode>       Set dialog mode: accept|dismiss|queue

UPLOAD (v0.7.0):
  upload <ref> <file...>
  upload --selector <css> <file...>

FIND (v0.8.0 — semantic locators, no snapshot needed):
  find role <ariaRole> [--name <accessibleName>] [--exact] [<action> [<actionArg>]]
  find text <text> [--exact] [<action> [<actionArg>]]
  find label <label> [--exact] [<action> [<actionArg>]]
  find placeholder <text> [--exact] [<action> [<actionArg>]]
  find testid <testId> [<action> [<actionArg>]]
  Actions: click | fill <value> | type <text> | hover | check | none

HIGHLIGHT (v0.9.0 — visual debugging):
  highlight <ref> [--color red|blue|green|orange|yellow|purple|pink] [--duration <s>]

PLATFORM (v1.0.0 — device/proxy/recording):
  set device "iPhone 14"|"Pixel 7"|"iPad Pro 11"|"Desktop Chrome"|...
  set viewport <width> <height>
  set viewport --reset
  set geo <lat> <lon> [accuracy]
  set geo --reset
  set headers '<json>'
  set headers --reset

  pdf [<path>] [--landscape]          Save current page as PDF (headless only)

  record start [<path>] [--fps <n>] [--quality <1-100>] [--max-frames <n>]
  record stop
  record status

  Config keys: proxy (e.g. socks5://host:1080), proxy-bypass (e.g. *.local,localhost)
               Set proxy before launch: config set proxy <url>

  Config key: network-body-max-kb (0 = disabled, captures response bodies)

OPTIONS:
  --direct                   Bypass daemon, connect to Chrome directly (v0.2.0 mode)
  --json                     Output full {ok,data,error} envelope (v0.7.0)
  --target <targetId>        Tab to operate on
  --timeout <ms>             Operation timeout
  --port <n>                 Chrome CDP port (default: 9222)
  --auto-retry               Auto-retry interactions on stale/blocked elements (v0.6.0)
  --max-retries <n>          Max retry attempts per interaction (default: 2)
  wait --visible/--hidden/--enabled/--checked  State wait flags (v0.7.0)
  wait --download [--save-to <dir>]            Download wait (v0.7.0)

ENV:
  JARVIS_BROWSER_DIRECT=1             Force direct mode
  JARVIS_WORKER_ID=<id>               Worker isolation (socket + PID file per worker)
  JARVIS_BROWSER_ENCRYPTION_KEY=<k>   AES-256-GCM encrypt session files at rest (v0.9.0)`);
  process.exit(0);
}

// --- CLI args → RPC params ---

type Params = Record<string, unknown>;

function buildParams(command: string, args: string[]): Params {
  const targetId = extractOption(args, "--target");
  const timeoutMs = parseIntOption(args, "--timeout");
  const port = parseIntOption(args, "--port");
  const workerId = process.env.JARVIS_WORKER_ID;
  const base: Params = {};
  if (targetId) base.targetId = targetId;
  if (timeoutMs !== undefined) base.timeoutMs = timeoutMs;
  if (workerId) base.workerId = workerId;

  const pos = getPositionals(args);

  // v0.6.0 retry options (interaction commands)
  const maxRetriesVal = parseIntOption(args, "--max-retries");
  const retryOpts: Params = {
    ...(args.includes("--auto-retry") ? { autoRetry: true } : {}),
    ...(maxRetriesVal !== undefined ? { maxRetries: maxRetriesVal } : {}),
  };

  switch (command) {
    case "status":
      return { ...base, ...(port !== undefined ? { port } : {}) };

    case "launch":
      return {
        ...base,
        ...(port !== undefined ? { port } : {}),
        headless: args.includes("--headless"),
        noSandbox: args.includes("--no-sandbox"),
      };

    case "connect": {
      const cdpUrl = extractOption(args, "--cdp-url");
      return { ...base, ...(cdpUrl ? { cdpUrl } : {}), ...(port !== undefined ? { port } : {}) };
    }

    case "stop":
    case "reload":
    case "back":
    case "forward":
    case "clear-cookies":
    case "tabs":
      return { ...base, ...(extractOption(args, "--url") ? { url: extractOption(args, "--url") } : {}) };

    case "cookies": {
      const urlVal = extractOption(args, "--url");
      const domainVal = extractOption(args, "--domain");
      const nameVal = extractOption(args, "--name");
      return {
        ...base,
        ...(urlVal ? { url: urlVal } : {}),
        ...(domainVal ? { domain: domainVal } : {}),
        ...(nameVal ? { name: nameVal } : {}),
      };
    }

    case "open":
      return { ...base, url: pos[0] ?? "about:blank" };

    case "close":
    case "focus":
      return { ...base, targetId: pos[0] ?? targetId ?? "" };

    case "cleanup": {
      const keepUrls = getAllFlagValues(args, "--keep");
      return { ...base, ...(keepUrls.length > 0 ? { keepUrls } : {}) };
    }

    case "navigate":
    case "goto":
      return { ...base, url: pos[0] ?? "" };

    case "snapshot": {
      const modeVal = extractOption(args, "--mode");
      const maxDepth = parseIntOption(args, "--max-depth");
      const maxChars = parseIntOption(args, "--max-chars");
      const outputFile = extractOption(args, "--output");
      return {
        ...base,
        ...(modeVal ? { mode: modeVal } : {}),
        interactive: args.includes("--interactive"),
        compact: args.includes("--compact"),
        ...(maxDepth !== undefined ? { maxDepth } : {}),
        ...(maxChars !== undefined ? { maxChars } : {}),
        ...(outputFile ? { outputFile } : {}),
      };
    }

    case "click":
      return {
        ...base,
        ...retryOpts,
        ref: pos[0] ?? "",
        doubleClick: args.includes("--double"),
        ...(extractOption(args, "--button") ? { button: extractOption(args, "--button") } : {}),
      };

    case "type":
      return {
        ...base,
        ...retryOpts,
        ref: pos[0] ?? "",
        text: pos.slice(1).join(" "),
        clearFirst: args.includes("--clear"),
        pressEnter: args.includes("--enter"),
      };

    case "fill":
      return { ...base, ...retryOpts, ref: pos[0] ?? "", value: pos.slice(1).join(" ") };

    case "select":
      return { ...base, ...retryOpts, ref: pos[0] ?? "", values: pos.slice(1) };

    case "check":
      return { ...base, ...retryOpts, ref: pos[0] ?? "", checked: !args.includes("--uncheck") };

    case "hover":
      return { ...base, ...retryOpts, ref: pos[0] ?? "" };

    case "drag":
      return { ...base, ...retryOpts, sourceRef: pos[0] ?? "", targetRef: pos[1] ?? "" };

    case "scroll": {
      const dirVal = extractOption(args, "--direction") ?? "down";
      const amountVal = extractOption(args, "--amount");
      const refVal = extractOption(args, "--ref");
      return {
        ...base,
        ...retryOpts,
        direction: dirVal,
        ...(amountVal !== undefined ? { amount: Number(amountVal) } : {}),
        ...(refVal ? { ref: refVal } : {}),
      };
    }

    case "press": {
      const refVal = extractOption(args, "--ref");
      return { ...base, ...retryOpts, key: pos[0] ?? "", ...(refVal ? { ref: refVal } : {}) };
    }

    case "wait": {
      const refVal = extractOption(args, "--ref");
      const stateVal = extractOption(args, "--state");
      const textVal = extractOption(args, "--text");
      const urlVal = extractOption(args, "--url");
      const jsVal = extractOption(args, "--js");
      const saveToVal = extractOption(args, "--save-to");
      return {
        ...base,
        ...(refVal ? { ref: refVal } : {}),
        ...(stateVal ? { state: stateVal } : {}),
        ...(textVal ? { text: textVal } : {}),
        ...(urlVal ? { url: urlVal } : {}),
        ...(jsVal ? { js: jsVal } : {}),
        ...(saveToVal ? { saveTo: saveToVal } : {}),
        networkIdle: args.includes("--network-idle"),
        navigation: args.includes("--navigation"),
        // v0.7.0 state flags
        visible: args.includes("--visible") || undefined,
        hidden: args.includes("--hidden") || undefined,
        enabled: args.includes("--enabled") || undefined,
        checked: args.includes("--checked") || undefined,
        download: args.includes("--download") || undefined,
      };
    }

    case "upload": {
      const selectorVal = extractOption(args, "--selector");
      const fileArgs = getAllFlagValues(args, "--file");
      // positionals after "upload" are file paths if no --file flags
      const files = fileArgs.length > 0 ? fileArgs : pos.slice(selectorVal ? 0 : 1);
      const refVal = selectorVal ? undefined : pos[0];
      return {
        ...base,
        ...(refVal ? { ref: refVal } : {}),
        ...(selectorVal ? { selector: selectorVal } : {}),
        files,
      };
    }

    // Observer (v0.4.0 — daemon only)
    case "console": {
      const levelVal = extractOption(args, "--level");
      const lastVal = parseIntOption(args, "--last");
      return { ...base, ...(levelVal ? { level: levelVal } : {}), ...(lastVal !== undefined ? { last: lastVal } : {}), ...(args.includes("--clear") ? { clear: true } : {}) };
    }
    case "errors": {
      const lastVal = parseIntOption(args, "--last");
      return { ...base, ...(lastVal !== undefined ? { last: lastVal } : {}) };
    }
    case "requests": {
      const filterVal = extractOption(args, "--filter");
      const urlPatternVal = extractOption(args, "--url-pattern");
      const lastVal = parseIntOption(args, "--last");
      const methodVal = extractOption(args, "--method");
      const statusVal = extractOption(args, "--status");
      return {
        ...base,
        ...(filterVal ? { filter: filterVal } : {}),
        ...(urlPatternVal ? { urlPattern: urlPatternVal } : {}),
        ...(lastVal !== undefined ? { last: lastVal } : {}),
        ...(methodVal ? { method: methodVal } : {}),
        ...(statusVal ? { statusFilter: statusVal } : {}),
        ...(args.includes("--with-body") ? { withBody: true } : {}),
      };
    }
    case "observe": {
      const includeVals = getAllFlagValues(args, "--include");
      const lastVal = parseIntOption(args, "--last");
      const exportPath = extractOption(args, "--export");
      const formatVal = extractOption(args, "--format");
      return {
        ...base,
        ...(includeVals.length > 0 ? { include: includeVals } : {}),
        ...(lastVal !== undefined ? { last: lastVal } : {}),
        ...(exportPath ? { export: exportPath } : {}),
        ...(formatVal ? { format: formatVal } : {}),
      };
    }

    case "highlight": {
      const colorVal = extractOption(args, "--color");
      const durationVal = parseIntOption(args, "--duration");
      return {
        ...base,
        ref: pos[0] ?? "",
        ...(colorVal ? { color: colorVal } : {}),
        ...(durationVal !== undefined ? { duration: durationVal } : {}),
      };
    }

    case "pdf": {
      const pathVal = extractOption(args, "--path") ?? pos[0];
      return {
        ...base,
        ...(pathVal ? { path: pathVal } : {}),
        landscape: args.includes("--landscape"),
        fullPage: args.includes("--full-page"),
      };
    }

    case "page-info":
      return base;

    case "screenshot": {
      const refVal = extractOption(args, "--ref");
      const pathVal = extractOption(args, "--path");
      return {
        ...base,
        ...(refVal ? { ref: refVal } : {}),
        ...(pathVal ? { path: pathVal } : {}),
        fullPage: args.includes("--full-page"),
      };
    }

    case "evaluate":
    case "eval": {
      const outputFile = extractOption(args, "--output");
      return {
        ...base,
        expression: "", // filled in main() after possible stdin read
        ...(outputFile ? { outputFile } : {}),
      };
    }

    case "text":
      return { ...base, ...(pos[0] ? { ref: pos[0] } : {}) };

    case "attribute":
    case "attr":
      return { ...base, ref: pos[0] ?? "", name: pos[1] ?? "" };

    case "cookies": {
      const urlVal = extractOption(args, "--url");
      const domainVal = extractOption(args, "--domain");
      const nameVal = extractOption(args, "--name");
      return {
        ...base,
        ...(urlVal ? { url: urlVal } : {}),
        ...(domainVal ? { domain: domainVal } : {}),
        ...(nameVal ? { name: nameVal } : {}),
      };
    }

    case "set-cookie":
      return { ...base, cookieJson: pos.join(" ") };

    case "batch": {
      const batchFile = extractOption(args, "--file");
      const batchOutput = extractOption(args, "--output");
      return {
        ...base,
        batchFile: batchFile ?? "",
        ...(batchOutput ? { outputFile: batchOutput } : {}),
      };
    }

    default:
      return base;
  }
}

// --- Compound command params (v0.5.0) ---
// Called as: buildCompoundParams("storage", "get", remainingArgs)
// where remainingArgs are the args AFTER the subcommand token.

function buildCompoundParams(command: string, sub: string, args: string[]): Params {
  const targetId = extractOption(args, "--target");
  const timeoutMs = parseIntOption(args, "--timeout");
  const workerId = process.env.JARVIS_WORKER_ID;
  const base: Params = {};
  if (targetId) base.targetId = targetId;
  if (timeoutMs !== undefined) base.timeoutMs = timeoutMs;
  if (workerId) base.workerId = workerId;

  const pos = getPositionals(args);
  const typeVal = extractOption(args, "--type");

  switch (`${command}.${sub}`) {
    // storage.*
    case "storage.get":
      return { ...base, key: pos[0] ?? "", ...(typeVal ? { type: typeVal } : {}) };

    case "storage.set":
      return { ...base, key: pos[0] ?? "", value: pos.slice(1).join(" "), ...(typeVal ? { type: typeVal } : {}) };

    case "storage.remove":
      return { ...base, key: pos[0] ?? "", ...(typeVal ? { type: typeVal } : {}) };

    case "storage.clear":
    case "storage.keys":
    case "storage.dump":
      return { ...base, ...(typeVal ? { type: typeVal } : {}) };

    // session.*
    case "session.save":
    case "session.load":
    case "session.delete":
      return { ...base, name: pos[0] ?? extractOption(args, "--name") ?? "" };

    case "session.list":
      return base;

    case "session.export": {
      const outputFile = extractOption(args, "--output");
      return {
        ...base,
        name: pos[0] ?? extractOption(args, "--name") ?? "",
        ...(outputFile ? { outputFile } : {}),
        includeSecrets: args.includes("--include-secrets"),
      };
    }

    case "session.import": {
      const nameVal = extractOption(args, "--name");
      return { ...base, path: pos[0] ?? "", ...(nameVal ? { name: nameVal } : {}) };
    }

    // route.*
    case "route.block":
    case "route.capture":
      return { ...base, pattern: pos[0] ?? "" };

    case "route.mock": {
      const bodyVal = extractOption(args, "--body");
      const statusStr = extractOption(args, "--status");
      const contentTypeVal = extractOption(args, "--content-type");
      return {
        ...base,
        pattern: pos[0] ?? "",
        ...(bodyVal ? { body: bodyVal } : {}),
        ...(statusStr !== undefined ? { status: Number(statusStr) } : {}),
        ...(contentTypeVal ? { contentType: contentTypeVal } : {}),
      };
    }

    case "route.list":
    case "route.clear":
      return base;

    case "route.remove":
      return { ...base, ruleId: pos[0] ?? extractOption(args, "--rule-id") ?? "" };

    case "route.captured": {
      const patternVal = extractOption(args, "--url-pattern");
      return { ...base, ...(patternVal ? { pattern: patternVal } : {}) };
    }

    // frame.*
    case "frame.list":
    case "frame.main":
      return base;

    case "frame.switch":
      return { ...base, name: pos[0] ?? extractOption(args, "--name") ?? "" };

    // config.* (v0.6.0)
    case "config.get":
      return { ...base, key: pos[0] ?? extractOption(args, "--key") ?? "" };

    case "config.set":
      return { ...base, key: pos[0] ?? extractOption(args, "--key") ?? "", value: pos.slice(1).join(" ") };

    case "config.list":
    case "config.reset":
      return base;

    // get.* (v0.7.0)
    case "get.text":
    case "get.html":
    case "get.value":
    case "get.box":
      return { ...base, ref: pos[0] ?? "" };

    case "get.attr":
      return { ...base, ref: pos[0] ?? "", attrName: pos[1] ?? extractOption(args, "--attr") ?? "" };

    case "get.title":
    case "get.url":
      return base;

    case "get.count": {
      const selectorVal = pos[0] ?? extractOption(args, "--selector") ?? "";
      return { ...base, selector: selectorVal };
    }

    // is.* (v0.7.0)
    case "is.visible":
    case "is.hidden":
    case "is.enabled":
    case "is.checked":
    case "is.editable":
      return { ...base, ref: pos[0] ?? "" };

    // dialog.* (v0.7.0)
    case "dialog.list":
    case "dialog.last":
      return base;

    case "dialog.accept": {
      const textVal = extractOption(args, "--text");
      return { ...base, ...(textVal ? { text: textVal } : {}) };
    }

    case "dialog.dismiss":
      return base;

    case "dialog.mode":
      return { ...base, mode: pos[0] ?? "" };

    // find.* (v0.8.0 FM-6)
    case "find.role": {
      const nameVal = extractOption(args, "--name");
      const actionVal = pos[1];
      const actionArgVal = pos.slice(2).join(" ") || undefined;
      return {
        ...base,
        value: pos[0] ?? "",
        ...(nameVal ? { name: nameVal } : {}),
        exact: args.includes("--exact"),
        ...(actionVal ? { action: actionVal } : {}),
        ...(actionArgVal ? { actionArg: actionArgVal } : {}),
      };
    }

    case "find.text":
    case "find.label":
    case "find.placeholder":
    case "find.testid": {
      const actionVal = pos[1];
      const actionArgVal = pos.slice(2).join(" ") || undefined;
      return {
        ...base,
        value: pos[0] ?? "",
        exact: args.includes("--exact"),
        ...(actionVal ? { action: actionVal } : {}),
        ...(actionArgVal ? { actionArg: actionArgVal } : {}),
      };
    }

    // set.* (v1.0.0)
    case "set.device":
      return { ...base, device: pos[0] ?? "" };

    case "set.viewport": {
      if (args.includes("--reset")) return { ...base, reset: true };
      return {
        ...base,
        ...(pos[0] !== undefined ? { width: Number(pos[0]) } : {}),
        ...(pos[1] !== undefined ? { height: Number(pos[1]) } : {}),
      };
    }

    case "set.geo": {
      if (args.includes("--reset")) return { ...base, reset: true };
      return {
        ...base,
        ...(pos[0] !== undefined ? { latitude: Number(pos[0]) } : {}),
        ...(pos[1] !== undefined ? { longitude: Number(pos[1]) } : {}),
        ...(pos[2] !== undefined ? { accuracy: Number(pos[2]) } : {}),
      };
    }

    case "set.headers": {
      if (args.includes("--reset")) return { ...base, reset: true };
      return { ...base, headersJson: pos.join(" ") };
    }

    // record.* (v1.0.0)
    case "record.start": {
      const fpsVal = parseIntOption(args, "--fps");
      const qualityVal = parseIntOption(args, "--quality");
      const maxFramesVal = parseIntOption(args, "--max-frames");
      return {
        ...base,
        ...(pos[0] ? { path: pos[0] } : {}),
        ...(fpsVal !== undefined ? { fps: fpsVal } : {}),
        ...(qualityVal !== undefined ? { quality: qualityVal } : {}),
        ...(maxFramesVal !== undefined ? { maxFrames: maxFramesVal } : {}),
      };
    }

    case "record.stop":
    case "record.status":
      return base;

    default:
      return base;
  }
}

// --- Direct mode (v0.2.0 behavior) ---

async function runDirect(command: string, args: string[]): Promise<void> {
  const targetId = extractOption(args, "--target");
  const timeoutMs = parseIntOption(args, "--timeout");
  const port = parseIntOption(args, "--port");
  const pos = getPositionals(args);

  // Commands that manage the connection itself — don't call ensureConnected()
  const connectionCmds = new Set(["status", "launch", "connect", "stop"]);

  if (!connectionCmds.has(command)) {
    await ensureConnected(port);
  }

  switch (command) {
    // Connection
    case "status": {
      const result = await connCmd.handleStatus({ port });
      jsonOutput(result);
      break;
    }
    case "launch": {
      const result = await connCmd.handleLaunch({
        port,
        headless: args.includes("--headless"),
        noSandbox: args.includes("--no-sandbox"),
      });
      jsonOutput(result);
      break;
    }
    case "connect": {
      const cdpUrl = extractOption(args, "--cdp-url");
      const result = await connCmd.handleConnect({ cdpUrl, port });
      jsonOutput(result);
      break;
    }
    case "stop": {
      jsonOutput(await connCmd.handleStop());
      break;
    }

    // Tabs
    case "tabs":
      jsonOutput(await tabsCmd.handleTabs({}));
      break;
    case "open":
      jsonOutput(await tabsCmd.handleOpen({ url: pos[0] ?? "about:blank" }));
      break;
    case "close": {
      const tid = pos[0];
      if (!tid) throw new Error("targetId required");
      jsonOutput(await tabsCmd.handleClose({ targetId: tid }));
      break;
    }
    case "focus": {
      const tid = pos[0];
      if (!tid) throw new Error("targetId required");
      jsonOutput(await tabsCmd.handleFocus({ targetId: tid }));
      break;
    }
    case "cleanup": {
      const keepUrls = getAllFlagValues(args, "--keep");
      jsonOutput(await tabsCmd.handleCleanup({ keepUrls: keepUrls.length > 0 ? keepUrls : undefined }));
      break;
    }

    // Navigation
    case "reload":
      jsonOutput(await navCmd.handleReload({ targetId }));
      break;
    case "back":
      jsonOutput(await navCmd.handleBack({ targetId }));
      break;
    case "forward":
      jsonOutput(await navCmd.handleForward({ targetId }));
      break;
    case "navigate":
    case "goto": {
      const url = pos[0];
      if (!url) throw new Error("url required");
      jsonOutput(await navCmd.handleNavigate({ url, targetId, timeoutMs }));
      break;
    }

    // Snapshot
    case "snapshot": {
      const modeVal = extractOption(args, "--mode") as "role" | "aria" | "ai" | undefined;
      const maxDepth = parseIntOption(args, "--max-depth");
      const maxChars = parseIntOption(args, "--max-chars");
      const outputFile = extractOption(args, "--output");
      const result = await dataCmd.handleSnapshot({
        targetId,
        mode: modeVal,
        interactive: args.includes("--interactive"),
        compact: args.includes("--compact"),
        maxDepth,
        maxChars,
        outputFile,
      });
      if (!outputFile) {
        // Print snapshot text + stats (same as v0.2.0)
        const r = result as { snapshot?: string; stats?: unknown };
        if (r.snapshot) {
          textOutput(r.snapshot);
          textOutput("\n---");
          jsonOutput(r.stats);
        } else {
          jsonOutput(result);
        }
      }
      break;
    }

    // Interaction
    case "click": {
      const ref = pos[0];
      if (!ref) throw new Error("ref required");
      jsonOutput(await interactCmd.handleClick({
        ref,
        targetId,
        button: extractOption(args, "--button") as "left" | "right" | "middle" | undefined,
        doubleClick: args.includes("--double"),
        timeoutMs,
      }));
      break;
    }
    case "type": {
      const ref = pos[0];
      const text = pos.slice(1).join(" ");
      if (!ref || !text) throw new Error("ref and text required");
      jsonOutput(await interactCmd.handleType({
        ref, text, targetId,
        clearFirst: args.includes("--clear"),
        pressEnter: args.includes("--enter"),
        timeoutMs,
      }));
      break;
    }
    case "fill": {
      const ref = pos[0];
      if (!ref) throw new Error("ref required");
      jsonOutput(await interactCmd.handleFill({ ref, value: pos.slice(1).join(" "), targetId, timeoutMs }));
      break;
    }
    case "select": {
      const ref = pos[0];
      const values = pos.slice(1);
      if (!ref || !values.length) throw new Error("ref and values required");
      jsonOutput(await interactCmd.handleSelect({ ref, values, targetId, timeoutMs }));
      break;
    }
    case "check": {
      const ref = pos[0];
      if (!ref) throw new Error("ref required");
      jsonOutput(await interactCmd.handleCheck({ ref, checked: !args.includes("--uncheck"), targetId, timeoutMs }));
      break;
    }
    case "hover": {
      const ref = pos[0];
      if (!ref) throw new Error("ref required");
      jsonOutput(await interactCmd.handleHover({ ref, targetId, timeoutMs }));
      break;
    }
    case "drag": {
      const sourceRef = pos[0];
      const targetRef = pos[1];
      if (!sourceRef || !targetRef) throw new Error("sourceRef and targetRef required");
      jsonOutput(await interactCmd.handleDrag({ sourceRef, targetRef, targetId, timeoutMs }));
      break;
    }
    case "scroll": {
      const direction = (extractOption(args, "--direction") ?? "down") as "up" | "down" | "left" | "right";
      const amountStr = extractOption(args, "--amount");
      const ref = extractOption(args, "--ref");
      jsonOutput(await interactCmd.handleScroll({
        direction,
        ref,
        targetId,
        amount: amountStr ? Number(amountStr) : undefined,
      }));
      break;
    }
    case "press": {
      const key = pos[0];
      if (!key) throw new Error("key required (e.g., Enter, Tab, Escape)");
      jsonOutput(await interactCmd.handlePress({ key, ref: extractOption(args, "--ref"), targetId, timeoutMs }));
      break;
    }
    case "wait": {
      const ref = extractOption(args, "--ref");
      const state = extractOption(args, "--state") as "visible" | "hidden" | "attached" | "detached" | undefined;
      const text = extractOption(args, "--text");
      const url = extractOption(args, "--url");
      const js = extractOption(args, "--js");
      const saveTo = extractOption(args, "--save-to");
      jsonOutput(await interactCmd.handleWait({
        ref, state, targetId, timeoutMs,
        ...(text ? { text } : {}),
        ...(url ? { url } : {}),
        ...(js ? { js } : {}),
        ...(saveTo ? { saveTo } : {}),
        networkIdle: args.includes("--network-idle"),
        navigation: args.includes("--navigation"),
        visible: args.includes("--visible") || undefined,
        hidden: args.includes("--hidden") || undefined,
        enabled: args.includes("--enabled") || undefined,
        checked: args.includes("--checked") || undefined,
        download: args.includes("--download") || undefined,
      }));
      break;
    }

    // Upload (v0.7.0)
    case "upload": {
      const selectorVal = extractOption(args, "--selector");
      const fileFlags = getAllFlagValues(args, "--file");
      const files = fileFlags.length > 0 ? fileFlags : pos.slice(selectorVal ? 0 : 1);
      const refVal = selectorVal ? undefined : pos[0];
      jsonOutput(await interactCmd.handleUploadFile({ ref: refVal, selector: selectorVal, files, targetId, timeoutMs }));
      break;
    }

    // Screenshot
    case "screenshot": {
      jsonOutput(await dataCmd.handleScreenshot({
        ref: extractOption(args, "--ref"),
        path: extractOption(args, "--path"),
        fullPage: args.includes("--full-page"),
        targetId,
      }));
      break;
    }

    // Evaluate
    case "evaluate":
    case "eval": {
      let expression: string;
      const filePath = extractOption(args, "--file");
      const positionalExpr = pos.join(" ");
      if (filePath) {
        const { readFileSync } = await import("node:fs");
        expression = readFileSync(filePath, "utf-8").trim();
      } else if (positionalExpr) {
        expression = positionalExpr;
      } else if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        expression = Buffer.concat(chunks).toString("utf-8").trim();
      } else {
        expression = "";
      }
      if (!expression) throw new Error("expression required");
      expression = expression.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
      const outputFile = extractOption(args, "--output");
      jsonOutput(await dataCmd.handleEvaluate({ expression, targetId, outputFile }));
      break;
    }

    // Text / attribute
    case "text":
      jsonOutput(await dataCmd.handleText({ ref: pos[0], targetId, timeoutMs }));
      break;
    case "attribute":
    case "attr": {
      const ref = pos[0];
      const name = pos[1];
      if (!ref || !name) throw new Error("ref and attribute name required");
      jsonOutput(await dataCmd.handleAttribute({ ref, name, targetId, timeoutMs }));
      break;
    }

    // Cookies
    case "cookies":
      jsonOutput(await dataCmd.handleCookies({ targetId, url: extractOption(args, "--url") }));
      break;
    case "set-cookie": {
      const cookieJson = pos.join(" ");
      if (!cookieJson) throw new Error("Cookie JSON required");
      jsonOutput(await dataCmd.handleSetCookie({ cookieJson }));
      break;
    }
    case "clear-cookies":
      jsonOutput(await dataCmd.handleClearCookies({ targetId }));
      break;

    // Batch
    case "batch": {
      const batchFile = extractOption(args, "--file");
      const batchOutput = extractOption(args, "--output");
      if (!batchFile) throw new Error("--file required for batch mode");
      const { readFileSync } = await import("node:fs");
      const commands = JSON.parse(readFileSync(batchFile, "utf-8")) as Array<Record<string, unknown>>;
      jsonOutput(await batchCmd.handleBatch({ commands, outputFile: batchOutput }));
      break;
    }

    default:
      textOutput(`Unknown command: ${command}. Use --help for usage.`);
      process.exit(1);
  }
}

// --- Daemon subcommands ---

async function runDaemonSubcommand(subcommand: string, args: string[]): Promise<void> {
  const port = parseIntOption(args, "--port");

  switch (subcommand) {
    case "start": {
      if (isDaemonRunning()) {
        jsonOutput({ ok: true, message: "Daemon already running", socket: getSocketPath() });
        break;
      }
      process.stderr.write("[jarvis-browser] Starting daemon...\n");
      await startDaemon({ port });
      jsonOutput({ ok: true, message: "Daemon started", socket: getSocketPath() });
      break;
    }
    case "stop": {
      await stopDaemon();
      jsonOutput({ ok: true, message: "Daemon stopped" });
      break;
    }
    case "status": {
      if (!isDaemonRunning()) {
        jsonOutput({ ok: false, running: false });
        break;
      }
      jsonOutput(await getDaemonStatusViaRpc());
      break;
    }
    case "health": {
      jsonOutput(await getDaemonHealthViaRpc());
      break;
    }
    default:
      textOutput(`Unknown daemon subcommand: ${subcommand}. Use: start|stop|status|health`);
      process.exit(1);
  }
}

// --- Daemon mode: send command via socket ---

async function buildFinalParams(command: string, args: string[]): Promise<Params> {
  const base = buildParams(command, args);
  if (command !== "evaluate" && command !== "eval") return base;

  const expression = await (async () => {
    const filePath = extractOption(args, "--file");
    const pos = getPositionals(args);
    const positionalExpr = pos.join(" ");
    if (filePath) {
      const { readFileSync } = await import("node:fs");
      return readFileSync(filePath, "utf-8").trim();
    }
    if (positionalExpr) return positionalExpr;
    if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf-8").trim();
    }
    return "";
  })();

  if (!expression) throw new Error("expression required");
  const normalized = expression.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  return { ...base, expression: normalized };
}

async function runViaDaemon(command: string, args: string[]): Promise<void> {
  const params = await buildFinalParams(command, args);

  // Normalize command alias
  const method = command === "goto" ? "navigate" : command === "eval" ? "evaluate" : command === "attr" ? "attribute" : command;

  const socket = await (async () => {
    const s = await tryConnect();
    if (s) return s;
    // Auto-start daemon
    const port = parseIntOption(args, "--port");
    process.stderr.write("[jarvis-browser] Daemon not running, starting...\n");
    await startDaemon({ port });
    const s2 = await tryConnect(5000);
    if (!s2) throw new Error("Failed to connect to daemon after auto-start");
    return s2;
  })();

  try {
    const result = await sendRequest(socket, method, params);

    // Special output for snapshot (print text + stats)
    if (command === "snapshot" && !params.outputFile) {
      const r = result as { snapshot?: string; stats?: unknown };
      if (r.snapshot) {
        textOutput(r.snapshot);
        textOutput("\n---");
        jsonOutput(r.stats);
        return;
      }
    }

    jsonOutput(result);
  } finally {
    socket.end();
  }
}

// --- Compound command via daemon (v0.5.0) ---

async function runCompoundViaDaemon(command: string, sub: string, args: string[]): Promise<void> {
  const method = `${command}.${sub}`;
  const params = buildCompoundParams(command, sub, args);
  // v0.7.0 commands support human-readable output by default; --json forces envelope
  const isV07Cmd = command === "get" || command === "is" || command === "dialog" || command === "find";
  const jsonMode = args.includes("--json");

  const socket = await (async () => {
    const s = await tryConnect();
    if (s) return s;
    const port = parseIntOption(args, "--port");
    process.stderr.write("[jarvis-browser] Daemon not running, starting...\n");
    await startDaemon({ port });
    const s2 = await tryConnect(5000);
    if (!s2) throw new Error("Failed to connect to daemon after auto-start");
    return s2;
  })();

  try {
    const result = await sendRequest(socket, method, params);
    if (isV07Cmd) {
      formatOutput(result as ActionResult, jsonMode);
    } else {
      jsonOutput(result);
    }
  } finally {
    socket.end();
  }
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") usage();

  const command = args[0] ?? "";
  const rest = args.slice(1);

  try {
    // daemon subcommands always run locally (never via socket)
    if (command === "daemon") {
      const sub = rest[0] ?? "status";
      await runDaemonSubcommand(sub, rest.slice(1));
      process.exit(0);
    }

    // Compound commands (v0.5.0+): storage | session | route | frame | config | get | is | dialog | find | set | record
    const COMPOUND_COMMANDS = new Set(["storage", "session", "route", "frame", "config", "get", "is", "dialog", "find", "set", "record"]);
    if (COMPOUND_COMMANDS.has(command)) {
      const sub = rest[0];
      if (!sub || sub.startsWith("--")) {
        textOutput(`Usage: jarvis-browser ${command} <subcommand> [args]. Use --help for details.`);
        process.exit(1);
      }
      await runCompoundViaDaemon(command, sub, rest.slice(1));
      process.exit(0);
    }

    // Direct mode: --direct flag or env var
    const isDirect =
      rest.includes("--direct") ||
      process.env.JARVIS_BROWSER_DIRECT === "1";

    if (isDirect) {
      await runDirect(command, rest.filter((a) => a !== "--direct"));
    } else {
      await runViaDaemon(command, rest);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    jsonOutput({ ok: false, error: message });
    process.exit(1);
  }

  process.exit(0);
}

main();
