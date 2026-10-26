import type { Overlay, Project, ShapeGeometry } from "$lib/model/project";
import type { Command } from "./history";

/**
 * Commands for the stylesheet's overlays. Like styles, they're edited in the
 * project and copied back to its stylesheet.
 */

function updateOverlay(p: Project, id: string, update: (o: Overlay) => Overlay): Project {
  const index = p.overlays.findIndex((o) => o.id === id);
  if (index < 0) return p;
  const overlay = p.overlays[index];
  const next = update(overlay);
  return next === overlay ? p : { ...p, overlays: p.overlays.with(index, next) };
}

export function addOverlay(overlay: Overlay): Command {
  return {
    label: "Add overlay",
    apply: (p) =>
      p.overlays.some((o) => o.id === overlay.id) || !(overlay.styleName in p.shapeStyles)
        ? p
        : { ...p, overlays: [...p.overlays, overlay] },
  };
}

export function deleteOverlay(id: string): Command {
  return {
    label: "Delete overlay",
    apply: (p) => {
      const overlays = p.overlays.filter((o) => o.id !== id);
      return overlays.length === p.overlays.length ? p : { ...p, overlays };
    },
  };
}

export function setOverlayStyle(id: string, styleName: string): Command {
  return {
    label: "Change overlay style",
    apply: (p) =>
      styleName in p.shapeStyles
        ? updateOverlay(p, id, (o) => (o.styleName === styleName ? o : { ...o, styleName }))
        : p,
  };
}

/**
 * Changes an overlay's size or picture. A run of edits to one field coalesces
 * when given a `mergeKey`.
 */
export function setOverlayGeometry(
  id: string,
  changes: Partial<ShapeGeometry>,
  mergeKey?: string,
): Command {
  return {
    label: "Change overlay",
    mergeKey,
    apply: (p) =>
      updateOverlay(p, id, (o) => {
        const shape: Record<string, unknown> = o.shape;
        if (!Object.entries(changes).some(([k, v]) => shape[k] !== v)) return o;
        return { ...o, shape: { ...o.shape, ...changes } };
      }),
  };
}

/** Shows or hides the stylesheet's overlays in this video only. */
export function setHideOverlays(hide: boolean): Command {
  return {
    label: hide ? "Hide overlays" : "Show overlays",
    apply: (p) => (p.hideOverlays === hide ? p : { ...p, hideOverlays: hide }),
  };
}
