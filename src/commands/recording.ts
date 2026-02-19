// recording.ts — Video recording via CDP screencast (v1.0.0)
// Captures JPEG frames via Page.startScreencast.
// On stop: attempts ffmpeg WebM encoding; falls back gracefully if unavailable.

import { getPage } from "../browser.js";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { ERROR_CODES } from "../protocol.js";
import type { CDPSession } from "playwright-core";

// --- Recording state ---

interface RecordingState {
  session: CDPSession;
  frames: string[];   // base64 JPEG data URIs
  outputPath: string;
  startTime: number;
  fps: number;
  maxFrames: number;
}

let activeRecording: RecordingState | null = null;

// --- Handlers ---

export async function handleRecordStart(params: {
  path?: string;
  fps?: number;
  quality?: number;
  maxFrames?: number;
  targetId?: string;
}): Promise<object> {
  if (activeRecording) {
    throw Object.assign(
      new Error("Recording already active. Call record stop first."),
      { rpcCode: ERROR_CODES.ACTION_FAILED },
    );
  }

  const outputPath = params.path ?? join(tmpdir(), `jarvis-recording-${Date.now()}.webm`);

  if (!outputPath.startsWith("/tmp/")) {
    throw Object.assign(
      new Error(`Recording path must be under /tmp/, got "${outputPath}"`),
      { rpcCode: ERROR_CODES.SECURITY_VIOLATION },
    );
  }

  const fps = Math.min(Math.max(params.fps ?? 10, 1), 30);
  const quality = Math.min(Math.max(params.quality ?? 70, 1), 100);
  const maxFrames = params.maxFrames ?? 300;

  const page = await getPage(params.targetId);
  const session = await page.context().newCDPSession(page);

  const state: RecordingState = {
    session,
    frames: [],
    outputPath,
    startTime: Date.now(),
    fps,
    maxFrames,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session.on("Page.screencastFrame", async (event: any) => {
    if ((state.frames.length as number) < state.maxFrames) {
      state.frames.push(event.data as string);
    }
    await session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });

  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality,
    everyNthFrame: Math.max(1, Math.round(60 / fps)),
  });

  activeRecording = state;

  return {
    ok: true,
    recording: true,
    path: outputPath,
    fps,
    quality,
    maxFrames,
  };
}

export async function handleRecordStop(): Promise<object> {
  if (!activeRecording) {
    throw Object.assign(
      new Error("No active recording."),
      { rpcCode: ERROR_CODES.ACTION_FAILED },
    );
  }

  const state = activeRecording;
  activeRecording = null;

  await state.session.send("Page.stopScreencast").catch(() => {});
  await state.session.detach().catch(() => {});

  const durationMs = Date.now() - state.startTime;
  const frameCount = state.frames.length;

  if (frameCount === 0) {
    return {
      ok: true,
      frames: 0,
      duration_ms: durationMs,
      path: null,
      note: "No frames captured",
    };
  }

  const encoded = await encodeWithFfmpeg(state.frames, state.outputPath, durationMs);

  return {
    ok: true,
    frames: frameCount,
    duration_ms: durationMs,
    path: encoded ? state.outputPath : null,
    format: encoded ? "webm" : "skipped",
    ...(encoded
      ? {}
      : { note: "ffmpeg not available; install ffmpeg for WebM output" }),
  };
}

export function handleRecordStatus(): object {
  if (!activeRecording) {
    return { recording: false };
  }
  return {
    recording: true,
    path: activeRecording.outputPath,
    frames: activeRecording.frames.length,
    duration_ms: Date.now() - activeRecording.startTime,
    fps: activeRecording.fps,
    maxFrames: activeRecording.maxFrames,
  };
}

// --- ffmpeg encoding ---

async function encodeWithFfmpeg(
  frames: string[],
  outputPath: string,
  durationMs: number,
): Promise<boolean> {
  // Check availability
  const available = await new Promise<boolean>((resolve) => {
    const probe = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
  if (!available) return false;

  // Write frames to temp dir
  const framesDir = join(tmpdir(), `jarvis-frames-${Date.now()}`);
  await mkdir(framesDir, { recursive: true });

  for (const [i, frame] of frames.entries()) {
    const buf = Buffer.from(frame, "base64");
    await writeFile(join(framesDir, `frame-${String(i).padStart(6, "0")}.jpg`), buf);
  }

  // Ensure output directory exists
  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }

  const avgFps = Math.max(1, Math.round((frames.length / (durationMs / 1000)) * 10) / 10);

  return new Promise<boolean>((resolve) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-y",
        "-framerate", String(avgFps),
        "-i", join(framesDir, "frame-%06d.jpg"),
        "-c:v", "libvpx-vp9",
        "-b:v", "1M",
        "-pix_fmt", "yuv420p",
        outputPath,
      ],
      { stdio: "ignore" },
    );
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}
