// JSON-RPC 2.0 server over Unix Domain Socket
// The daemon runs this server to handle CLI client requests.

import net from "node:net";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  ERROR_CODES,
  makeResponse,
  makeErrorResponse,
  validateRequest,
  type RpcRequest,
} from "./protocol.js";
import * as connCmd from "./commands/connection.js";
import * as tabsCmd from "./commands/tabs.js";
import * as navCmd from "./commands/navigation.js";
import * as interactCmd from "./commands/interaction.js";
import * as dataCmd from "./commands/data.js";
import * as batchCmd from "./commands/batch.js";
import { getSocketPath } from "./client.js";
import * as obsCmds from "./commands/observe.js";
import * as storageCmd from "./commands/storage-cmd.js";
import * as sessionCmd from "./commands/session-cmd.js";
import * as networkCmd from "./commands/network-cmd.js";
import * as frameCmd from "./commands/frame-cmd.js";
import * as configCmd from "./commands/config-cmd.js";
import * as getCmds from "./commands/get-cmd.js";
import * as stateCmds from "./commands/state-cmd.js";
import * as dialogCmds from "./commands/dialog-cmd.js";
import * as findCmds from "./commands/find-cmd.js";
import type { FindAction } from "./commands/find-cmd.js";
import * as highlightCmd from "./commands/highlight-cmd.js";
import * as emulationCmd from "./commands/emulation.js";
import * as pdfCmd from "./commands/pdf-cmd.js";
import * as recordingCmd from "./commands/recording.js";
import { globalObserver, setNetworkBodyMaxKb } from "./observer.js";
import { getRetryStats } from "./stats.js";
import { globalNetwork } from "./network.js";
import { getPage, setDialogMode } from "./browser.js";

// --- Chrome status (set by daemon.ts when Chrome connects/disconnects) ---

const _chrome = { connected: false, cdpUrl: "" };

export function setChromeStatus(connected: boolean, cdpUrl: string): void {
  _chrome.connected = connected;
  _chrome.cdpUrl = connected ? cdpUrl : "";
}

// --- Tab ownership tracking ---

// Maps targetId → workerId for ownership enforcement
const tabOwnership = new Map<string, string>();

function getWorkerId(params?: Record<string, unknown>): string {
  return String(params?.workerId ?? "");
}

export function claimTab(targetId: string, workerId: string): void {
  if (workerId) tabOwnership.set(targetId, workerId);
}

export function releaseTab(targetId: string): void {
  tabOwnership.delete(targetId);
}

function checkTabOwnership(
  targetId: string | undefined,
  requestingWorker: string,
): string | null {
  if (!targetId || !requestingWorker) return null; // no ownership check needed
  const owner = tabOwnership.get(targetId);
  if (owner && owner !== requestingWorker) {
    return `Tab "${targetId}" is owned by worker "${owner}"`;
  }
  return null; // ok
}

// --- Idle timer ---

const _idle: {
  timer: ReturnType<typeof setTimeout> | null;
  callback: (() => void) | null;
} = { timer: null, callback: null };
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function resetIdleTimer(): void {
  if (_idle.timer) clearTimeout(_idle.timer);
  if (IDLE_TIMEOUT_MS <= 0 || !_idle.callback) return;
  _idle.timer = setTimeout(() => {
    process.stderr.write("[jarvis-daemon] Idle timeout reached, shutting down.\n");
    _idle.callback?.();
  }, IDLE_TIMEOUT_MS);
  _idle.timer.unref(); // don't keep process alive for this timer alone
}

export function setShutdownCallback(fn: () => void): void {
  _idle.callback = fn;
  resetIdleTimer();
}

// --- Request routing ---

type Params = Record<string, unknown>;

async function routeRequest(req: RpcRequest): Promise<unknown> {
  const params = (req.params ?? {}) as Params;
  const workerId = getWorkerId(params);
  const targetId = params.targetId as string | undefined;

  // Tab ownership check for tab-specific operations
  const tabOps = new Set([
    "navigate", "reload", "back", "forward", "snapshot", "click", "type",
    "fill", "select", "check", "hover", "drag", "scroll", "press", "wait",
    "screenshot", "evaluate", "text", "attribute", "cookies", "set-cookie",
    "clear-cookies", "close", "focus",
    // v0.5.0 compound methods
    "storage.get", "storage.set", "storage.remove", "storage.clear",
    "storage.keys", "storage.dump",
    "session.save", "session.load",
    "route.block", "route.mock", "route.capture", "route.remove", "route.clear",
    "route.captured", "frame.list", "frame.switch", "frame.main",
    // v0.7.0 new commands
    "upload",
    "get.text", "get.html", "get.value", "get.attr", "get.title", "get.url", "get.count", "get.box",
    "is.visible", "is.hidden", "is.enabled", "is.checked", "is.editable",
    // v0.8.0 find commands
    "find.role", "find.text", "find.label", "find.placeholder", "find.testid",
    // v0.9.0
    "highlight",
    // v1.0.0
    "set.device", "set.viewport", "set.geo", "set.headers",
    "pdf",
    "record.start", "record.stop", "record.status",
  ]);

  if (tabOps.has(req.method) && targetId) {
    const ownerError = checkTabOwnership(targetId, workerId);
    if (ownerError) {
      throw Object.assign(new Error(ownerError), { rpcCode: ERROR_CODES.TAB_OWNED_BY_OTHER });
    }
  }

  switch (req.method) {
    // Connection
    case "status":
      return connCmd.handleStatus({ port: params.port as number | undefined });
    case "launch":
      return connCmd.handleLaunch({
        port: params.port as number | undefined,
        headless: params.headless as boolean | undefined,
        noSandbox: params.noSandbox as boolean | undefined,
      });
    case "connect":
      return connCmd.handleConnect({
        cdpUrl: params.cdpUrl as string | undefined,
        port: params.port as number | undefined,
      });
    case "stop":
      return connCmd.handleStop();

    // Tabs
    case "tabs":
      return tabsCmd.handleTabs({ workerId });
    case "open": {
      const result = await tabsCmd.handleOpen({
        url: String(params.url ?? "about:blank"),
        workerId,
      });
      // Register tab ownership and attach observer
      const tabResult = result as { targetId?: string };
      if (tabResult.targetId) {
        if (workerId) claimTab(tabResult.targetId, workerId);
        const page = await getPage(tabResult.targetId).catch(() => null);
        if (page) globalObserver.attach(page, tabResult.targetId);
      }
      return result;
    }
    case "close": {
      const tid = String(params.targetId ?? "");
      await tabsCmd.handleClose({ targetId: tid, workerId });
      releaseTab(tid);
      globalObserver.destroy(tid);
      globalNetwork.destroyTab(tid);
      return { ok: true, message: `Closed ${tid}` };
    }
    case "focus":
      return tabsCmd.handleFocus({
        targetId: String(params.targetId ?? ""),
        workerId,
      });
    case "cleanup":
      return tabsCmd.handleCleanup({
        keepUrls: params.keepUrls as string[] | undefined,
        workerId,
      });

    // Navigation
    case "navigate":
      return navCmd.handleNavigate({
        url: String(params.url),
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "reload":
      return navCmd.handleReload({ targetId: params.targetId as string | undefined });
    case "back":
      return navCmd.handleBack({ targetId: params.targetId as string | undefined });
    case "forward":
      return navCmd.handleForward({ targetId: params.targetId as string | undefined });

    // Snapshot
    case "snapshot": {
      const result = await dataCmd.handleSnapshot({
        targetId: params.targetId as string | undefined,
        mode: params.mode as "role" | "aria" | "ai" | undefined,
        interactive: params.interactive as boolean | undefined,
        compact: params.compact as boolean | undefined,
        maxDepth: params.maxDepth as number | undefined,
        maxChars: params.maxChars as number | undefined,
        outputFile: params.outputFile as string | undefined,
      });
      // Record snapshot time for observe's snapshot_stale field
      if (targetId) globalObserver.recordSnapshot(targetId);
      return result;
    }

    // Interaction
    case "click":
      return interactCmd.handleClick({
        ref: String(params.ref),
        targetId: params.targetId as string | undefined,
        button: params.button as "left" | "right" | "middle" | undefined,
        doubleClick: params.doubleClick as boolean | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "type":
      return interactCmd.handleType({
        ref: String(params.ref),
        text: String(params.text),
        targetId: params.targetId as string | undefined,
        clearFirst: params.clearFirst as boolean | undefined,
        pressEnter: params.pressEnter as boolean | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "fill":
      return interactCmd.handleFill({
        ref: String(params.ref),
        value: String(params.value ?? ""),
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "select":
      return interactCmd.handleSelect({
        ref: String(params.ref),
        values: params.values as string[],
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "check":
      return interactCmd.handleCheck({
        ref: String(params.ref),
        checked: params.checked as boolean ?? true,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "hover":
      return interactCmd.handleHover({
        ref: String(params.ref),
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "drag":
      return interactCmd.handleDrag({
        sourceRef: String(params.sourceRef),
        targetRef: String(params.targetRef),
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "scroll":
      return interactCmd.handleScroll({
        direction: (params.direction as "up" | "down" | "left" | "right") ?? "down",
        ref: params.ref as string | undefined,
        targetId: params.targetId as string | undefined,
        amount: params.amount as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });
    case "press":
      return interactCmd.handlePress({
        key: String(params.key),
        ref: params.ref as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        autoRetry: params.autoRetry as boolean | undefined,
        maxRetries: params.maxRetries as number | undefined,
      });

    // Wait
    case "wait":
      return interactCmd.handleWait({
        ref: params.ref as string | undefined,
        state: params.state as "visible" | "hidden" | "attached" | "detached" | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
        text: params.text as string | undefined,
        url: params.url as string | undefined,
        js: params.js as string | undefined,
        networkIdle: params.networkIdle as boolean | undefined,
        navigation: params.navigation as boolean | undefined,
        visible: params.visible as boolean | undefined,
        hidden: params.hidden as boolean | undefined,
        enabled: params.enabled as boolean | undefined,
        checked: params.checked as boolean | undefined,
        download: params.download as boolean | undefined,
        saveTo: params.saveTo as string | undefined,
      });

    // Upload (v0.7.0 FM-2)
    case "upload":
      return interactCmd.handleUploadFile({
        ref: params.ref as string | undefined,
        selector: params.selector as string | undefined,
        files: params.files as string[],
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });

    // Get (v0.7.0 FM-3 / FM-4)
    case "get.text":
      return getCmds.handleGetText({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined, timeoutMs: params.timeoutMs as number | undefined });
    case "get.html":
      return getCmds.handleGetHtml({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined, timeoutMs: params.timeoutMs as number | undefined });
    case "get.value":
      return getCmds.handleGetValue({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined, timeoutMs: params.timeoutMs as number | undefined });
    case "get.attr":
      return getCmds.handleGetAttr({ ref: String(params.ref ?? ""), attrName: String(params.attrName ?? ""), targetId: params.targetId as string | undefined, timeoutMs: params.timeoutMs as number | undefined });
    case "get.title":
      return getCmds.handleGetTitle({ targetId: params.targetId as string | undefined });
    case "get.url":
      return getCmds.handleGetUrl({ targetId: params.targetId as string | undefined });
    case "get.count":
      return getCmds.handleGetCount({ selector: String(params.selector ?? ""), targetId: params.targetId as string | undefined });
    case "get.box":
      return getCmds.handleGetBox({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined, timeoutMs: params.timeoutMs as number | undefined });

    // Is (v0.7.0 FM-3)
    case "is.visible":
      return stateCmds.handleIsVisible({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined });
    case "is.hidden":
      return stateCmds.handleIsHidden({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined });
    case "is.enabled":
      return stateCmds.handleIsEnabled({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined });
    case "is.checked":
      return stateCmds.handleIsChecked({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined });
    case "is.editable":
      return stateCmds.handleIsEditable({ ref: String(params.ref ?? ""), targetId: params.targetId as string | undefined });

    // Dialog (v0.7.0 FM-1)
    case "dialog.list":
      return dialogCmds.handleDialogList();
    case "dialog.last":
      return dialogCmds.handleDialogLast();
    case "dialog.accept":
      return dialogCmds.handleDialogAccept({ text: params.text as string | undefined });
    case "dialog.dismiss":
      return dialogCmds.handleDialogDismiss();
    case "dialog.mode": {
      const mode = String(params.mode ?? "");
      if (!["accept", "dismiss", "queue"].includes(mode)) {
        return { ok: false, error: `Invalid mode "${mode}". Use: accept | dismiss | queue` };
      }
      setDialogMode(mode as "accept" | "dismiss" | "queue");
      // Persist to config too
      await configCmd.handleConfigSet({ key: "dialog-mode", value: mode });
      return { ok: true, message: `Dialog mode set to "${mode}"` };
    }

    // Data
    case "screenshot":
      return dataCmd.handleScreenshot({
        ref: params.ref as string | undefined,
        path: params.path as string | undefined,
        fullPage: params.fullPage as boolean | undefined,
        targetId: params.targetId as string | undefined,
      });
    case "evaluate":
      return dataCmd.handleEvaluate({
        expression: String(params.expression),
        targetId: params.targetId as string | undefined,
        outputFile: params.outputFile as string | undefined,
      });
    case "text":
      return dataCmd.handleText({
        ref: params.ref as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "attribute":
      return dataCmd.handleAttribute({
        ref: String(params.ref),
        name: String(params.name),
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "cookies":
      return dataCmd.handleCookies({
        targetId: params.targetId as string | undefined,
        url: params.url as string | undefined,
        domain: params.domain as string | undefined,
        name: params.name as string | undefined,
      });
    case "set-cookie":
      return dataCmd.handleSetCookie({
        cookieJson: String(params.cookieJson),
      });
    case "clear-cookies":
      return dataCmd.handleClearCookies({
        targetId: params.targetId as string | undefined,
      });

    // Batch
    case "batch":
      return batchCmd.handleBatch({
        commands: params.commands as Array<Record<string, unknown>>,
        outputFile: params.outputFile as string | undefined,
      });

    // Observer (v0.4.0)
    case "console":
      return obsCmds.handleConsole({
        targetId: params.targetId as string | undefined,
        level: params.level as string | undefined,
        last: params.last as number | undefined,
        clear: params.clear as boolean | undefined,
      });
    case "errors":
      return obsCmds.handleErrors({
        targetId: params.targetId as string | undefined,
        last: params.last as number | undefined,
      });
    case "requests":
      return obsCmds.handleRequests({
        targetId: params.targetId as string | undefined,
        filter: params.filter as string | undefined,
        urlPattern: params.urlPattern as string | undefined,
        last: params.last as number | undefined,
        method: params.method as string | undefined,
        statusFilter: params.statusFilter as string | undefined,
        withBody: params.withBody as boolean | undefined,
      });
    case "observe":
      return obsCmds.handleObserve({
        targetId: params.targetId as string | undefined,
        include: params.include as string | undefined,
        export: params.export as string | undefined,
        format: params.format as string | undefined,
      });
    case "page-info":
      return obsCmds.handlePageInfo({
        targetId: params.targetId as string | undefined,
      });

    // Storage (v0.5.0)
    case "storage.get":
      return storageCmd.handleStorageGet({
        key: String(params.key ?? ""),
        type: params.type,
        targetId: params.targetId as string | undefined,
      });
    case "storage.set":
      return storageCmd.handleStorageSet({
        key: String(params.key ?? ""),
        value: String(params.value ?? ""),
        type: params.type,
        targetId: params.targetId as string | undefined,
      });
    case "storage.remove":
      return storageCmd.handleStorageRemove({
        key: String(params.key ?? ""),
        type: params.type,
        targetId: params.targetId as string | undefined,
      });
    case "storage.clear":
      return storageCmd.handleStorageClear({
        type: params.type,
        targetId: params.targetId as string | undefined,
      });
    case "storage.keys":
      return storageCmd.handleStorageKeys({
        type: params.type,
        targetId: params.targetId as string | undefined,
      });
    case "storage.dump":
      return storageCmd.handleStorageDump({
        type: params.type,
        targetId: params.targetId as string | undefined,
      });

    // Session (v0.5.0)
    case "session.save":
      return sessionCmd.handleSessionSave({
        name: String(params.name ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "session.load":
      return sessionCmd.handleSessionLoad({
        name: String(params.name ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "session.list":
      return sessionCmd.handleSessionList(params);
    case "session.delete":
      return sessionCmd.handleSessionDelete({ name: String(params.name ?? "") });
    case "session.export":
      return sessionCmd.handleSessionExport({
        name: String(params.name ?? ""),
        outputFile: params.outputFile as string | undefined,
        includeSecrets: params.includeSecrets as boolean | undefined,
      });
    case "session.import":
      return sessionCmd.handleSessionImport({
        path: String(params.path ?? ""),
        name: params.name as string | undefined,
      });

    // Route / Network (v0.5.0)
    case "route.block":
      return networkCmd.handleRouteBlock({
        pattern: String(params.pattern ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "route.mock":
      return networkCmd.handleRouteMock({
        pattern: String(params.pattern ?? ""),
        body: params.body as string | undefined,
        status: params.status as number | undefined,
        contentType: params.contentType as string | undefined,
        targetId: params.targetId as string | undefined,
      });
    case "route.capture":
      return networkCmd.handleRouteCapture({
        pattern: String(params.pattern ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "route.list":
      return networkCmd.handleRouteList({
        targetId: params.targetId as string | undefined,
      });
    case "route.remove":
      return networkCmd.handleRouteRemove({
        ruleId: String(params.ruleId ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "route.clear":
      return networkCmd.handleRouteClear({
        targetId: params.targetId as string | undefined,
      });
    case "route.captured":
      return networkCmd.handleRouteCaptured({
        pattern: params.pattern as string | undefined,
        targetId: params.targetId as string | undefined,
      });

    // Frame (v0.5.0)
    case "frame.list":
      return frameCmd.handleFrameList({
        targetId: params.targetId as string | undefined,
      });
    case "frame.switch":
      return frameCmd.handleFrameSwitch({
        name: String(params.name ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "frame.main":
      return frameCmd.handleFrameMain({
        targetId: params.targetId as string | undefined,
      });

    // Config (v0.6.0)
    case "config.get":
      return configCmd.handleConfigGet({ key: String(params.key ?? "") });
    case "config.set": {
      const cfgKey = String(params.key ?? "");
      const cfgVal = String(params.value ?? "");
      const result = await configCmd.handleConfigSet({ key: cfgKey, value: cfgVal });
      // Apply in-memory side effects for keys that need runtime state
      if (cfgKey === "network-body-max-kb") {
        setNetworkBodyMaxKb(Number(cfgVal));
      }
      return result;
    }
    case "config.list":
      return configCmd.handleConfigList();
    case "config.reset":
      return configCmd.handleConfigReset();

    // Find (v0.8.0 FM-6)
    case "find.role":
      return findCmds.handleFindRole({
        value: String(params.value ?? ""),
        name: params.name as string | undefined,
        exact: params.exact as boolean | undefined,
        action: params.action as FindAction | undefined,
        actionArg: params.actionArg as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "find.text":
      return findCmds.handleFindText({
        value: String(params.value ?? ""),
        exact: params.exact as boolean | undefined,
        action: params.action as FindAction | undefined,
        actionArg: params.actionArg as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "find.label":
      return findCmds.handleFindLabel({
        value: String(params.value ?? ""),
        exact: params.exact as boolean | undefined,
        action: params.action as FindAction | undefined,
        actionArg: params.actionArg as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "find.placeholder":
      return findCmds.handleFindPlaceholder({
        value: String(params.value ?? ""),
        exact: params.exact as boolean | undefined,
        action: params.action as FindAction | undefined,
        actionArg: params.actionArg as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });
    case "find.testid":
      return findCmds.handleFindTestid({
        value: String(params.value ?? ""),
        action: params.action as FindAction | undefined,
        actionArg: params.actionArg as string | undefined,
        targetId: params.targetId as string | undefined,
        timeoutMs: params.timeoutMs as number | undefined,
      });

    // Highlight (v0.9.0 FM-4)
    case "highlight":
      return highlightCmd.handleHighlight({
        ref: String(params.ref ?? ""),
        color: params.color as string | undefined,
        duration: params.duration as number | undefined,
        targetId: params.targetId as string | undefined,
      });

    // Emulation (v1.0.0)
    case "set.device":
      return emulationCmd.handleSetDevice({
        device: String(params.device ?? ""),
        targetId: params.targetId as string | undefined,
      });
    case "set.viewport":
      return emulationCmd.handleSetViewport({
        width: params.width as number | undefined,
        height: params.height as number | undefined,
        reset: params.reset as boolean | undefined,
        targetId: params.targetId as string | undefined,
      });
    case "set.geo":
      return emulationCmd.handleSetGeo({
        latitude: params.latitude as number | undefined,
        longitude: params.longitude as number | undefined,
        accuracy: params.accuracy as number | undefined,
        reset: params.reset as boolean | undefined,
        targetId: params.targetId as string | undefined,
      });
    case "set.headers":
      return emulationCmd.handleSetHeaders({
        headersJson: params.headersJson as string | undefined,
        reset: params.reset as boolean | undefined,
        targetId: params.targetId as string | undefined,
      });

    // PDF (v1.0.0)
    case "pdf":
      return pdfCmd.handlePdf({
        path: params.path as string | undefined,
        fullPage: params.fullPage as boolean | undefined,
        landscape: params.landscape as boolean | undefined,
        targetId: params.targetId as string | undefined,
      });

    // Recording (v1.0.0)
    case "record.start":
      return recordingCmd.handleRecordStart({
        path: params.path as string | undefined,
        fps: params.fps as number | undefined,
        quality: params.quality as number | undefined,
        maxFrames: params.maxFrames as number | undefined,
        targetId: params.targetId as string | undefined,
      });
    case "record.stop":
      return recordingCmd.handleRecordStop();
    case "record.status":
      return recordingCmd.handleRecordStatus();

    // Daemon management
    case "daemon.status":
      return getDaemonStatus();
    case "daemon.health":
      return getDaemonHealth();
    case "daemon.stop":
      // Signal shutdown after sending response
      setImmediate(() => _idle.callback?.());
      return { ok: true, message: "Daemon shutting down" };

    default:
      throw Object.assign(new Error(`Unknown method: ${req.method}`), {
        rpcCode: ERROR_CODES.METHOD_NOT_FOUND,
      });
  }
}

// --- Daemon introspection ---

const daemonStartTime = Date.now();

function getDaemonStatus(): object {
  return {
    ok: true,
    pid: process.pid,
    uptime_s: Math.floor((Date.now() - daemonStartTime) / 1000),
    socket: getSocketPath(),
  };
}

function getDaemonHealth(): object {
  const used = process.memoryUsage();
  return {
    daemon: {
      pid: process.pid,
      uptime_s: Math.floor((Date.now() - daemonStartTime) / 1000),
      memory_mb: Math.round(used.rss / 1024 / 1024),
    },
    chrome: {
      connected: _chrome.connected,
      tabs: 0,       // Phase 2: populated by observer
      cdp_url: _chrome.cdpUrl,
    },
    buffers: { console: 0, network: 0, routes: 0 }, // Phase 2 stubs
    refs: { cached_targets: 0, total_refs: 0 },      // Phase 2 stubs
    tabs: {
      owned: tabOwnership.size,
    },
    retry_stats: getRetryStats(),
  };
}

// --- Server lifecycle ---

const _srv: { instance: net.Server | null } = { instance: null };

export async function startServer(): Promise<void> {
  const socketPath = getSocketPath();

  // Remove stale socket file (from crashed daemon)
  if (existsSync(socketPath)) {
    // Try connecting — if refused, it's stale and safe to remove
    const isAlive = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection(socketPath);
      probe.once("connect", () => { probe.end(); resolve(true); });
      probe.once("error", () => resolve(false));
      setTimeout(() => { probe.destroy(); resolve(false); }, 500);
    });

    if (!isAlive) {
      await unlink(socketPath).catch(() => {});
    } else {
      throw new Error(`Another daemon is already running at ${socketPath}`);
    }
  }

  const srv = net.createServer((socket) => {
    handleConnection(socket);
  });
  _srv.instance = srv;

  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(socketPath, resolve);
  });

  resetIdleTimer();
  process.stderr.write(`[jarvis-daemon] Listening on ${socketPath}\n`);
}

export async function stopServer(): Promise<void> {
  if (_idle.timer) {
    clearTimeout(_idle.timer);
    _idle.timer = null;
  }
  if (!_srv.instance) return;
  const srv = _srv.instance;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  _srv.instance = null;

  const socketPath = getSocketPath();
  await unlink(socketPath).catch(() => {});
}

// --- Per-connection handling ---

function handleConnection(socket: net.Socket): void {
  const conn = { buffer: "" };

  socket.on("data", (chunk: Buffer) => {
    conn.buffer += chunk.toString("utf-8");
    for (;;) {
      const newlineIdx = conn.buffer.indexOf("\n");
      if (newlineIdx === -1) break;
      const line = conn.buffer.slice(0, newlineIdx);
      conn.buffer = conn.buffer.slice(newlineIdx + 1);
      if (line.trim()) processLine(socket, line);
    }
  });

  socket.on("error", () => { /* ignore client disconnect errors */ });
}

function processLine(socket: net.Socket, line: string): void {
  resetIdleTimer();

  const parsedResult = (() => {
    try { return { ok: true as const, value: JSON.parse(line) as unknown }; }
    catch { return { ok: false as const }; }
  })();

  if (!parsedResult.ok) {
    const resp = makeErrorResponse(null, ERROR_CODES.PARSE_ERROR, "Parse error: invalid JSON");
    socket.write(JSON.stringify(resp) + "\n");
    return;
  }

  const req = validateRequest(parsedResult.value);
  if (!req) {
    const resp = makeErrorResponse(null, ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request");
    socket.write(JSON.stringify(resp) + "\n");
    return;
  }

  routeRequest(req)
    .then((result) => {
      const resp = makeResponse(req.id, result);
      socket.write(JSON.stringify(resp) + "\n");
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err instanceof Error && "rpcCode" in err)
        ? (err as NodeJS.ErrnoException & { rpcCode: number }).rpcCode
        : ERROR_CODES.ACTION_FAILED;
      const resp = makeErrorResponse(req.id, code, message);
      socket.write(JSON.stringify(resp) + "\n");
    });
}
