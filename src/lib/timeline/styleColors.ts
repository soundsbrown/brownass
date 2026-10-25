import type { Project } from "$lib/model/project";

/** A caption box's colours: normal and selected (lighter). */
export interface BoxColor {
  fill: string;
  selected: string;
}

/**
 * Distinct, muted colours that keep white text readable on a dark UI. The
 * first is the original caption blue.
 */
const PALETTE: BoxColor[] = [
  { fill: "#355f91", selected: "#4f86c6" }, // blue
  { fill: "#8a6418", selected: "#b98a2c" }, // amber
  { fill: "#2f7a4f", selected: "#43a56c" }, // green
  { fill: "#6a4c93", selected: "#8c6cbd" }, // purple
  { fill: "#8f3b3b", selected: "#c05656" }, // red
  { fill: "#2a7480", selected: "#3c9dac" }, // teal
  { fill: "#8a3f6e", selected: "#b85994" }, // pink
  { fill: "#6b7a2a", selected: "#93a63c" }, // olive
];

/** For captions whose style no longer exists. */
const UNKNOWN: BoxColor = { fill: "#555a63", selected: "#767c87" };

/**
 * Every style name, text styles first: shape styles take the colours after
 * the text styles', so captions and shapes are told apart.
 */
export function allStyleNames(project: Project): string[] {
  return [...Object.keys(project.styles), ...Object.keys(project.shapeStyles)];
}

/**
 * The colour for a style: by its position in the project's (= stylesheet's)
 * style order (see `allStyleNames`), so it's the same in every video using
 * that stylesheet and survives renames.
 */
export function styleColor(styleNames: readonly string[], name: string): BoxColor {
  const index = styleNames.indexOf(name);
  return index < 0 ? UNKNOWN : PALETTE[index % PALETTE.length];
}
