import * as v from "valibot";
import { defaultShapeStyle, defaultStyle } from "./defaults";
import {
  AssStyleSchema,
  OverlaySchema,
  ShapeStyleSchema,
  StyleNameSchema,
  type AssStyle,
  type Project,
} from "./project";

/**
 * A stylesheet ("house style"): named styles shared by every project linked
 * to it. Values are in 1080-line reference pixels, like project styles.
 */
export const STYLESHEET_VERSION = 3;

export const StylesheetSchema = v.pipe(
  v.object({
    version: v.literal(STYLESHEET_VERSION),
    id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/)),
    name: v.pipe(v.string(), v.minLength(1)),
    styles: v.pipe(
      v.record(StyleNameSchema, AssStyleSchema),
      v.check((styles) => Object.keys(styles).length > 0, "A stylesheet needs at least one style"),
    ),
    shapeStyles: v.pipe(
      v.record(StyleNameSchema, ShapeStyleSchema),
      v.check(
        (styles) => Object.keys(styles).length > 0,
        "A stylesheet needs at least one shape style",
      ),
    ),
    /** Shapes (e.g. a logo) shown on every video linked to this stylesheet. */
    overlays: v.array(OverlaySchema),
  }),
  v.check(
    (sheet) => Object.keys(sheet.shapeStyles).every((name) => !(name in sheet.styles)),
    "Shape styles and text styles need different names",
  ),
  v.check(
    (sheet) => sheet.overlays.every((o) => o.styleName in sheet.shapeStyles),
    "Every overlay must use an existing shape style",
  ),
);
export type Stylesheet = v.InferOutput<typeof StylesheetSchema>;

export type Styles = Record<string, AssStyle>;

/** The name of a new style: `base`, or `base 2`, `base 3`, ... if taken. */
export function uniqueStyleName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Upgrades older stylesheet files; unknown shapes are left for validation. */
function migrate(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  let sheet = data as Record<string, unknown>;
  // v2: shape styles. Give old stylesheets one, so shapes always have a style.
  if (sheet.version === 1 && typeof sheet.styles === "object" && sheet.styles !== null) {
    const name = uniqueStyleName("Shape", Object.keys(sheet.styles));
    sheet = { ...sheet, version: 2, shapeStyles: { [name]: defaultShapeStyle() } };
  }
  // v3: overlays.
  if (sheet.version === 2) sheet = { ...sheet, version: 3, overlays: [] };
  return sheet;
}

export function parseStylesheet(json: string): Stylesheet {
  const result = v.safeParse(StylesheetSchema, migrate(JSON.parse(json)));
  if (result.success) return result.output;
  const issue = result.issues[0];
  const path = v.getDotPath(issue);
  throw new Error(`Invalid stylesheet${path ? ` at ${path}` : ""}: ${issue.message}`);
}

export function serializeStylesheet(sheet: Stylesheet): string {
  return JSON.stringify(sheet, null, 2) + "\n";
}

/** The stylesheet created on first run. */
export function houseStyle(id: string): Stylesheet {
  const subtitle = defaultStyle();
  return {
    version: STYLESHEET_VERSION,
    id,
    name: "House style",
    styles: {
      Subtitle: subtitle,
      "Section title": {
        ...subtitle,
        fontSize: 110,
        bold: true,
        outline: 4,
        alignment: 5,
        fadeIn: 300,
        fadeOut: 300,
      },
    },
    shapeStyles: { Shape: defaultShapeStyle() },
    overlays: [],
  };
}

/** The style captions fall back to: the stylesheet's first. */
export function firstStyle(sheet: Stylesheet): string {
  return Object.keys(sheet.styles)[0];
}

/** The style shapes fall back to: the stylesheet's first shape style. */
export function firstShapeStyle(sheet: Stylesheet): string {
  return Object.keys(sheet.shapeStyles)[0];
}

/** How many captions and shapes use a style `sheet` doesn't have. */
export interface Reassigned {
  captions: number;
  shapes: number;
}

export function itemsWithoutStyle(project: Project, sheet: Stylesheet): Reassigned {
  const count = { captions: 0, shapes: 0 };
  for (const i of project.items) {
    if (i.type === "text" && !(i.styleName in sheet.styles)) count.captions++;
    if (i.type === "shape" && !(i.styleName in sheet.shapeStyles)) count.shapes++;
  }
  return count;
}

/**
 * Links a project to `sheet` and gives it exactly the stylesheet's styles.
 * Captions and shapes whose style the stylesheet doesn't have switch to its
 * first (shape) style. Returns the project and how many items were reassigned.
 */
export function conformToStylesheet(
  project: Project,
  sheet: Stylesheet,
): { project: Project; reassigned: Reassigned } {
  const reassigned = itemsWithoutStyle(project, sheet);
  const items = project.items.map((i) => {
    if (i.type === "text" && !(i.styleName in sheet.styles)) {
      return { ...i, styleName: firstStyle(sheet) };
    }
    if (i.type === "shape" && !(i.styleName in sheet.shapeStyles)) {
      return { ...i, styleName: firstShapeStyle(sheet) };
    }
    return i;
  });
  return {
    project: {
      ...project,
      stylesheet: sheet.id,
      styles: { ...sheet.styles },
      shapeStyles: { ...sheet.shapeStyles },
      overlays: [...sheet.overlays],
      items,
    },
    reassigned,
  };
}

export function anyReassigned(r: Reassigned): boolean {
  return r.captions + r.shapes > 0;
}

/**
 * Describes reassignment to `sheet`'s first styles for notices, e.g.
 * `2 captions will switch to "Subtitle" and 1 shape will switch to "Shape"`.
 */
export function describeReassigned(r: Reassigned, sheet: Stylesheet, when: "now" | "will"): string {
  const part = (n: number, word: string, style: string) => {
    const noun = `${n} ${word}${n === 1 ? "" : "s"}`;
    const verb = when === "will" ? "will switch to" : n === 1 ? "now uses" : "now use";
    return `${noun} ${verb} "${style}"`;
  };
  const parts = [];
  if (r.captions) parts.push(part(r.captions, "caption", firstStyle(sheet)));
  if (r.shapes) parts.push(part(r.shapes, "shape", firstShapeStyle(sheet)));
  return parts.join(" and ");
}
