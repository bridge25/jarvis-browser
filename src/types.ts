// jarvis-browser types
// Inspired by OpenClaw (MIT License) - https://github.com/openclaw/openclaw

export type RoleRef = {
  role: string;
  name?: string;
  nth?: number;
};

export type RoleRefMap = Record<string, RoleRef>;

export type RoleSnapshotStats = {
  lines: number;
  chars: number;
  refs: number;
  interactive: number;
};

export type RoleSnapshotOptions = {
  interactive?: boolean;
  maxDepth?: number;
  compact?: boolean;
};

export type SnapshotResult = {
  snapshot: string;
  refs: RoleRefMap;
  stats: RoleSnapshotStats;
  truncated?: boolean;
};

export type TabInfo = {
  targetId: string;
  title: string;
  url: string;
};

export type BrowserConfig = {
  cdpUrl: string;
  headless: boolean;
  noSandbox: boolean;
  executablePath?: string;
  userDataDir?: string;
  port: number;
};

export type ActionResult = {
  ok: boolean;
  message?: string;
  data?: unknown;
  // v0.7.0: structured output fields
  error?: string;
  suggestion?: string;
  ref?: string;
  action?: string;
  [key: string]: unknown;
};
