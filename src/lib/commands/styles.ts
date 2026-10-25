import type { AssStyle, Item, Project, ShapeStyle } from "$lib/model/project";
import { conformToStylesheet, type Stylesheet } from "$lib/model/stylesheet";
import type { Command } from "./history";

/**
 * Commands for named styles. Changing style properties is `setStyle` /
 * `setShapeStyle` in items.ts.
 *
 * Text styles (`styles`, used by captions) and shape styles (`shapeStyles`,
 * used by shapes) work alike; names are unique across both lists, because
 * both become ASS styles.
 */
export type StyleKind = "text" | "shape";

type AnyStyle = AssStyle | ShapeStyle;

function stylesOf(p: Project, kind: StyleKind): Record<string, AnyStyle> {
  return kind === "text" ? p.styles : p.shapeStyles;
}

function withStyles(p: Project, kind: StyleKind, styles: Record<string, AnyStyle>): Project {
  return kind === "text"
    ? { ...p, styles: styles as Record<string, AssStyle> }
    : { ...p, shapeStyles: styles as Record<string, ShapeStyle> };
}

/** Whether `item` uses style `name` of `kind`. */
function uses(item: Item, kind: StyleKind, name: string): boolean {
  return (
    (kind === "text" ? item.type === "text" : item.type === "shape") && item.styleName === name
  );
}

/** Whether `name` is free in both style lists. */
export function styleNameFree(p: Project, name: string): boolean {
  return !(name in p.styles) && !(name in p.shapeStyles);
}

export function addStyle(name: string, style: AssStyle): Command;
export function addStyle(name: string, style: ShapeStyle, kind: "shape"): Command;
export function addStyle(name: string, style: AnyStyle, kind: StyleKind = "text"): Command {
  return {
    label: "Add style",
    apply: (p) =>
      styleNameFree(p, name) ? withStyles(p, kind, { ...stylesOf(p, kind), [name]: style }) : p,
  };
}

/**
 * Removes a style. Items using it switch to `replacement` (by default the
 * first remaining style of that kind). The last style can't be removed.
 */
export function deleteStyle(name: string, replacement?: string, kind: StyleKind = "text"): Command {
  return {
    label: "Delete style",
    apply: (p) => {
      const current = stylesOf(p, kind);
      if (!(name in current) || Object.keys(current).length < 2) return p;
      const styles = { ...current };
      delete styles[name];
      const fallback = replacement && replacement in styles ? replacement : Object.keys(styles)[0];
      const items = p.items.map((i) => (uses(i, kind, name) ? { ...i, styleName: fallback } : i));
      return { ...withStyles(p, kind, styles), items };
    },
  };
}

/** Renames a style in place (keeping its position) and in every item using it. */
export function renameStyle(from: string, to: string, kind: StyleKind = "text"): Command {
  return {
    label: "Rename style",
    apply: (p) => {
      const name = to.trim();
      const current = stylesOf(p, kind);
      if (!(from in current) || !name || !styleNameFree(p, name) || /[,\r\n]/.test(name)) return p;
      const styles = Object.fromEntries(
        Object.entries(current).map(([n, s]) => [n === from ? name : n, s]),
      );
      const items = p.items.map((i) => (uses(i, kind, from) ? { ...i, styleName: name } : i));
      return { ...withStyles(p, kind, styles), items };
    },
  };
}

/** Gives a caption a text style, or a shape a shape style. */
export function setItemStyle(id: string, styleName: string): Command {
  return {
    label: "Change item style",
    apply: (p) => {
      const index = p.items.findIndex((i) => i.id === id);
      const item = p.items[index];
      if (!item || item.styleName === styleName) return p;
      if (!(styleName in stylesOf(p, item.type === "shape" ? "shape" : "text"))) return p;
      return { ...p, items: p.items.with(index, { ...item, styleName }) };
    },
  };
}

/**
 * Switches the project to `sheet`: it takes exactly the stylesheet's styles;
 * items keep their style if the stylesheet has one with the same name,
 * otherwise they switch to its first style of that kind.
 */
export function linkStylesheet(sheet: Stylesheet): Command {
  return {
    label: "Change stylesheet",
    apply: (p: Project) => (p.stylesheet === sheet.id ? p : conformToStylesheet(p, sheet).project),
  };
}
