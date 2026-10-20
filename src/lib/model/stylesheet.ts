import * as v from "valibot";
import { defaultStyle } from "./defaults";
import { AssStyleSchema, StyleNameSchema, type AssStyle } from "./project";

/**
 * A stylesheet ("house style"): named styles shared by every project linked
 * to it. Values are in 1080-line reference pixels, like project styles.
 */
export const STYLESHEET_VERSION = 1;

export const StylesheetSchema = v.object({
  version: v.literal(STYLESHEET_VERSION),
  id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/)),
  name: v.pipe(v.string(), v.minLength(1)),
  styles: v.record(StyleNameSchema, AssStyleSchema),
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

/**
 * A linked project's styles: the stylesheet's (in its order), plus any of
 * the project's own styles the stylesheet doesn't have (e.g. imported ones).
 */
export function applyStylesheet(styles: Styles, sheet: Stylesheet): Styles {
  const extras = Object.entries(styles).filter(([name]) => !(name in sheet.styles));
  return { ...sheet.styles, ...Object.fromEntries(extras) };
}

/**
 * Reflects a change in a linked project's styles (`before` → `after`) in its
 * stylesheet: edits to the stylesheet's styles, styles added since `before`,
 * and removals. Styles that are only the project's (present in `before` but
 * not in the stylesheet) stay out of it. Returns `sheet` itself if nothing
 * changes.
 */
export function mirrorStyles(sheet: Stylesheet, before: Styles, after: Styles): Stylesheet {
  if (before === after) return sheet;
  const styles: Styles = {};
  let changed = false;
  for (const [name, style] of Object.entries(after)) {
    const inSheet = name in sheet.styles;
    const added = !(name in before);
    if (!inSheet && !added) continue;
    styles[name] = inSheet && style === before[name] ? sheet.styles[name] : style;
    if (styles[name] !== sheet.styles[name]) changed = true;
  }
  for (const name of Object.keys(sheet.styles)) {
    if (name in styles) continue;
    if (name in before && !(name in after)) {
      changed = true; // Deleted (or renamed) in the project.
    } else {
      styles[name] = sheet.styles[name];
    }
  }
  return changed ? { ...sheet, styles } : sheet;
}
