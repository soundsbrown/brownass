# BrownASS

A lightweight desktop tool for adding consistently styled on-screen text to finished videos: explanatory captions, section titles, SVG graphics and a logo, without opening a video editor. It suits videos without speech, such as product demos, screen recordings and tutorials, where captions are written rather than transcribed.

Looks are defined once in a shared **stylesheet** (a "house style" of named text and shape styles, plus optional overlays such as a logo). Every video linked to it follows it, and captions only pick a style, so a whole series of videos stays consistent. The result is burned into a copy of the video with ffmpeg, or kept as an `.ass` subtitle file next to it. Everything runs locally.

Built with Tauri 2, Svelte 5 and TypeScript; previews and exports both render with libass. Windows is currently the only supported platform.

## Installing

Run `BrownASS_<version>_x64-setup.exe`. It installs for the current user (no administrator rights needed) and downloads Microsoft WebView2 if it isn't already installed (it is on Windows 11).

The installer isn't code-signed, so Windows SmartScreen may warn on first run: choose **More info → Run anyway**.

BrownASS also needs **ffmpeg with libass**, installed separately (see [ffmpeg](#ffmpeg)). The easiest way:

```sh
winget install Gyan.FFmpeg
```

## Using BrownASS

1. **Open a video** (Ctrl+O, or pick one from the recent list).
2. **Drag in the timeline** below the ruler to create a caption, then type its text. Shift+Enter starts a new line; the **B / I / U** buttons format the selected text. **Add SVG…** in the transport bar places an SVG graphic at the playhead.
3. **Adjust timing** by dragging a caption's middle (move) or edges (resize). Edges snap to frames, the playhead and other captions (hold Alt to turn edge snapping off). For exact times, type them under **Properties** (`0:01:23.5`, `1:23.5` or `83.5`; ↑/↓ change them by a frame, Shift by a second).
4. **Style** captions by choosing a style in **Properties**. Styles come from the video's stylesheet; **Edit styles…** changes them for every video that uses the stylesheet.
5. **Export** (Ctrl+E) to burn the subtitles into a copy of the video (all of it, the selected caption's part, or a custom range), or save an MKV with them as a separate track.

Work is saved automatically next to the video: `clip.mp4` gets `clip.bwass` (the project) and `clip.ass` (the subtitles, which players such as mpv and VLC load automatically). Opening the video again reopens the project. If a video already has a `clip.ass` from another tool, its captions' timing and text are imported; the original is kept as `clip.ass.bak` when first overwritten.

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → (Shift: 1 s) | Previous / next frame |
| ↑ / ↓ | Previous / next caption |
| Home / End | Start / end of the video |
| Enter | Edit the selected caption's text |
| Delete | Delete the selected caption |
| Ctrl+D | Duplicate the selected caption |
| `[` / `]` | Set the selected caption's start / end to the playhead |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Wheel / Shift+wheel | Zoom / scroll the timeline |

### Where files are kept

| What | Where |
|---|---|
| Project and `.ass` | Next to the video (or `%APPDATA%\com.soundsbrown.brownass\projects` if that folder is read-only) |
| Stylesheets | `Documents\BrownASS\Stylesheets\<name>.bwstyle`: copy a file here to share a stylesheet |
| Settings, recent videos | `%APPDATA%\com.soundsbrown.brownass` |
| Log files | `%LOCALAPPDATA%\com.soundsbrown.brownass\logs` |
| Waveform cache | `%LOCALAPPDATA%\com.soundsbrown.brownass` |

The **⋮** menu next to the logo opens the stylesheets and log folders.

## Developing

### Prerequisites

- Node.js 22 LTS or newer (the Vite 8 toolchain needs ≥ 20.19)
- Rust stable via [rustup](https://rustup.rs) (MSVC toolchain on Windows)
- Windows: Visual Studio C++ build tools and WebView2 (preinstalled on Windows 11)
- See also the [Tauri prerequisites](https://tauri.app/start/prerequisites/)

```sh
npm install
npm run tauri dev
```

### ffmpeg

BrownASS does not bundle ffmpeg. The build **must include libass** (`--enable-libass`), because subtitle rendering uses the `ass` filter; the gyan.dev builds installed by `winget install Gyan.FFmpeg` do.

At startup the app looks for `ffmpeg` and `ffprobe`:

1. at the path chosen with **Locate ffmpeg…** in the status bar (saved in the app's settings; `ffprobe` must be in the same folder);
2. otherwise on `PATH`, preferring a folder that contains both tools.

It then checks that both run and that ffmpeg has the `ass` filter. If anything is missing, the status bar says what and offers **Locate ffmpeg…** and **Check again**. For export, hardware encoders (NVIDIA NVENC, Intel Quick Sync, AMD AMF) are offered only if a test encode works on the machine.

### Scripts

| Command | Purpose |
|---|---|
| `npm run tauri dev` | Run the app with hot reload |
| `npm run dist` | Build the installer into `dist/` |
| `npm run lint` | ESLint + Prettier check |
| `npm run format` | Apply Prettier |
| `npm run check` | svelte-check type checking |
| `npm test` | Vitest |
| `cargo fmt`, `cargo clippy`, `cargo test` | Rust checks (run in `src-tauri/`) |

Tests that run the real ffmpeg are opt-in: set `BROWNASS_TEST_FFMPEG` (path to `ffmpeg.exe`, with `ffprobe.exe` next to it) and `BROWNASS_TEST_VIDEO` (a short video with audio), then run `cargo test -- --ignored` in `src-tauri/`.

## License

MIT, see [LICENSE](LICENSE).
