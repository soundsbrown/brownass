#!/usr/bin/env node
// Installs ffmpeg + ffprobe as Tauri sidecars in src-tauri/binaries/,
// named with the Rust target triple as Tauri's `externalBin` requires
// (e.g. ffmpeg-x86_64-pc-windows-msvc.exe).
//
// Source, in order of preference:
//   1. FFMPEG_DIR env var: a directory containing ffmpeg and ffprobe
//   2. Windows: download the gyan.dev "release essentials" build
//   3. ffmpeg / ffprobe found on PATH
//
// The build must include libass (`--enable-libass`); this is verified.
// Pass --force to replace existing binaries.

import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const WINDOWS_BUILD_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const TOOLS = ["ffmpeg", "ffprobe"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "binaries");
const force = process.argv.includes("--force");
const exe = process.platform === "win32" ? ".exe" : "";

function targetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const host = out.match(/^host: (\S+)/m);
    if (host) return host[1];
  } catch {
    // rustc not installed; fall back to a guess below
  }
  const guesses = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
  };
  const guess = guesses[`${process.platform}-${process.arch}`];
  if (!guess)
    throw new Error(`Cannot determine target triple for ${process.platform}-${process.arch}`);
  return guess;
}

function findOnPath(name) {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    return execFileSync(cmd, [name], { encoding: "utf8" }).split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

function findFile(dir, fileName) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(p, fileName);
      if (found) return found;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return p;
    }
  }
  return null;
}

async function downloadWindowsBuild() {
  const work = join(tmpdir(), "brownass-ffmpeg");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const zip = join(work, "ffmpeg.zip");

  console.log(`Downloading ${WINDOWS_BUILD_URL} ...`);
  const res = await fetch(WINDOWS_BUILD_URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

  console.log("Extracting ...");
  // bsdtar ships with Windows 10+ and reads zip archives. Call it by full path:
  // GNU tar (e.g. from Git for Windows) may shadow it and can't handle "C:\".
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  execFileSync(tar, ["-xf", zip, "-C", work], { stdio: "inherit" });

  return Object.fromEntries(TOOLS.map((t) => [t, findFile(work, `${t}.exe`)]));
}

async function resolveSources() {
  if (process.env.FFMPEG_DIR) {
    const dir = process.env.FFMPEG_DIR;
    return Object.fromEntries(TOOLS.map((t) => [t, join(dir, `${t}${exe}`)]));
  }
  if (process.platform === "win32") return downloadWindowsBuild();
  return Object.fromEntries(TOOLS.map((t) => [t, findOnPath(t)]));
}

function verifyLibass(ffmpegPath) {
  const filters = execFileSync(ffmpegPath, ["-hide_banner", "-filters"], { encoding: "utf8" });
  if (!/^\s*\S+\s+ass\s/m.test(filters)) {
    throw new Error(
      `${ffmpegPath} was built without libass (no 'ass' filter). Use a build with --enable-libass.`,
    );
  }
}

async function main() {
  const triple = targetTriple();
  const dest = Object.fromEntries(TOOLS.map((t) => [t, join(binDir, `${t}-${triple}${exe}`)]));

  if (!force && TOOLS.every((t) => existsSync(dest[t]))) {
    console.log(`Sidecars already present for ${triple}. Use --force to replace.`);
    return;
  }

  const src = await resolveSources();
  for (const t of TOOLS) {
    if (!src[t] || !existsSync(src[t])) {
      throw new Error(`Could not find ${t}. Set FFMPEG_DIR to a directory containing ${t}${exe}.`);
    }
  }
  verifyLibass(src.ffmpeg);

  mkdirSync(binDir, { recursive: true });
  for (const t of TOOLS) {
    copyFileSync(src[t], dest[t]);
    if (exe === "") chmodSync(dest[t], 0o755);
    console.log(`Installed ${dest[t]}`);
  }
  console.log(
    execFileSync(dest.ffmpeg, ["-hide_banner", "-version"], { encoding: "utf8" }).split(/\r?\n/)[0],
  );
}

main().catch((err) => {
  console.error(`setup-ffmpeg: ${err.message}`);
  process.exit(1);
});
