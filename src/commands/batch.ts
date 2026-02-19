// Batch command handler: execute multiple commands in one connection

import { navigate, click, type as typeAction, screenshot, waitForSelector, waitForNavigation, evaluate } from "../actions.js";
import { takeSnapshot } from "../browser.js";
import { fileOutput } from "../shared.js";

type BatchEntry = Record<string, unknown>;
type BatchResult = {
  step: number;
  cmd: string;
  ok: boolean;
  message?: string;
  data?: unknown;
  error?: string;
};

export async function handleBatch(params: {
  commands: BatchEntry[];
  outputFile?: string;
}): Promise<object> {
  const commands = params.commands;
  if (!Array.isArray(commands)) {
    throw new Error("commands must be a JSON array");
  }

  const results: BatchResult[] = [];

  for (let i = 0; i < commands.length; i++) {
    const entry = commands[i]!;
    const cmd = String(entry.cmd ?? "");
    try {
      switch (cmd) {
        case "navigate": {
          const r = await navigate({
            targetId: entry.target as string | undefined,
            url: String(entry.url),
            timeoutMs: entry.timeout as number | undefined,
          });
          results.push({ step: i, cmd, ok: true, message: r.message, data: r.data });
          break;
        }
        case "snapshot": {
          const r = await takeSnapshot({
            targetId: entry.target as string | undefined,
            options: {
              interactive: !!entry.interactive,
              compact: !!entry.compact,
              maxDepth: entry.maxDepth as number | undefined,
            },
          });
          results.push({
            step: i,
            cmd,
            ok: true,
            message: `${r.snapshot.split("\n").length} lines`,
            data: r.snapshot,
          });
          break;
        }
        case "evaluate": {
          const r = await evaluate({
            targetId: entry.target as string | undefined,
            expression: String(entry.expression),
          });
          results.push({ step: i, cmd, ok: true, data: r.data });
          break;
        }
        case "click": {
          const r = await click({
            targetId: entry.target as string | undefined,
            ref: String(entry.ref),
            doubleClick: !!entry.double,
          });
          results.push({ step: i, cmd, ok: true, message: r.message });
          break;
        }
        case "type": {
          const r = await typeAction({
            targetId: entry.target as string | undefined,
            ref: String(entry.ref),
            text: String(entry.text),
            clearFirst: !!entry.clear,
            pressEnter: !!entry.enter,
          });
          results.push({ step: i, cmd, ok: true, message: r.message });
          break;
        }
        case "screenshot": {
          const r = await screenshot({
            targetId: entry.target as string | undefined,
            ref: entry.ref as string | undefined,
            path: entry.path as string | undefined,
            fullPage: !!entry.fullPage,
          });
          results.push({ step: i, cmd, ok: true, message: r.message, data: r.data });
          break;
        }
        case "wait": {
          const r = entry.ref
            ? await waitForSelector({
                targetId: entry.target as string | undefined,
                ref: String(entry.ref),
                state: entry.state as "visible" | "hidden" | undefined,
              })
            : await waitForNavigation({
                targetId: entry.target as string | undefined,
              });
          results.push({ step: i, cmd, ok: true, message: r.message });
          break;
        }
        default:
          results.push({ step: i, cmd, ok: false, error: `Unknown batch command: ${cmd}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ step: i, cmd, ok: false, error: msg });
      if (entry.failFast) break;
    }
  }

  if (params.outputFile) {
    fileOutput(params.outputFile, JSON.stringify(results, null, 2), {
      total: commands.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
    return {
      ok: true,
      total: commands.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  return results;
}
