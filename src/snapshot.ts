// Role Snapshot system - ported from OpenClaw (MIT License)
// https://github.com/openclaw/openclaw/blob/main/src/browser/pw-role-snapshot.ts
// Pure functions, zero dependencies.

import type { RoleRef, RoleRefMap, RoleSnapshotOptions, RoleSnapshotStats } from "./types.js";

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox",
  "listbox", "menuitem", "menuitemcheckbox", "menuitemradio",
  "option", "searchbox", "slider", "spinbutton", "switch",
  "tab", "treeitem",
]);

const CONTENT_ROLES = new Set([
  "heading", "cell", "gridcell", "columnheader", "rowheader",
  "listitem", "article", "region", "main", "navigation",
]);

const STRUCTURAL_ROLES = new Set([
  "generic", "group", "list", "table", "row", "rowgroup",
  "grid", "treegrid", "menu", "menubar", "toolbar", "tablist",
  "tree", "directory", "document", "application", "presentation", "none",
]);

export function getRoleSnapshotStats(snapshot: string, refs: RoleRefMap): RoleSnapshotStats {
  const interactive = Object.values(refs).filter((r) => INTERACTIVE_ROLES.has(r.role)).length;
  return {
    lines: snapshot.split("\n").length,
    chars: snapshot.length,
    refs: Object.keys(refs).length,
    interactive,
  };
}

function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

type RoleNameTracker = {
  counts: Map<string, number>;
  refsByKey: Map<string, string[]>;
  getKey: (role: string, name?: string) => string;
  getNextIndex: (role: string, name?: string) => number;
  trackRef: (role: string, name: string | undefined, ref: string) => void;
  getDuplicateKeys: () => Set<string>;
};

function createRoleNameTracker(): RoleNameTracker {
  const counts = new Map<string, number>();
  const refsByKey = new Map<string, string[]>();
  return {
    counts,
    refsByKey,
    getKey(role: string, name?: string) {
      return `${role}:${name ?? ""}`;
    },
    getNextIndex(role: string, name?: string) {
      const key = this.getKey(role, name);
      const current = counts.get(key) ?? 0;
      counts.set(key, current + 1);
      return current;
    },
    trackRef(role: string, name: string | undefined, ref: string) {
      const key = this.getKey(role, name);
      const list = refsByKey.get(key) ?? [];
      list.push(ref);
      refsByKey.set(key, list);
    },
    getDuplicateKeys() {
      const out = new Set<string>();
      for (const [key, refs] of refsByKey) {
        if (refs.length > 1) {
          out.add(key);
        }
      }
      return out;
    },
  };
}

function removeNthFromNonDuplicates(refs: RoleRefMap, tracker: RoleNameTracker) {
  const duplicates = tracker.getDuplicateKeys();
  for (const [, data] of Object.entries(refs)) {
    const key = tracker.getKey(data.role, data.name);
    if (!duplicates.has(key)) {
      delete data.nth;
    }
  }
}

function compactTree(tree: string) {
  const lines = tree.split("\n");
  const n = lines.length;

  // O(n) pass: for each line, does any descendant contain [ref=]?
  // Build a boolean array bottom-up: hasRefBelow[i] = true if any child/descendant has [ref=].
  const indents = new Array<number>(n);
  const hasRef = new Array<boolean>(n);
  const hasRefBelow = new Array<boolean>(n);

  for (let i = 0; i < n; i++) {
    indents[i] = getIndentLevel(lines[i]!);
    hasRef[i] = lines[i]!.includes("[ref=");
    hasRefBelow[i] = false;
  }

  // Reverse scan: propagate ref presence upward through indent levels
  // Use a stack of (indent, hasRefInSubtree) pairs
  for (let i = n - 1; i >= 0; i--) {
    if (hasRef[i]) {
      // Mark all ancestors
      for (let j = i - 1; j >= 0; j--) {
        if (indents[j]! < indents[i]!) {
          hasRefBelow[j] = true;
          break; // Only mark direct parent; it will propagate
        }
      }
    }
    if (hasRefBelow[i]) {
      // Propagate up to parent
      for (let j = i - 1; j >= 0; j--) {
        if (indents[j]! < indents[i]!) {
          hasRefBelow[j] = true;
          break;
        }
      }
    }
  }

  const result: string[] = [];
  for (let i = 0; i < n; i++) {
    const line = lines[i]!;
    if (hasRef[i]) { result.push(line); continue; }
    if (line.includes(":") && !line.trimEnd().endsWith(":")) { result.push(line); continue; }
    if (hasRefBelow[i]) { result.push(line); }
  }
  return result.join("\n");
}

function processLine(
  line: string,
  refs: RoleRefMap,
  options: RoleSnapshotOptions,
  tracker: RoleNameTracker,
  nextRef: () => string,
): string | null {
  const depth = getIndentLevel(line);
  if (options.maxDepth !== undefined && depth > options.maxDepth) return null;

  const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
  if (!match) return options.interactive ? null : line;

  const [, prefix, roleRaw, name, suffix] = match;
  if (roleRaw!.startsWith("/")) return options.interactive ? null : line;

  const role = roleRaw!.toLowerCase();
  const isInteractive = INTERACTIVE_ROLES.has(role);
  const isContent = CONTENT_ROLES.has(role);
  const isStructural = STRUCTURAL_ROLES.has(role);

  if (options.interactive && !isInteractive) return null;
  if (options.compact && isStructural && !name) return null;

  const shouldHaveRef = isInteractive || (isContent && name);
  if (!shouldHaveRef) return line;

  const ref = nextRef();
  const nth = tracker.getNextIndex(role, name);
  tracker.trackRef(role, name, ref);
  refs[ref] = { role, name, nth };

  let enhanced = `${prefix}${roleRaw}`;
  if (name) enhanced += ` "${name}"`;
  enhanced += ` [ref=${ref}]`;
  if (nth > 0) enhanced += ` [nth=${nth}]`;
  if (suffix) enhanced += suffix;
  return enhanced;
}

export function parseRoleRef(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith("@")
    ? trimmed.slice(1)
    : trimmed.startsWith("ref=")
      ? trimmed.slice(4)
      : trimmed;
  return /^e\d+$/.test(normalized) ? normalized : null;
}

export function buildRoleSnapshotFromAriaSnapshot(
  ariaSnapshot: string,
  options: RoleSnapshotOptions = {},
): { snapshot: string; refs: RoleRefMap } {
  const lines = ariaSnapshot.split("\n");
  const refs: RoleRefMap = {};
  const tracker = createRoleNameTracker();
  let counter = 0;
  const nextRef = () => `e${++counter}`;

  if (options.interactive) {
    const result: string[] = [];
    for (const line of lines) {
      const depth = getIndentLevel(line);
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;
      const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
      if (!match) continue;
      const [, , roleRaw, name, suffix] = match;
      if (roleRaw!.startsWith("/")) continue;
      const role = roleRaw!.toLowerCase();
      if (!INTERACTIVE_ROLES.has(role)) continue;

      const ref = nextRef();
      const nth = tracker.getNextIndex(role, name);
      tracker.trackRef(role, name, ref);
      refs[ref] = { role, name, nth };

      let enhanced = `- ${roleRaw}`;
      if (name) enhanced += ` "${name}"`;
      enhanced += ` [ref=${ref}]`;
      if (nth > 0) enhanced += ` [nth=${nth}]`;
      if (suffix!.includes("[")) enhanced += suffix;
      result.push(enhanced);
    }
    removeNthFromNonDuplicates(refs, tracker);
    return { snapshot: result.join("\n") || "(no interactive elements)", refs };
  }

  const result: string[] = [];
  for (const line of lines) {
    const processed = processLine(line, refs, options, tracker, nextRef);
    if (processed !== null) result.push(processed);
  }
  removeNthFromNonDuplicates(refs, tracker);
  const tree = result.join("\n") || "(empty)";
  return { snapshot: options.compact ? compactTree(tree) : tree, refs };
}

function parseAiSnapshotRef(suffix: string): string | null {
  const match = suffix.match(/\[ref=(e\d+)\]/i);
  return match ? match[1]! : null;
}

export function buildRoleSnapshotFromAiSnapshot(
  aiSnapshot: string,
  options: RoleSnapshotOptions = {},
): { snapshot: string; refs: RoleRefMap } {
  const lines = String(aiSnapshot ?? "").split("\n");
  const refs: RoleRefMap = {};

  if (options.interactive) {
    const out: string[] = [];
    for (const line of lines) {
      const depth = getIndentLevel(line);
      if (options.maxDepth !== undefined && depth > options.maxDepth) continue;
      const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
      if (!match) continue;
      const [, , roleRaw, name, suffix] = match;
      if (roleRaw!.startsWith("/")) continue;
      const role = roleRaw!.toLowerCase();
      if (!INTERACTIVE_ROLES.has(role)) continue;
      const ref = parseAiSnapshotRef(suffix!);
      if (!ref) continue;
      refs[ref] = { role, ...(name ? { name } : {}) };
      out.push(`- ${roleRaw}${name ? ` "${name}"` : ""}${suffix}`);
    }
    return { snapshot: out.join("\n") || "(no interactive elements)", refs };
  }

  const out: string[] = [];
  for (const line of lines) {
    const depth = getIndentLevel(line);
    if (options.maxDepth !== undefined && depth > options.maxDepth) continue;
    const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
    if (!match) { out.push(line); continue; }
    const [, , roleRaw, name, suffix] = match;
    if (roleRaw!.startsWith("/")) { out.push(line); continue; }
    const role = roleRaw!.toLowerCase();
    if (options.compact && STRUCTURAL_ROLES.has(role) && !name) continue;
    const ref = parseAiSnapshotRef(suffix!);
    if (ref) refs[ref] = { role, ...(name ? { name } : {}) };
    out.push(line);
  }
  const tree = out.join("\n") || "(empty)";
  return { snapshot: options.compact ? compactTree(tree) : tree, refs };
}
