// network.ts — Route interception: block / mock / capture
// NetworkController is exported for unit testing.
// globalNetwork is the daemon-wide singleton.

import type { Page, Route } from "playwright-core";

// --- Types ---

export interface CapturedEntry {
  url: string;
  method: string;
  status: number | null;
  body: string | null;
  timestamp: number;  // Unix seconds
}

interface MockOptions {
  body?: string;
  status?: number;
  contentType?: string;
}

type RuleType = "block" | "mock" | "capture";

interface RouteRule {
  id: string;
  pattern: string;
  type: RuleType;
  mockOptions?: MockOptions;
  captured: CapturedEntry[];
  handler: (route: Route) => Promise<void>;
}

export interface RuleSummary {
  id: string;
  pattern: string;
  type: RuleType;
  captured_count: number;
  mock_status?: number;
}

// Per-tab rule storage: targetId → ruleId → rule
type TabRules = Map<string, RouteRule>;

// --- NetworkController ---

export class NetworkController {
  private tabRules = new Map<string, TabRules>();
  private ruleCounter = 0;

  private getRules(targetId: string): TabRules {
    const existing = this.tabRules.get(targetId);
    if (existing) return existing;
    const rules: TabRules = new Map();
    this.tabRules.set(targetId, rules);
    return rules;
  }

  private nextId(): string {
    this.ruleCounter += 1;
    return `rule_${this.ruleCounter}`;
  }

  async addBlock(pattern: string, page: Page, targetId: string): Promise<string> {
    const id = this.nextId();
    const rules = this.getRules(targetId);

    const handler = async (route: Route): Promise<void> => {
      await route.abort();
    };

    const rule: RouteRule = { id, pattern, type: "block", captured: [], handler };
    rules.set(id, rule);
    await page.route(pattern, handler);
    return id;
  }

  async addMock(pattern: string, opts: MockOptions, page: Page, targetId: string): Promise<string> {
    const id = this.nextId();
    const rules = this.getRules(targetId);

    const handler = async (route: Route): Promise<void> => {
      await route.fulfill({
        status: opts.status ?? 200,
        contentType: opts.contentType ?? "application/json",
        body: opts.body ?? "",
      });
    };

    const rule: RouteRule = { id, pattern, type: "mock", mockOptions: opts, captured: [], handler };
    rules.set(id, rule);
    await page.route(pattern, handler);
    return id;
  }

  async addCapture(pattern: string, page: Page, targetId: string): Promise<string> {
    const id = this.nextId();
    const rules = this.getRules(targetId);
    const captured: CapturedEntry[] = [];

    const handler = async (route: Route): Promise<void> => {
      const response = await route.fetch().catch(() => null);
      const entry: CapturedEntry = {
        url: route.request().url(),
        method: route.request().method(),
        status: response ? response.status() : null,
        body: null,
        timestamp: Math.floor(Date.now() / 1000),
      };
      if (response) {
        try {
          entry.body = await response.text();
        } catch {
          // body not readable (binary/stream)
        }
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
      captured.push(entry);
    };

    const rule: RouteRule = { id, pattern, type: "capture", captured, handler };
    rules.set(id, rule);
    await page.route(pattern, handler);
    return id;
  }

  async removeRule(ruleId: string, page: Page, targetId: string): Promise<void> {
    const rules = this.getRules(targetId);
    const rule = rules.get(ruleId);
    if (!rule) throw new Error(`Rule "${ruleId}" not found`);
    await page.unroute(rule.pattern, rule.handler);
    rules.delete(ruleId);
  }

  async clearAll(page: Page, targetId: string): Promise<number> {
    const rules = this.getRules(targetId);
    const count = rules.size;
    for (const rule of rules.values()) {
      await page.unroute(rule.pattern, rule.handler).catch(() => {});
    }
    rules.clear();
    return count;
  }

  listRules(targetId: string): RuleSummary[] {
    const rules = this.getRules(targetId);
    return Array.from(rules.values()).map((r) => ({
      id: r.id,
      pattern: r.pattern,
      type: r.type,
      captured_count: r.captured.length,
      ...(r.mockOptions?.status !== undefined ? { mock_status: r.mockOptions.status } : {}),
    }));
  }

  getCaptured(targetId: string, pattern?: string): CapturedEntry[] {
    const rules = this.getRules(targetId);
    const entries: CapturedEntry[] = [];
    for (const rule of rules.values()) {
      if (rule.type !== "capture") continue;
      if (pattern && rule.pattern !== pattern) continue;
      entries.push(...rule.captured);
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Remove all rules for a tab on close — does NOT call page.unroute (page is closing). */
  destroyTab(targetId: string): void {
    this.tabRules.delete(targetId);
  }

  /** Total rule count across all tabs (for health reporting). */
  get totalRules(): number {
    return Array.from(this.tabRules.values()).reduce((sum, rules) => sum + rules.size, 0);
  }
}

/** Daemon-wide singleton network controller. Attached per-tab via server.ts. */
export const globalNetwork = new NetworkController();
