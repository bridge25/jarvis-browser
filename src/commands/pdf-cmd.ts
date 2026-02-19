// pdf-cmd.ts — PDF save (v1.0.0)
// Note: page.pdf() requires headless mode. Throws informative error in non-headless.

import { getPage } from "../browser.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ERROR_CODES } from "../protocol.js";

export async function handlePdf(params: {
  path?: string;
  fullPage?: boolean;
  landscape?: boolean;
  targetId?: string;
}): Promise<object> {
  const page = await getPage(params.targetId);
  const outPath = params.path ?? join(tmpdir(), `jarvis-page-${Date.now()}.pdf`);

  // Restrict to /tmp/ (consistent with screenshot security constraint)
  if (!outPath.startsWith("/tmp/")) {
    throw Object.assign(
      new Error(`PDF path must be under /tmp/, got "${outPath}"`),
      { rpcCode: ERROR_CODES.SECURITY_VIOLATION },
    );
  }

  try {
    await page.pdf({
      path: outPath,
      printBackground: true,
      landscape: params.landscape ?? false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("headless")) {
      throw new Error(
        "PDF generation requires headless mode. Launch Chrome with: jarvis-browser launch --headless",
      );
    }
    throw err;
  }

  return { ok: true, path: outPath };
}
