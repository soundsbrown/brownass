import { DEFAULT_STYLE, createProject, defaultStyle } from "$lib/model/defaults";
import { scaleStyle, styleScale, unscaleStyle } from "$lib/model/scale";
import type { Alignment, AssStyle, Color, Project, TextItem, VideoRef } from "$lib/model/project";
import { parseAssTime } from "$lib/time";
import { parseColor } from "./color";

export interface ImportResult {
  project: Project;
  /** Things that could not be represented, in a form fit to show the user. */
  warnings: string[];
  /** The subset of `warnings` about events (skipped lines), not styles. */
  eventNotes: string[];
}

// Legacy SSA ([V4 Styles]) alignment: 1-3 bottom, +4 top, +8 middle.
const SSA_ALIGNMENT: Record<number, Alignment> = {
  1: 1,
  2: 2,
  3: 3,
  5: 7,
  6: 8,
  7: 9,
  9: 4,
  10: 5,
  11: 6,
};

/**
 * Imports an `.ass` (or `.ssa`) file into a new project for `video`. Event
 * text, including override tags, is kept verbatim apart from `\N` becoming a
 * line break. Comments and sections the model has no place for are dropped
 * with a warning.
 */
export function parseAss(text: string, video: VideoRef): ImportResult {
  const sections = splitSections(text);
  const warnings: string[] = [];

  const info = keyValues(sections.get("script info") ?? []);
  const playRes = resolvePlayRes(info.get("playresx"), info.get("playresy"));
  if (playRes.x !== video.width || playRes.y !== video.height) {
    warnings.push(
      `The file was made for ${playRes.x}×${playRes.y}, the video is ${video.width}×${video.height}. Positions keep the file's coordinates.`,
    );
    if (info.get("scaledborderandshadow")?.toLowerCase() === "no") {
      warnings.push(
        "Outlines and shadows will scale with the video (ScaledBorderAndShadow: no is not kept).",
      );
    }
  }
  const wrapStyle = info.get("wrapstyle");
  if (wrapStyle && wrapStyle.trim() !== "0") {
    warnings.push(`WrapStyle ${wrapStyle.trim()} is not kept; lines will wrap evenly.`);
  }

  const project = createProject(video);
  project.playRes = playRes;

  const legacy = sections.has("v4 styles") && !sections.has("v4+ styles");
  const styleLines = sections.get("v4+ styles") ?? sections.get("v4 styles") ?? [];
  const styles = parseStyles(styleLines, playRes, legacy, warnings);
  if (Object.keys(styles).length > 0) project.styles = styles;

  const eventNotes: string[] = [];
  project.items = parseEvents(sections.get("events") ?? [], project.styles, warnings, eventNotes);
  warnings.push(...eventNotes);

  const dropped = [...sections.keys()].filter(
    (s) => !["script info", "v4+ styles", "v4 styles", "events", ""].includes(s),
  );
  if (dropped.length > 0) {
    warnings.push(
      `Not kept: ${dropped.map((s) => `[${s}]`).join(", ")} section${dropped.length > 1 ? "s" : ""}.`,
    );
  }
  return { project, warnings, eventNotes };
}

/** Lines per lower-cased section name; lines before any header go under "". */
function splitSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] = [];
  sections.set("", current);
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = [];
      sections.set(header[1].trim().toLowerCase(), current);
    } else if (line && !line.startsWith(";")) {
      current.push(raw.replace(/^\s+/, ""));
    }
  }
  return sections;
}

/** `Key: value` lines, keyed by lower-cased key. Later duplicates win. */
function keyValues(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) map.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return map;
}

/** Missing values follow libass: 384×288 by default, else derived at 4:3. */
function resolvePlayRes(x?: string, y?: string): { x: number; y: number } {
  const px = positiveInt(x);
  const py = positiveInt(y);
  if (px && py) return { x: px, y: py };
  if (py) return { x: Math.round((py * 4) / 3), y: py };
  if (px) return { x: px, y: px === 1280 ? 1024 : Math.round((px * 3) / 4) };
  return { x: 384, y: 288 };
}

function positiveInt(s?: string): number | undefined {
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Splits `Kind: a,b,c` into at most `count` fields (the last keeps commas). */
function fields(line: string, count: number): string[] {
  const body = line.slice(line.indexOf(":") + 1).replace(/^\s/, "");
  const parts = body.split(",");
  return [...parts.slice(0, count - 1), parts.slice(count - 1).join(",")].map((f, i) =>
    i < count - 1 ? f.trim() : f,
  );
}

function lineKind(line: string): string {
  return line.slice(0, line.indexOf(":")).trim().toLowerCase();
}

function formatOf(lines: string[], fallback: string[]): string[] {
  const format = lines.find((l) => lineKind(l) === "format");
  if (!format) return fallback;
  return format
    .slice(format.indexOf(":") + 1)
    .split(",")
    .map((f) => f.trim().toLowerCase());
}

const DEFAULT_STYLE_FORMAT = [
  "name",
  "fontname",
  "fontsize",
  "primarycolour",
  "secondarycolour",
  "outlinecolour",
  "backcolour",
  "bold",
  "italic",
  "underline",
  "strikeout",
  "scalex",
  "scaley",
  "spacing",
  "angle",
  "borderstyle",
  "outline",
  "shadow",
  "alignment",
  "marginl",
  "marginr",
  "marginv",
  "encoding",
];

const DEFAULT_EVENT_FORMAT = [
  "layer",
  "start",
  "end",
  "style",
  "name",
  "marginl",
  "marginr",
  "marginv",
  "effect",
  "text",
];

function parseStyles(
  lines: string[],
  playRes: { x: number; y: number },
  legacy: boolean,
  warnings: string[],
): Record<string, AssStyle> {
  const format = formatOf(lines, DEFAULT_STYLE_FORMAT);
  const styles: Record<string, AssStyle> = {};
  for (const line of lines.filter((l) => lineKind(l) === "style")) {
    const values = fields(line, format.length);
    const get = (key: string) => values[format.indexOf(key)];
    const name = get("name")?.trim();
    if (!name || /[,\r\n]/.test(name)) continue;

    // Values are read in the file's pixels, then converted to reference pixels.
    const factor = styleScale(playRes);
    const base = scaleStyle(defaultStyle(), factor);
    const num = (key: string, fallback: number) => {
      const n = Number(get(key));
      return get(key) !== undefined && Number.isFinite(n) ? n : fallback;
    };
    const int = (key: string, fallback: number) => Math.round(num(key, fallback));
    const bool = (key: string, fallback: boolean) =>
      get(key) === undefined ? fallback : Number(get(key)) !== 0;
    const color = (key: string, fallback: Color) => {
      const value = get(key);
      return (value !== undefined && parseColor(value)) || fallback;
    };
    const rawAlignment = int("alignment", base.alignment);
    const alignment = legacy
      ? (SSA_ALIGNMENT[rawAlignment] ?? 2)
      : rawAlignment >= 1 && rawAlignment <= 9
        ? (rawAlignment as Alignment)
        : 2;

    if (name in styles) warnings.push(`Style "${name}" is defined twice; the last one is used.`);
    styles[name] = unscaleStyle(
      {
        fontName: get("fontname")?.trim() || base.fontName,
        fontSize: Math.max(0, num("fontsize", base.fontSize)),
        primaryColor: color("primarycolour", base.primaryColor),
        secondaryColor: color("secondarycolour", base.secondaryColor),
        outlineColor: color("outlinecolour", color("tertiarycolour", base.outlineColor)),
        backColor: color("backcolour", base.backColor),
        bold: bool("bold", base.bold),
        italic: bool("italic", base.italic),
        underline: bool("underline", base.underline),
        strikeOut: bool("strikeout", base.strikeOut),
        scaleX: Math.max(0, num("scalex", base.scaleX)),
        scaleY: Math.max(0, num("scaley", base.scaleY)),
        spacing: num("spacing", base.spacing),
        angle: num("angle", base.angle),
        borderStyle: int("borderstyle", 1) === 3 ? 3 : 1,
        outline: Math.max(0, num("outline", base.outline)),
        shadow: Math.max(0, num("shadow", base.shadow)),
        alignment,
        marginL: int("marginl", base.marginL),
        marginR: int("marginr", base.marginR),
        marginV: int("marginv", base.marginV),
        encoding: int("encoding", base.encoding),
        blur: 0,
        fadeIn: 0,
        fadeOut: 0,
      },
      factor,
    );
  }
  return styles;
}

function parseEvents(
  lines: string[],
  styles: Record<string, AssStyle>,
  warnings: string[],
  eventNotes: string[],
): TextItem[] {
  const format = formatOf(lines, DEFAULT_EVENT_FORMAT);
  // Text must be last; that's what lets it contain commas.
  const textIndex = format.indexOf("text");
  const items: TextItem[] = [];
  const fallbackStyle = DEFAULT_STYLE in styles ? DEFAULT_STYLE : Object.keys(styles)[0];
  const unknownStyles = new Set<string>();
  let comments = 0;
  let invalid = 0;

  for (const line of lines) {
    const kind = lineKind(line);
    if (kind === "comment") comments++;
    if (kind !== "dialogue") continue;

    const values = fields(line, format.length);
    const get = (key: string) => values[format.indexOf(key)];
    const start = parseAssTime(get("start") ?? "");
    const end = parseAssTime(get("end") ?? "");
    if (textIndex !== format.length - 1 || start === null || end === null || end <= start) {
      invalid++;
      continue;
    }

    let styleName = get("style")?.trim().replace(/^\*/, "") ?? "";
    if (!(styleName in styles)) {
      if (styleName) unknownStyles.add(styleName);
      styleName = fallbackStyle;
    }

    const item: TextItem = {
      id: crypto.randomUUID(),
      type: "text",
      start,
      end,
      // SSA used "Marked=0" here; anything non-numeric is layer 0.
      layer: Math.max(0, Math.round(Number(get("layer")) || 0)),
      text: (get("text") ?? "").replace(/\\N/g, "\n"),
      styleName,
    };
    const margins = (["marginL", "marginR", "marginV"] as const).flatMap((key) => {
      const value = Math.round(Number(get(key.toLowerCase())) || 0);
      return value !== 0 ? [[key, value] as const] : [];
    });
    if (margins.length > 0) item.overrides = Object.fromEntries(margins);
    items.push(item);
  }

  if (unknownStyles.size > 0) {
    warnings.push(
      `Unknown style${unknownStyles.size > 1 ? "s" : ""} ${[...unknownStyles].map((s) => `"${s}"`).join(", ")} replaced by "${fallbackStyle}".`,
    );
  }
  if (comments > 0) eventNotes.push(`${comments} comment line${comments > 1 ? "s" : ""} not kept.`);
  if (invalid > 0) {
    eventNotes.push(
      `${invalid} event${invalid > 1 ? "s" : ""} with invalid times or fields skipped.`,
    );
  }
  return items;
}
