import { PROJECT_VERSION, type AssStyle, type Project, type VideoRef } from "./project";

export const DEFAULT_STYLE = "Default";

/** A readable default style, sized relative to the video resolution. */
export function defaultStyle(playRes: { x: number; y: number }): AssStyle {
  return {
    fontName: "Arial",
    fontSize: Math.round(playRes.y * 0.055),
    primaryColor: { r: 255, g: 255, b: 255, a: 255 },
    secondaryColor: { r: 255, g: 0, b: 0, a: 255 },
    outlineColor: { r: 0, g: 0, b: 0, a: 255 },
    backColor: { r: 0, g: 0, b: 0, a: 128 },
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    scaleX: 100,
    scaleY: 100,
    spacing: 0,
    angle: 0,
    borderStyle: 1,
    outline: Math.max(1, Math.round(playRes.y * 0.0025)),
    shadow: 0,
    alignment: 2,
    marginL: Math.round(playRes.x * 0.03),
    marginR: Math.round(playRes.x * 0.03),
    marginV: Math.round(playRes.y * 0.04),
    encoding: 1,
  };
}

/** An empty project for a video; `playRes` matches the video's size. */
export function createProject(video: VideoRef): Project {
  const playRes = { x: video.width, y: video.height };
  return {
    version: PROJECT_VERSION,
    video,
    playRes,
    styles: { [DEFAULT_STYLE]: defaultStyle(playRes) },
    items: [],
  };
}
