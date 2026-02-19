/**
 * Unit tests: session module (no Chrome / no network required)
 *
 * Tests that can run without a live browser:
 *   - listSessions (reads/creates /tmp dir)
 *   - deleteSession (file removal)
 *   - importSession (JSON parsing + file write)
 *   - exportSession (httpOnly redaction)
 *   - TTL expiry detection via listSessions
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, unlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  listSessions,
  deleteSession,
  exportSession,
  importSession,
} from "../../src/session.js";
import type { SessionData } from "../../src/session.js";

// ---------------------------------------------------------------------------
// Test fixtures — write directly to SESSIONS_DIR
// ---------------------------------------------------------------------------

const SESSIONS_DIR = "/tmp/jarvis-browser-sessions";

async function writeSession(name: string, data: Partial<SessionData> = {}): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const session: SessionData = {
    version: 1,
    name,
    saved_at: data.saved_at ?? new Date().toISOString(),
    origin: data.origin ?? "https://example.com",
    cookies: data.cookies ?? [],
    localStorage: data.localStorage ?? {},
    sessionStorage: data.sessionStorage ?? {},
  };
  const filePath = join(SESSIONS_DIR, `${name}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  return filePath;
}

const createdSessions: string[] = [];

function trackSession(name: string): string {
  createdSessions.push(name);
  return name;
}

afterEach(async () => {
  for (const name of createdSessions.splice(0)) {
    const filePath = join(SESSIONS_DIR, `${name}.json`);
    if (existsSync(filePath)) {
      await unlink(filePath).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe("listSessions", () => {
  it("returns empty array when sessions dir is empty (or only non-json files)", async () => {
    // Sessions from other tests may exist; just verify the function doesn't throw
    const sessions = await listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("returns session info for a valid session file", async () => {
    const name = trackSession(`test-list-${Date.now()}`);
    await writeSession(name);

    const sessions = await listSessions();
    const found = sessions.find((s) => s.name === name);
    expect(found).toBeDefined();
    expect(found?.origin).toBe("https://example.com");
    expect(found?.expired).toBe(false);
  });

  it("marks old sessions as expired", async () => {
    const name = trackSession(`test-expired-${Date.now()}`);
    // saved_at more than 7 days ago
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await writeSession(name, { saved_at: oldDate });

    const sessions = await listSessions();
    const found = sessions.find((s) => s.name === name);
    expect(found).toBeDefined();
    expect(found?.expired).toBe(true);
  });

  it("sessions are sorted newest first", async () => {
    const older = trackSession(`test-older-${Date.now()}`);
    const newer = trackSession(`test-newer-${Date.now() + 1}`);

    const d1 = new Date(Date.now() - 60000).toISOString();
    const d2 = new Date().toISOString();
    await writeSession(older, { saved_at: d1 });
    await writeSession(newer, { saved_at: d2 });

    const sessions = await listSessions();
    const olderIdx = sessions.findIndex((s) => s.name === older);
    const newerIdx = sessions.findIndex((s) => s.name === newer);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("skips malformed JSON files silently", async () => {
    await mkdir(SESSIONS_DIR, { recursive: true });
    const badFile = join(SESSIONS_DIR, `bad-${Date.now()}.json`);
    await writeFile(badFile, "not-valid-json", "utf-8");

    try {
      const sessions = await listSessions();
      expect(Array.isArray(sessions)).toBe(true);
      // Bad file silently skipped; no throw
    } finally {
      await unlink(badFile).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe("deleteSession", () => {
  it("removes existing session file", async () => {
    const name = trackSession(`test-delete-${Date.now()}`);
    const filePath = await writeSession(name);
    expect(existsSync(filePath)).toBe(true);

    await deleteSession(name);
    expect(existsSync(filePath)).toBe(false);
    createdSessions.pop(); // already deleted
  });

  it("throws when session does not exist", async () => {
    await expect(deleteSession("nonexistent-session-xyz")).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// importSession
// ---------------------------------------------------------------------------

describe("importSession", () => {
  const importedSessions: string[] = [];

  afterEach(async () => {
    for (const name of importedSessions.splice(0)) {
      const fp = join(SESSIONS_DIR, `${name}.json`);
      if (existsSync(fp)) await unlink(fp).catch(() => {});
    }
  });

  it("imports a valid session JSON file", async () => {
    const name = `test-import-src-${Date.now()}`;
    // Source lives OUTSIDE SESSIONS_DIR so import writes to a different path
    const srcPath = `/tmp/jarvis-import-test-${Date.now()}.json`;
    const data = {
      version: 1 as const,
      name,
      saved_at: new Date().toISOString(),
      origin: "https://import-test.com",
      cookies: [],
      localStorage: {},
      sessionStorage: {},
    };
    await writeFile(srcPath, JSON.stringify(data, null, 2), "utf-8");

    try {
      const imported = await importSession(srcPath);
      importedSessions.push(imported);

      expect(imported).toBe(name);
      expect(existsSync(join(SESSIONS_DIR, `${name}.json`))).toBe(true);
    } finally {
      await unlink(srcPath).catch(() => {});
    }
  });

  it("imports with custom name override", async () => {
    const srcName = `test-import-orig-${Date.now()}`;
    const newName = `test-import-new-${Date.now()}`;
    const srcPath = await writeSession(srcName);

    const imported = await importSession(srcPath, newName);
    importedSessions.push(imported);
    await unlink(srcPath).catch(() => {});

    expect(imported).toBe(newName);
    expect(existsSync(join(SESSIONS_DIR, `${newName}.json`))).toBe(true);
    // Original name file should not be left behind if it was outside sessions dir
  });

  it("throws when file does not exist", async () => {
    await expect(importSession("/tmp/nonexistent-session-file-xyz.json")).rejects.toThrow("not found");
  });

  it("throws when version field is wrong", async () => {
    const tmpFile = `/tmp/bad-version-${Date.now()}.json`;
    await writeFile(
      tmpFile,
      JSON.stringify({ version: 99, name: "x", saved_at: new Date().toISOString(), origin: "https://x.com", cookies: [], localStorage: {}, sessionStorage: {} }),
      "utf-8",
    );
    try {
      await expect(importSession(tmpFile)).rejects.toThrow("Unsupported session format");
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it("throws when required fields are missing", async () => {
    const tmpFile = `/tmp/missing-fields-${Date.now()}.json`;
    await writeFile(tmpFile, JSON.stringify({ version: 1 }), "utf-8");
    try {
      await expect(importSession(tmpFile)).rejects.toThrow("missing required fields");
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// exportSession — httpOnly redaction
// ---------------------------------------------------------------------------

describe("exportSession", () => {
  it("throws when session does not exist", async () => {
    await expect(exportSession("nonexistent-export-session")).rejects.toThrow("not found");
  });

  it("redacts httpOnly cookie values by default", async () => {
    const name = trackSession(`test-export-${Date.now()}`);
    await writeSession(name, {
      cookies: [
        {
          name: "session_token",
          value: "super-secret",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "analytics",
          value: "track-123",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "None",
        },
      ],
    });

    const destPath = `/tmp/jarvis-export-test-${Date.now()}.json`;
    try {
      const resultPath = await exportSession(name, destPath);
      expect(resultPath).toBe(destPath);
      expect(existsSync(destPath)).toBe(true);

      const { readFile } = await import("node:fs/promises");
      const exported = JSON.parse(await readFile(destPath, "utf-8")) as SessionData;

      const sessionCookie = exported.cookies.find((c) => c.name === "session_token");
      const analyticsCookie = exported.cookies.find((c) => c.name === "analytics");

      expect(sessionCookie?.value).toBe("[REDACTED]");
      expect(analyticsCookie?.value).toBe("track-123");
    } finally {
      await unlink(destPath).catch(() => {});
    }
  });

  it("preserves httpOnly values when includeSecrets=true", async () => {
    const name = trackSession(`test-export-secrets-${Date.now()}`);
    await writeSession(name, {
      cookies: [
        {
          name: "token",
          value: "my-secret-value",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "None",
        },
      ],
    });

    const destPath = `/tmp/jarvis-export-secrets-test-${Date.now()}.json`;
    try {
      await exportSession(name, destPath, true);

      const { readFile } = await import("node:fs/promises");
      const exported = JSON.parse(await readFile(destPath, "utf-8")) as SessionData;

      expect(exported.cookies[0].value).toBe("my-secret-value");
    } finally {
      await unlink(destPath).catch(() => {});
    }
  });

  it("uses default output path when none specified", async () => {
    const name = trackSession(`test-export-default-${Date.now()}`);
    await writeSession(name);

    const resultPath = await exportSession(name);
    expect(resultPath).toBe(`/tmp/jarvis-browser-session-export-${name}.json`);

    await unlink(resultPath).catch(() => {});
  });

  it("exported file has 0600 permissions", async () => {
    const name = trackSession(`test-export-perms-${Date.now()}`);
    await writeSession(name);

    const destPath = `/tmp/jarvis-export-perms-test-${Date.now()}.json`;
    try {
      await exportSession(name, destPath);
      const { stat } = await import("node:fs/promises");
      const s = await stat(destPath);
      // Low 9 bits: owner=rw(0o600), group=0, other=0
      expect(s.mode & 0o777).toBe(0o600);
    } finally {
      await unlink(destPath).catch(() => {});
    }
  });
});
