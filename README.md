# BrownASS

A lightweight desktop editor for authoring ASS subtitles on top of a video, built with Tauri 2, Svelte 5 and TypeScript.

## Prerequisites

- Node.js 22 LTS or newer (the Vite 8 toolchain needs ≥ 20.19)
- Rust stable via [rustup](https://rustup.rs) (MSVC toolchain on Windows)
- Windows: Visual Studio C++ build tools and WebView2 (preinstalled on Windows 11)
- See also the [Tauri prerequisites](https://tauri.app/start/prerequisites/)

Windows is currently the only supported platform.

## Setup

```sh
npm install
npm run tauri dev
```

### ffmpeg

BrownASS does not bundle ffmpeg; install it separately. The build **must include libass** (`--enable-libass`), because subtitle rendering uses the `ass` filter. The easiest option on Windows:

```sh
winget install Gyan.FFmpeg
```

At startup the app looks for `ffmpeg` and `ffprobe`:

1. at the path chosen with **Locate ffmpeg…** in the status bar (saved in the app's settings; `ffprobe` must be in the same folder);
2. otherwise on `PATH`, preferring a folder that contains both tools.

It then checks that both run and that ffmpeg has the `ass` filter. If anything is missing, the status bar says what and offers **Locate ffmpeg…** and **Check again**.

## Scripts

| Command | Purpose |
|---|---|
| `npm run tauri dev` | Run the app with hot reload |
| `npm run tauri build` | Build the installer (`src-tauri/target/release/bundle/`) |
| `npm run lint` | ESLint + Prettier check |
| `npm run format` | Apply Prettier |
| `npm run check` | svelte-check type checking |
| `npm test` | Vitest |
| `cargo fmt`, `cargo clippy`, `cargo test` | Rust checks (run in `src-tauri/`) |
