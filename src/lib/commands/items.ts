import type {
  AssStyle,
  AssStyleOverrides,
  Item,
  Project,
  ShapeGeometry,
  ShapeStyle,
  TextItem,
} from "$lib/model/project";
import type { Seconds } from "$lib/time";
import type { Command } from "./history";

/** Items are at least one frame long. */
export function minDuration(project: Project): Seconds {
  return 1 / project.video.fps;
}

/**
 * Clamps a time span into the video while keeping it at least
 * `minDuration` long: start < end, both within [0, duration].
 */
export function clampSpan(
  project: Project,
  start: Seconds,
  end: Seconds,
): { start: Seconds; end: Seconds } {
  const duration = project.video.duration;
  const min = Math.min(minDuration(project), duration);
  const s = Math.min(Math.max(0, start), duration - min);
  const e = Math.min(Math.max(end, s + min), duration);
  return { start: s, end: e };
}

function updateItem(project: Project, id: string, update: (item: Item) => Item): Project {
  const index = project.items.findIndex((i) => i.id === id);
  if (index < 0) return project;
  const item = project.items[index];
  const next = update(item);
  if (next === item) return project;
  const items = project.items.with(index, next);
  return { ...project, items };
}

function updateText(project: Project, id: string, update: (item: TextItem) => TextItem): Project {
  return updateItem(project, id, (item) => (item.type === "text" ? update(item) : item));
}

export function addItem(item: Item): Command {
  return {
    label: item.type === "shape" ? "Add shape" : "Add subtitle",
    apply: (p) => {
      if (p.items.some((i) => i.id === item.id)) return p;
      return { ...p, items: [...p.items, { ...item, ...clampSpan(p, item.start, item.end) }] };
    },
  };
}

/** Copies an item to just after itself, as `newId`. */
export function duplicateItem(id: string, newId: string): Command {
  return {
    label: "Duplicate subtitle",
    apply: (p) => {
      const item = p.items.find((i) => i.id === id);
      if (!item) return p;
      const length = item.end - item.start;
      return addItem({ ...item, id: newId, start: item.end, end: item.end + length }).apply(p);
    },
  };
}

export function deleteItem(id: string): Command {
  return {
    label: "Delete subtitle",
    apply: (p) => {
      const items = p.items.filter((i) => i.id !== id);
      return items.length === p.items.length ? p : { ...p, items };
    },
  };
}

/** Moves an item, keeping its duration. Pass a per-gesture `mergeKey` for drags. */
export function moveItem(id: string, start: Seconds, mergeKey?: string): Command {
  return {
    label: "Move subtitle",
    mergeKey,
    apply: (p) =>
      updateItem(p, id, (item) => {
        const length = item.end - item.start;
        const duration = p.video.duration;
        const s = Math.min(Math.max(0, start), Math.max(0, duration - length));
        return s === item.start ? item : { ...item, start: s, end: s + length };
      }),
  };
}

/** Sets an item's start and end (resizing), clamped to valid times. */
export function setItemSpan(id: string, start: Seconds, end: Seconds, mergeKey?: string): Command {
  return {
    label: "Change subtitle timing",
    mergeKey,
    apply: (p) =>
      updateItem(p, id, (item) => {
        const span = clampSpan(p, start, end);
        return span.start === item.start && span.end === item.end ? item : { ...item, ...span };
      }),
  };
}

/** Edits text; rapid typing in one item merges into a single undo step. */
export function editText(id: string, text: string): Command {
  return {
    label: "Edit text",
    mergeKey: `text:${id}`,
    apply: (p) => updateText(p, id, (item) => (item.text === text ? item : { ...item, text })),
  };
}

/** Sets (or, with `undefined`, removes) one per-item override. */
export function setOverride<K extends keyof AssStyleOverrides>(
  id: string,
  key: K,
  value: AssStyleOverrides[K] | undefined,
  mergeKey?: string,
): Command {
  return {
    label: "Change subtitle property",
    mergeKey,
    apply: (p) =>
      updateText(p, id, (item) => {
        const current = item.overrides ?? {};
        if (current[key] === value) return item;
        const overrides = { ...current };
        if (value === undefined) delete overrides[key];
        else overrides[key] = value;
        return { ...item, overrides };
      }),
  };
}

/** Changes properties of a named style, affecting every item that uses it. */
export function setStyle(name: string, changes: Partial<AssStyle>, mergeKey?: string): Command {
  return {
    label: "Change style",
    mergeKey,
    apply: (p) => {
      const style = p.styles[name];
      if (!style) return p;
      const changed = (Object.keys(changes) as (keyof AssStyle)[]).some(
        (k) => changes[k] !== style[k],
      );
      return changed ? { ...p, styles: { ...p.styles, [name]: { ...style, ...changes } } } : p;
    },
  };
}

/** Changes properties of a named shape style, affecting every shape that uses it. */
export function setShapeStyle(
  name: string,
  changes: Partial<ShapeStyle>,
  mergeKey?: string,
): Command {
  return {
    label: "Change shape style",
    mergeKey,
    apply: (p) => {
      const style = p.shapeStyles[name];
      if (!style) return p;
      const changed = (Object.keys(changes) as (keyof ShapeStyle)[]).some(
        (k) => changes[k] !== style[k],
      );
      if (!changed) return p;
      return { ...p, shapeStyles: { ...p.shapeStyles, [name]: { ...style, ...changes } } };
    },
  };
}

/**
 * Changes a shape's size or picture. A run of edits to one field coalesces
 * when given a `mergeKey`.
 */
export function setShapeGeometry(
  id: string,
  changes: Partial<ShapeGeometry>,
  mergeKey?: string,
): Command {
  return {
    label: "Change shape",
    mergeKey,
    apply: (p) =>
      updateItem(p, id, (item) => {
        if (item.type !== "shape") return item;
        const shape: Record<string, unknown> = item.shape;
        if (!Object.entries(changes).some(([k, v]) => shape[k] !== v)) return item;
        return { ...item, shape: { ...item.shape, ...changes } };
      }),
  };
}

/** Moves an item to another ASS layer (higher layers draw on top). */
export function setItemLayer(id: string, layer: number): Command {
  return {
    label: "Change layer",
    apply: (p) =>
      updateItem(p, id, (item) => {
        const l = Math.max(0, Math.round(layer));
        return l === item.layer ? item : { ...item, layer: l };
      }),
  };
}
