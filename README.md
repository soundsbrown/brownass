# BrownASS

A lightweight desktop editor for authoring ASS subtitles on top of a video, built with Tauri 2, Svelte 5 and TypeScript.

## Prerequisites

- Node.js 22 LTS or newer (the Vite 8 toolchain needs ≥ 20.19)
- Rust stable via [rustup](https://rustup.rs) (MSVC toolchain on Windows)
- Windows: Visual Studio C++ build tools and WebView2 (preinstalled on Windows 11)
- See also the [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Setup

```sh
npm install
npm run setup:ffmpeg   # installs ffmpeg + ffprobe sidecars into src-tauri/binaries/
npm run tauri dev
```

### ffmpeg sidecars

The app bundles `ffmpeg` and `ffprobe` as Tauri sidecars. The ffmpeg build **must include libass** (`--enable-libass`), because burn-in export uses the `ass` filter. `scripts/setup-ffmpeg.mjs` verifies this.

The setup script gets the binaries from one of these sources, in order:

1. `FFMPEG_DIR`: a directory containing `ffmpeg` and `ffprobe` (e.g. `FFMPEG_DIR=C:\tools\ffmpeg\bin npm run setup:ffmpeg`)
2. On Windows: downloads the [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) release essentials build
3. `ffmpeg` / `ffprobe` on `PATH`

Pass `-- --force` to replace binaries that are already installed.

**Licensing:** the gyan.dev builds are GPL (they include x264). Which ffmpeg build to ship, and the resulting license obligations, has not been decided yet.

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
