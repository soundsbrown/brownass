import type { AssStyle, Project } from "$lib/model/project";
import { conformToStylesheet, type Stylesheet } from "$lib/model/stylesheet";
import type { Command } from "./history";

/** Commands for named styles. Changing style properties is `setStyle` in items.ts. */

export function addStyle(name: string, style: AssStyle): Command {
  return {
    label: "Add style",
    apply: (p) => (name in p.styles ? p : { ...p, styles: { ...p.styles, [name]: style } }),
  };
}

/**
 * Removes a style. Captions using it switch to `replacement` (by default the
 * first remaining style). The last style can't be removed.
 */
export function deleteStyle(name: string, replacement?: string): Command {
  return {
    label: "Delete style",
    apply: (p) => {
      if (!(name in p.styles) || Object.keys(p.styles).length < 2) return p;
      const styles = { ...p.styles };
      delete styles[name];
      const fallback = replacement && replacement in styles ? replacement : Object.keys(styles)[0];
      const items = p.items.map((i) =>
        i.type === "text" && i.styleName === name ? { ...i, styleName: fallback } : i,
      );
      return { ...p, styles, items };
    },
  };
}

/** Renames a style in place (keeping its position) and in every caption. */
export function renameStyle(from: string, to: string): Command {
  return {
    label: "Rename style",
    apply: (p) => {
      const name = to.trim();
      if (!(from in p.styles) || !name || name in p.styles || /[,\r\n]/.test(name)) return p;
      const styles = Object.fromEntries(
        Object.entries(p.styles).map(([n, s]) => [n === from ? name : n, s]),
      );
      const items = p.items.map((i) =>
        i.type === "text" && i.styleName === from ? { ...i, styleName: name } : i,
      );
      return { ...p, styles, items };
    },
  };
}

export function setItemStyle(id: string, styleName: string): Command {
  return {
    label: "Change subtitle style",
    apply: (p) => {
      if (!(styleName in p.styles)) return p;
      const index = p.items.findIndex((i) => i.id === id);
      const item = p.items[index];
      if (!item || item.type !== "text" || item.styleName === styleName) return p;
      return { ...p, items: p.items.with(index, { ...item, styleName }) };
    },
  };
}

/**
 * Switches the project to `sheet`: it takes exactly the stylesheet's styles;
 * captions keep their style if the stylesheet has one with the same name,
 * otherwise they switch to its first style.
 */
export function linkStylesheet(sheet: Stylesheet): Command {
  return {
    label: "Change stylesheet",
    apply: (p: Project) => (p.stylesheet === sheet.id ? p : conformToStylesheet(p, sheet).project),
  };
}
