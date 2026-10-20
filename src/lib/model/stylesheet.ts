import * as v from "valibot";
import { defaultStyle } from "./defaults";
import { AssStyleSchema, StyleNameSchema, type AssStyle, type Project } from "./project";

/**
 * A stylesheet ("house style"): named styles shared by every project linked
 * to it. Values are in 1080-line reference pixels, like project styles.
 */
export const STYLESHEET_VERSION = 1;

export const StylesheetSchema = v.object({
  version: v.literal(STYLESHEET_VERSION),
  id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/)),
  name: v.pipe(v.string(), v.minLength(1)),
  styles: v.pipe(
    v.record(StyleNameSchema, AssStyleSchema),
    v.check((styles) => Object.keys(styles).length > 0, "A stylesheet needs at least one style"),
  ),
});
export type Stylesheet = v.InferOutput<typeof StylesheetSchema>;

export type Styles = Record<string, AssStyle>;

export function parseStylesheet(json: string): Stylesheet {
  const result = v.safeParse(StylesheetSchema, JSON.parse(json));
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
  };
}

/** The style captions fall back to: the stylesheet's first. */
export function firstStyle(sheet: Stylesheet): string {
  return Object.keys(sheet.styles)[0];
}

/** Captions whose style `sheet` doesn't have. */
export function captionsWithoutStyle(project: Project, sheet: Stylesheet): number {
  return project.items.filter((i) => i.type === "text" && !(i.styleName in sheet.styles)).length;
}

/**
 * Links a project to `sheet` and gives it exactly the stylesheet's styles.
 * Captions whose style the stylesheet doesn't have switch to its first style.
 * Returns the project and how many captions were reassigned.
 */
export function conformToStylesheet(
  project: Project,
  sheet: Stylesheet,
): { project: Project; reassigned: number } {
  const fallback = firstStyle(sheet);
  let reassigned = 0;
  const items = project.items.map((i) => {
    if (i.type !== "text" || i.styleName in sheet.styles) return i;
    reassigned++;
    return { ...i, styleName: fallback };
  });
  return {
    project: { ...project, stylesheet: sheet.id, styles: { ...sheet.styles }, items },
    reassigned,
  };
}
