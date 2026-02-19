// upload.ts — File upload logic (v0.7.0)
// Addresses FM-2: Missing File Upload
//
// Design: <input type="file"> is often hidden behind a styled button.
// Detection order:
//   1. ref points directly to <input type="file"> → use it
//   2. ref points to <button>/<label> → scan siblings/parent for file input
//   3. --selector provided → use CSS selector directly (escape hatch)
//   4. Nothing found → error with suggestion

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getPage, refLocator, getStoredRefs } from "./browser.js";
import type { ActionResult } from "./types.js";

// --- File path validation ---

function validateFilePaths(paths: string[]): string[] {
  const resolved: string[] = [];
  const missing: string[] = [];

  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      missing.push(p);
    } else {
      resolved.push(abs);
    }
  }

  if (missing.length > 0) {
    throw new Error(`File(s) not found: ${missing.join(", ")}`);
  }

  return resolved;
}

// --- Find file input near a visible element ---

async function findFileInputNearRef(
  page: Awaited<ReturnType<typeof getPage>>,
  ref: string,
  targetId?: string,
): Promise<import("playwright-core").Locator | null> {
  const state = getStoredRefs(targetId ?? "default");
  const loc = refLocator(page, ref, state);

  // Check if the ref element itself is a file input
  const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
  const inputType = await loc.evaluate((el: HTMLInputElement) => el.type?.toLowerCase()).catch(() => "");

  if (tagName === "input" && inputType === "file") {
    return loc;
  }

  // Scan parent and siblings for a hidden file input
  const fileInputHandle = await loc.evaluate((el: Element) => {
    // Check parent
    const parent = el.parentElement;
    if (!parent) return false;

    // Search within parent subtree
    const inputs = parent.querySelectorAll('input[type="file"]');
    if (inputs.length > 0) return true;

    // Search in grandparent
    const grandparent = parent.parentElement;
    if (grandparent) {
      const inputs2 = grandparent.querySelectorAll('input[type="file"]');
      if (inputs2.length > 0) return true;
    }

    return false;
  }).catch(() => false);

  if (fileInputHandle) {
    // Use the first file input found in the parent scope
    const parentLocator = loc.locator("xpath=ancestor::*[1]");
    const fileInput = parentLocator.locator('input[type="file"]').first();
    return fileInput;
  }

  return null;
}

// --- Main upload handler ---

export async function handleUpload(params: {
  ref?: string;
  selector?: string;
  files: string[];
  targetId?: string;
  timeoutMs?: number;
}): Promise<ActionResult> {
  // Validate files exist before touching the browser
  let resolvedPaths: string[];
  try {
    resolvedPaths = validateFilePaths(params.files);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      suggestion: "Check that file paths are correct and files exist",
    };
  }

  const page = await getPage(params.targetId);
  const timeout = params.timeoutMs ?? 10000;

  let fileInputLocator: import("playwright-core").Locator | null = null;

  // Mode 1: CSS selector provided directly (escape hatch for hidden inputs)
  if (params.selector) {
    fileInputLocator = page.locator(params.selector).first();
  }
  // Mode 2: ref-based discovery
  else if (params.ref) {
    fileInputLocator = await findFileInputNearRef(page, params.ref, params.targetId);

    if (!fileInputLocator) {
      return {
        ok: false,
        error: `No file input found near ref "${params.ref}"`,
        suggestion: 'Use --selector "input[type=file]" to target hidden file input directly',
      };
    }
  } else {
    return { ok: false, error: "ref or --selector required for upload" };
  }

  try {
    await fileInputLocator.setInputFiles(resolvedPaths, { timeout });
    return {
      ok: true,
      message: `Uploaded ${resolvedPaths.length} file(s)`,
      data: { files: resolvedPaths, count: resolvedPaths.length },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Upload failed: ${msg}`,
      suggestion: 'Try using --selector "input[type=file]" to target the file input directly',
    };
  }
}
