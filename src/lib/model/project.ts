import * as v from "valibot";
import { parseDrawing } from "$lib/ass/drawing";

// The schemas are the source of truth for the project types, so a loaded file
// is validated against exactly what the rest of the app expects.

const Seconds = v.pipe(v.number(), v.finite(), v.minValue(0));
const Byte = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255));
const NonNegative = v.pipe(v.number(), v.finite(), v.minValue(0));
const Integer = v.pipe(v.number(), v.integer());
const Finite = v.pipe(v.number(), v.finite());
const Positive = v.pipe(v.number(), v.finite(), v.gtValue(0));

/** RGB plus opacity (`a`: 0 = transparent, 255 = opaque). */
export const ColorSchema = v.object({ r: Byte, g: Byte, b: Byte, a: Byte });
export type Color = v.InferOutput<typeof ColorSchema>;

/** Numpad layout: 1-3 bottom, 4-6 middle, 7-9 top. */
export const AlignmentSchema = v.picklist([1, 2, 3, 4, 5, 6, 7, 8, 9]);
export type Alignment = v.InferOutput<typeof AlignmentSchema>;

/** Style names end up in comma-separated ASS lines. */
export const StyleNameSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.regex(/^[^,\r\n]+$/, "Style names cannot contain commas or line breaks"),
);

/**
 * An ASS `[V4+ Styles]` entry; the name is its key in `Project.styles`.
 *
 * Sizes, outline, shadow, blur, spacing and margins are in pixels of a
 * 1080-line reference frame (see `model/scale.ts`); the serializer scales
 * them to the project's `playRes`. That keeps a stylesheet's values exact
 * across videos of any resolution.
 */
export const AssStyleSchema = v.object({
  fontName: v.string(),
  fontSize: NonNegative,
  primaryColor: ColorSchema,
  secondaryColor: ColorSchema,
  outlineColor: ColorSchema,
  backColor: ColorSchema,
  bold: v.boolean(),
  italic: v.boolean(),
  underline: v.boolean(),
  strikeOut: v.boolean(),
  /** Percent. */
  scaleX: NonNegative,
  scaleY: NonNegative,
  spacing: v.pipe(v.number(), v.finite()),
  /** Degrees, counter-clockwise. */
  angle: v.pipe(v.number(), v.finite()),
  /** 1 = outline + drop shadow, 3 = opaque box. */
  borderStyle: v.picklist([1, 3]),
  outline: NonNegative,
  shadow: NonNegative,
  alignment: AlignmentSchema,
  marginL: Finite,
  marginR: Finite,
  marginV: Finite,
  encoding: Integer,
  // Not part of ASS styles: written as \blur and \fad tags on each event.
  blur: NonNegative,
  /** Fade durations in milliseconds. */
  fadeIn: NonNegative,
  fadeOut: NonNegative,
});
export type AssStyle = v.InferOutput<typeof AssStyleSchema>;

/** Per-item overrides, written as override tags or event margins. */
export const AssStyleOverridesSchema = v.partial(
  v.object({
    fontName: v.string(),
    fontSize: NonNegative,
    bold: v.boolean(),
    italic: v.boolean(),
    underline: v.boolean(),
    strikeOut: v.boolean(),
    primaryColor: ColorSchema,
    outlineColor: ColorSchema,
    backColor: ColorSchema,
    outline: NonNegative,
    shadow: NonNegative,
    blur: NonNegative,
    alignment: AlignmentSchema,
    marginL: Integer,
    marginR: Integer,
    marginV: Integer,
    /** Absolute position in `playRes` coordinates. */
    pos: v.object({ x: v.number(), y: v.number() }),
    /** Fade durations in milliseconds. */
    fade: v.object({ in: NonNegative, out: NonNegative }),
  }),
);
export type AssStyleOverrides = v.InferOutput<typeof AssStyleOverridesSchema>;

const ItemBaseEntries = {
  /** Stable UUID. */
  id: v.pipe(v.string(), v.minLength(1)),
  start: Seconds,
  end: Seconds,
  /** ASS layer; also orders items on the timeline. */
  layer: v.pipe(Integer, v.minValue(0)),
};

export const TextItemSchema = v.object({
  ...ItemBaseEntries,
  type: v.literal("text"),
  /** Plain text; ASS override tags are allowed and kept verbatim. */
  text: v.string(),
  styleName: StyleNameSchema,
  overrides: v.optional(AssStyleOverridesSchema),
});
export type TextItem = v.InferOutput<typeof TextItemSchema>;

/**
 * How a shape looks and where it sits; the shape counterpart of `AssStyle`.
 * Sizes and margins are in 1080-line reference pixels, like `AssStyle`.
 */
export const ShapeStyleSchema = v.object({
  /** Percent; multiplies every colour of the shape. */
  opacity: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100)),
  outlineColor: ColorSchema,
  outline: NonNegative,
  shadowColor: ColorSchema,
  shadow: NonNegative,
  blur: NonNegative,
  alignment: AlignmentSchema,
  marginL: Finite,
  marginR: Finite,
  marginV: Finite,
  /** Fade durations in milliseconds. */
  fadeIn: NonNegative,
  fadeOut: NonNegative,
});
export type ShapeStyle = v.InferOutput<typeof ShapeStyleSchema>;

/** An ASS drawing using only `m`, `l` and `b` commands. */
const DrawingSchema = v.pipe(
  v.string(),
  v.check((s) => {
    try {
      parseDrawing(s);
      return true;
    } catch {
      return false;
    }
  }, "Invalid drawing"),
);

/**
 * A shape's picture: an imported SVG as one drawing per colour, in the SVG's
 * units with the whole picture's bounding box starting at (0, 0). Drawn
 * `width` wide (1080-line reference pixels), keeping the aspect ratio.
 */
export const ShapeGeometrySchema = v.object({
  /** The SVG's file name. */
  name: v.string(),
  width: Positive,
  sourceWidth: Positive,
  sourceHeight: Positive,
  parts: v.array(v.object({ color: ColorSchema, path: DrawingSchema })),
});
export type ShapeGeometry = v.InferOutput<typeof ShapeGeometrySchema>;

export const ShapeItemSchema = v.object({
  ...ItemBaseEntries,
  type: v.literal("shape"),
  /** A key of `Project.shapeStyles`. */
  styleName: StyleNameSchema,
  shape: ShapeGeometrySchema,
});
export type ShapeItem = v.InferOutput<typeof ShapeItemSchema>;

// Image items join this union as a further variant.
export const ItemSchema = v.variant("type", [TextItemSchema, ShapeItemSchema]);
export type Item = v.InferOutput<typeof ItemSchema>;
export type ItemType = Item["type"];

export const VideoRefSchema = v.object({
  path: v.string(),
  width: v.pipe(Integer, v.minValue(1)),
  height: v.pipe(Integer, v.minValue(1)),
  fps: v.pipe(v.number(), v.finite(), v.gtValue(0)),
  duration: Seconds,
});
export type VideoRef = v.InferOutput<typeof VideoRefSchema>;

export const PROJECT_VERSION = 3;

export const ProjectSchema = v.pipe(
  v.object({
    version: v.literal(PROJECT_VERSION),
    video: VideoRefSchema,
    playRes: v.object({ x: v.pipe(Integer, v.minValue(1)), y: v.pipe(Integer, v.minValue(1)) }),
    styles: v.record(StyleNameSchema, AssStyleSchema),
    /** Styles for shape items; names never clash with `styles`. */
    shapeStyles: v.record(StyleNameSchema, ShapeStyleSchema),
    /** Id of the linked stylesheet, whose styles this project follows. */
    stylesheet: v.optional(v.string()),
    items: v.array(ItemSchema),
  }),
  v.check((p) => p.items.every((i) => i.start < i.end), "Every item must end after it starts"),
  v.check(
    (p) => p.items.every((i) => i.type !== "text" || i.styleName in p.styles),
    "Every text item must use an existing style",
  ),
  v.check(
    (p) => p.items.every((i) => i.type !== "shape" || i.styleName in p.shapeStyles),
    "Every shape must use an existing shape style",
  ),
  v.check(
    (p) => Object.keys(p.shapeStyles).every((name) => !(name in p.styles)),
    "Shape styles and text styles need different names",
  ),
  v.check(
    (p) => new Set(p.items.map((i) => i.id)).size === p.items.length,
    "Item ids must be unique",
  ),
);
export type Project = v.InferOutput<typeof ProjectSchema>;
