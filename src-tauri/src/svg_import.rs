//! Importing an SVG as an ASS drawing: one filled outline per colour.
//!
//! `usvg` resolves CSS, `<use>`, transforms and basic shapes, and turns text
//! into outlines. Fills become parts; strokes are converted to filled
//! outlines. ASS drawings are flat colour only, so gradients become their
//! average colour and patterns, images, clip paths, masks and filters are left
//! out, each with a warning. Fonts embedded in the SVG's CSS (`@font-face`
//! with a data URL, as diagram tools write them) are used for its text.

use std::collections::BTreeSet;
use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use usvg::tiny_skia_path::{self, PathSegment};

use crate::dialogs;
use crate::project_files::read_text;
use crate::woff;

/// Larger files are almost certainly not logos.
const MAX_FILE_BYTES: u64 = 5_000_000;
/// More points than this make drawings slow to render in libass.
const MAX_POINTS: usize = 50_000;
/// Curves are flattened this finely to work out which contours are holes.
const CURVE_STEPS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Part {
    pub color: Rgba,
    /// `m`/`l`/`b` drawing commands, relative to the whole picture's top left.
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSvg {
    /// File name, for display.
    pub name: String,
    /// Size of the drawn area, in SVG units.
    pub width: f64,
    pub height: f64,
    pub parts: Vec<Part>,
    /// Things that couldn't be imported as they look.
    pub warnings: Vec<String>,
}

/// Asks for an SVG file and converts it. `Ok(None)` means cancelled.
#[tauri::command]
pub async fn import_svg(app: AppHandle) -> Result<Option<ImportedSvg>, String> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Import SVG")
        .add_filter("SVG", &["svg"]);
    let Some(path) = dialogs::pick_file(dialog).await else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || load(&path))
        .await
        .map_err(|e| e.to_string())?
        .map(Some)
}

fn load(path: &Path) -> Result<ImportedSvg, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_FILE_BYTES {
        return Err("That SVG is too large to import (over 5 MB).".into());
    }
    let text = read_text(path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut options = usvg::Options::default();
    // Text is turned into outlines with the installed fonts.
    options.fontdb_mut().load_system_fonts();
    convert(&text, name, options)
}

/// Converts SVG source to drawing parts.
fn convert(text: &str, name: String, mut options: usvg::Options) -> Result<ImportedSvg, String> {
    // Images are skipped anyway; don't let the SVG make us read other files.
    options.image_href_resolver = usvg::ImageHrefResolver {
        resolve_data: usvg::ImageHrefResolver::default_data_resolver(),
        resolve_string: Box::new(|_, _| None),
    };
    let mut collector = Collector::default();
    load_embedded_fonts(text, options.fontdb_mut(), &mut collector.warnings);
    let tree =
        usvg::Tree::from_str(text, &options).map_err(|e| format!("Not a usable SVG: {e}"))?;

    collector.group(tree.root(), 1.0, None);
    let Collector {
        parts,
        warnings,
        points,
    } = collector;
    if points > MAX_POINTS {
        return Err(format!(
            "That SVG is too detailed to use as a shape ({points} points; at most {MAX_POINTS})."
        ));
    }
    if parts.is_empty() {
        return Err("That SVG has nothing that can be drawn as a shape.".into());
    }

    let bounds = parts
        .iter()
        .flat_map(|p| p.contours.iter())
        .flat_map(|c| c.points())
        .fold(Bounds::EMPTY, Bounds::add);
    let parts = parts
        .into_iter()
        .map(|p| Part {
            color: p.color,
            path: format_contours(&p.contours, -bounds.min_x, -bounds.min_y),
        })
        .collect();
    Ok(ImportedSvg {
        name,
        width: round(bounds.max_x - bounds.min_x),
        height: round(bounds.max_y - bounds.min_y),
        parts,
        warnings: warnings.into_iter().collect(),
    })
}

/// Adds the fonts of the SVG's `@font-face` rules with data URLs to `db`,
/// under their CSS family names, so its text looks as designed.
fn load_embedded_fonts(text: &str, db: &mut fontdb::Database, warnings: &mut BTreeSet<String>) {
    for (family, url) in font_faces(text) {
        let Some(data) = data_url::DataUrl::process(&url)
            .ok()
            .and_then(|u| u.decode_to_vec().ok())
            .map(|(data, _)| data)
        else {
            continue;
        };
        let data = if woff::is_woff2(&data) {
            warnings.insert(
                "Fonts embedded as WOFF2 aren't supported; their text uses installed fonts.".into(),
            );
            continue;
        } else if woff::is_woff(&data) {
            match woff::decode(&data) {
                Some(sfnt) => sfnt,
                None => continue,
            }
        } else {
            data
        };
        let mut fonts = fontdb::Database::new();
        fonts.load_font_data(data);
        for face in fonts.faces() {
            let mut face = face.clone();
            face.families
                .insert(0, (family.clone(), fontdb::Language::English_UnitedStates));
            db.push_face_info(face);
        }
    }
}

/// `(font-family, src url)` of every `@font-face` rule whose source is a data URL.
fn font_faces(text: &str) -> Vec<(String, String)> {
    let mut faces = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("@font-face") {
        rest = &rest[start..];
        let (Some(open), Some(close)) = (rest.find('{'), rest.find('}')) else {
            break;
        };
        let block = rest.get(open + 1..close).unwrap_or_default();
        rest = &rest[close.max(open) + 1..];
        let family = block
            .split_once("font-family")
            .and_then(|(_, v)| v.split_once(':'))
            .map(|(_, v)| v.split(';').next().unwrap_or(v));
        let url = block
            .split_once("url(")
            .map(|(_, v)| v.split(')').next().unwrap_or(v));
        let unquote = |s: &str| s.trim().trim_matches(['"', '\'']).trim().to_owned();
        if let (Some(family), Some(url)) = (family, url) {
            let url = unquote(url);
            if url.starts_with("data:") {
                faces.push((unquote(family), url));
            }
        }
    }
    faces
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Pt {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Copy)]
enum Segment {
    Line(Pt),
    Cubic(Pt, Pt, Pt),
}

/// A closed outline: a start point and segments back to (or near) it.
#[derive(Debug, Clone)]
struct Contour {
    start: Pt,
    segments: Vec<Segment>,
}

impl Contour {
    fn points(&self) -> impl Iterator<Item = Pt> + '_ {
        std::iter::once(self.start).chain(self.segments.iter().flat_map(|s| match *s {
            Segment::Line(p) => vec![p],
            Segment::Cubic(a, b, p) => vec![a, b, p],
        }))
    }

    /// The outline as a polygon, curves approximated.
    fn polygon(&self) -> Vec<Pt> {
        let mut poly = vec![self.start];
        let mut current = self.start;
        for s in &self.segments {
            match *s {
                Segment::Line(p) => {
                    poly.push(p);
                    current = p;
                }
                Segment::Cubic(a, b, p) => {
                    for i in 1..=CURVE_STEPS {
                        let t = i as f64 / CURVE_STEPS as f64;
                        poly.push(cubic_at(current, a, b, p, t));
                    }
                    current = p;
                }
            }
        }
        poly
    }

    fn reversed(&self) -> Contour {
        // Walk the segments backwards: each one ends where the previous began.
        let mut ends = vec![self.start];
        for s in &self.segments {
            ends.push(match *s {
                Segment::Line(p) | Segment::Cubic(_, _, p) => p,
            });
        }
        let start = *ends.last().unwrap_or(&self.start);
        let segments = self
            .segments
            .iter()
            .enumerate()
            .rev()
            .map(|(i, s)| match *s {
                Segment::Line(_) => Segment::Line(ends[i]),
                Segment::Cubic(a, b, _) => Segment::Cubic(b, a, ends[i]),
            })
            .collect();
        Contour { start, segments }
    }
}

fn cubic_at(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: f64) -> Pt {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    Pt {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    }
}

/// Twice the signed area (shoelace formula).
fn signed_area(poly: &[Pt]) -> f64 {
    poly.iter()
        .zip(poly.iter().cycle().skip(1))
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum()
}

fn contains(poly: &[Pt], p: Pt) -> bool {
    let mut inside = false;
    for (a, b) in poly.iter().zip(poly.iter().cycle().skip(1)) {
        if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
            inside = !inside;
        }
    }
    inside
}

/// libass fills with the nonzero rule. For even-odd fills, orient contours by
/// how deeply they're nested (outer one way, holes the other, islands in
/// holes the first way again), which makes nonzero give the even-odd result.
fn orient_even_odd(contours: Vec<Contour>) -> Vec<Contour> {
    let polygons: Vec<Vec<Pt>> = contours.iter().map(Contour::polygon).collect();
    contours
        .into_iter()
        .enumerate()
        .map(|(i, contour)| {
            let depth = polygons
                .iter()
                .enumerate()
                .filter(|&(j, other)| j != i && contains(other, contour.start))
                .count();
            let clockwise = signed_area(&polygons[i]) > 0.0;
            if clockwise == (depth % 2 == 0) {
                contour
            } else {
                contour.reversed()
            }
        })
        .collect()
}

#[derive(Default)]
struct Collector {
    parts: Vec<RawPart>,
    warnings: BTreeSet<String>,
    points: usize,
}

struct RawPart {
    color: Rgba,
    contours: Vec<Contour>,
}

impl Collector {
    /// Walks a group. Outside text, nodes carry absolute transforms
    /// (`in_text` is `None`). Inside a text's outlines they don't (they're in
    /// the text's own space), so `in_text` is the transform to apply to them.
    fn group(&mut self, group: &usvg::Group, opacity: f32, in_text: Option<usvg::Transform>) {
        if group.clip_path().is_some() || group.mask().is_some() {
            self.warn("Clip paths and masks were ignored.");
        }
        if !group.filters().is_empty() {
            self.warn("Filters (such as blur and drop shadows) were ignored.");
        }
        let opacity = opacity * group.opacity().get();
        for node in group.children() {
            match node {
                usvg::Node::Group(g) => {
                    let in_text = in_text.map(|t| t.pre_concat(g.transform()));
                    self.group(g, opacity, in_text);
                }
                usvg::Node::Path(p) => self.path(p, opacity, in_text.unwrap_or(p.abs_transform())),
                usvg::Node::Text(t) => {
                    let flattened = t.flattened();
                    let base = t.abs_transform().pre_concat(flattened.transform());
                    self.group(flattened, opacity, Some(base));
                }
                usvg::Node::Image(_) => self.warn("Embedded images were left out."),
            }
        }
    }

    fn path(&mut self, path: &usvg::Path, opacity: f32, transform: usvg::Transform) {
        if !path.is_visible() {
            return;
        }
        let Some(data) = path.data().clone().transform(transform) else {
            return;
        };
        let fill = path.fill().map(|fill| {
            let even_odd = fill.rule() == usvg::FillRule::EvenOdd;
            (
                fill.paint(),
                fill.opacity().get(),
                Some(data.clone()),
                even_odd,
            )
        });
        let stroke = path.stroke().map(|stroke| {
            // Stroke in the path's own space, so scaled strokes scale too.
            let outline = path
                .data()
                .stroke(&stroke.to_tiny_skia(), 1.0)
                .and_then(|o| o.transform(transform));
            (stroke.paint(), stroke.opacity().get(), outline, false)
        });
        let order = match path.paint_order() {
            usvg::PaintOrder::FillAndStroke => [fill, stroke],
            usvg::PaintOrder::StrokeAndFill => [stroke, fill],
        };
        for (paint, paint_opacity, outline, even_odd) in order.into_iter().flatten() {
            let Some(outline) = outline else { continue };
            // Invisible parts (such as a transparent background) would still
            // cast a shadow and get an outline.
            let Some(color) = self
                .color(paint, paint_opacity * opacity)
                .filter(|c| c.a > 0)
            else {
                continue;
            };
            // Fills of lines and other flat contours draw nothing.
            let mut contours: Vec<Contour> = contours(&outline)
                .into_iter()
                .filter(|c| signed_area(&c.polygon()).abs() > 1e-9)
                .collect();
            if even_odd {
                contours = orient_even_odd(contours);
            }
            self.points += contours.iter().map(|c| c.points().count()).sum::<usize>();
            if !contours.is_empty() {
                self.parts.push(RawPart { color, contours });
            }
        }
    }

    fn color(&mut self, paint: &usvg::Paint, opacity: f32) -> Option<Rgba> {
        let alpha = |a: f32| (a.clamp(0.0, 1.0) * 255.0).round() as u8;
        match paint {
            usvg::Paint::Color(c) => Some(Rgba {
                r: c.red,
                g: c.green,
                b: c.blue,
                a: alpha(opacity),
            }),
            usvg::Paint::LinearGradient(g) => Some(self.average(g.stops(), opacity)),
            usvg::Paint::RadialGradient(g) => Some(self.average(g.stops(), opacity)),
            usvg::Paint::Pattern(_) => {
                self.warn("Pattern fills were left out.");
                None
            }
        }
    }

    fn average(&mut self, stops: &[usvg::Stop], opacity: f32) -> Rgba {
        self.warn("Gradients were replaced by their average colour.");
        let n = stops.len().max(1) as f32;
        let mean = |f: fn(&usvg::Stop) -> f32| stops.iter().map(f).sum::<f32>() / n;
        Rgba {
            r: mean(|s| s.color().red as f32).round() as u8,
            g: mean(|s| s.color().green as f32).round() as u8,
            b: mean(|s| s.color().blue as f32).round() as u8,
            a: (mean(|s| s.opacity().get()) * opacity * 255.0).round() as u8,
        }
    }

    fn warn(&mut self, message: &str) {
        self.warnings.insert(message.to_owned());
    }
}

/// Splits a path into closed contours, with quadratic curves made cubic.
fn contours(path: &tiny_skia_path::Path) -> Vec<Contour> {
    let pt = |p: tiny_skia_path::Point| Pt {
        x: p.x as f64,
        y: p.y as f64,
    };
    let mut contours = Vec::new();
    let mut current: Option<Contour> = None;
    let mut last = Pt { x: 0.0, y: 0.0 };
    let finish = |c: Option<Contour>, contours: &mut Vec<Contour>| {
        if let Some(c) = c.filter(|c| !c.segments.is_empty()) {
            contours.push(c);
        }
    };
    for segment in path.segments() {
        match segment {
            PathSegment::MoveTo(p) => {
                finish(current.take(), &mut contours);
                last = pt(p);
                current = Some(Contour {
                    start: last,
                    segments: Vec::new(),
                });
            }
            PathSegment::LineTo(p) => {
                last = pt(p);
                if let Some(c) = current.as_mut() {
                    c.segments.push(Segment::Line(last));
                }
            }
            PathSegment::QuadTo(q, p) => {
                let (q, p) = (pt(q), pt(p));
                let c1 = Pt {
                    x: last.x + 2.0 / 3.0 * (q.x - last.x),
                    y: last.y + 2.0 / 3.0 * (q.y - last.y),
                };
                let c2 = Pt {
                    x: p.x + 2.0 / 3.0 * (q.x - p.x),
                    y: p.y + 2.0 / 3.0 * (q.y - p.y),
                };
                last = p;
                if let Some(c) = current.as_mut() {
                    c.segments.push(Segment::Cubic(c1, c2, p));
                }
            }
            PathSegment::CubicTo(a, b, p) => {
                last = pt(p);
                if let Some(c) = current.as_mut() {
                    c.segments.push(Segment::Cubic(pt(a), pt(b), last));
                }
            }
            // ASS closes every contour itself.
            PathSegment::Close => {}
        }
    }
    finish(current, &mut contours);
    contours
}

fn format_contours(contours: &[Contour], dx: f64, dy: f64) -> String {
    let p = |p: Pt| format!("{} {}", round(p.x + dx), round(p.y + dy));
    let mut out = Vec::new();
    for c in contours {
        out.push(format!("m {}", p(c.start)));
        let mut last = "m";
        for s in &c.segments {
            let (op, text) = match *s {
                Segment::Line(to) => ("l", p(to)),
                Segment::Cubic(a, b, to) => ("b", format!("{} {} {}", p(a), p(b), p(to))),
            };
            out.push(if op == last {
                text
            } else {
                format!("{op} {text}")
            });
            last = op;
        }
    }
    out.join(" ")
}

/// Two decimals, without negative zero.
fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0 + 0.0
}

#[derive(Clone, Copy)]
struct Bounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Bounds {
    const EMPTY: Bounds = Bounds {
        min_x: f64::INFINITY,
        min_y: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        max_y: f64::NEG_INFINITY,
    };

    fn add(self, p: Pt) -> Bounds {
        Bounds {
            min_x: self.min_x.min(p.x),
            min_y: self.min_y.min(p.y),
            max_x: self.max_x.max(p.x),
            max_y: self.max_y.max(p.y),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import(body: &str) -> ImportedSvg {
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">{body}</svg>"#
        );
        convert(&svg, "test.svg".into(), usvg::Options::default()).unwrap()
    }

    #[test]
    fn rectangles_become_normalized_parts() {
        let svg = import(r##"<rect x="10" y="20" width="30" height="10" fill="#ff0000"/>"##);
        assert_eq!((svg.width, svg.height), (30.0, 10.0));
        assert_eq!(svg.parts.len(), 1);
        assert_eq!(
            svg.parts[0].color,
            Rgba {
                r: 255,
                g: 0,
                b: 0,
                a: 255
            }
        );
        assert_eq!(svg.parts[0].path, "m 0 0 l 30 0 30 10 0 10");
        assert!(svg.warnings.is_empty());
    }

    #[test]
    fn applies_nested_transforms_and_opacity() {
        let svg = import(
            r##"<rect width="1" height="1" fill="#000"/>
            <g transform="translate(10 0)" opacity="0.5">
              <g transform="scale(2)"><rect width="5" height="5" fill="#00f" fill-opacity="0.5"/></g>
            </g>"##,
        );
        assert_eq!((svg.width, svg.height), (20.0, 10.0));
        assert_eq!(svg.parts[1].path, "m 10 0 l 20 0 20 10 10 10");
        assert_eq!(svg.parts[1].color.a, 64);
    }

    #[test]
    fn leaves_out_invisible_parts() {
        let svg = import(
            r##"<rect width="100" height="100" fill="transparent"/>
            <rect x="10" y="10" width="5" height="5" fill="#000" fill-opacity="0"/>
            <rect x="20" y="20" width="10" height="10" fill="#fff"/>"##,
        );
        assert_eq!(svg.parts.len(), 1);
        assert_eq!((svg.width, svg.height), (10.0, 10.0));
    }

    #[test]
    fn circles_become_curves() {
        let svg = import(r#"<circle cx="50" cy="50" r="10"/>"#);
        assert!(svg.parts[0].path.contains(" b "));
        assert_eq!((svg.width, svg.height), (20.0, 20.0));
    }

    #[test]
    fn strokes_become_outlines() {
        let svg =
            import(r##"<line x1="0" y1="5" x2="40" y2="5" stroke="#0f0" stroke-width="4"/>"##);
        assert_eq!(svg.parts.len(), 1);
        assert_eq!(svg.parts[0].color.g, 255);
        assert_eq!((svg.width, svg.height), (40.0, 4.0));
    }

    #[test]
    fn gradients_average_with_a_warning() {
        let svg = import(
            r##"<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/>
            <stop offset="1" stop-color="#fff"/></linearGradient></defs>
            <rect width="10" height="10" fill="url(#g)"/>"##,
        );
        assert_eq!(svg.parts[0].color.r, 128);
        assert_eq!(
            svg.warnings,
            ["Gradients were replaced by their average colour."]
        );
    }

    #[test]
    fn leaves_out_images() {
        let svg = import(
            r##"<rect width="10" height="10"/>
            <image href="C:/secret.png" width="10" height="10"/>
            <image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" width="10" height="10"/>"##,
        );
        assert_eq!(svg.parts.len(), 1);
        assert_eq!(svg.warnings, ["Embedded images were left out."]);
    }

    #[test]
    fn orients_even_odd_holes_for_nonzero_filling() {
        // Two squares drawn the same way round: a hole only with even-odd.
        let d = "M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z";
        for (rule, holes) in [("evenodd", true), ("nonzero", false)] {
            let svg = import(&format!(r#"<path d="{d}" fill-rule="{rule}"/>"#));
            let contours: Vec<&str> = svg.parts[0].path.split("m ").skip(1).collect();
            assert_eq!(contours.len(), 2);
            let area = |c: &str| {
                let n: Vec<f64> = c
                    .split_whitespace()
                    .filter_map(|t| t.parse().ok())
                    .collect();
                let pts: Vec<Pt> = n.chunks(2).map(|p| Pt { x: p[0], y: p[1] }).collect();
                signed_area(&pts)
            };
            let opposite = area(contours[0]).signum() != area(contours[1]).signum();
            assert_eq!(opposite, holes, "{rule}");
        }
    }

    #[test]
    fn reverses_curves_exactly() {
        let c = Contour {
            start: Pt { x: 0.0, y: 0.0 },
            segments: vec![
                Segment::Line(Pt { x: 10.0, y: 0.0 }),
                Segment::Cubic(
                    Pt { x: 12.0, y: 2.0 },
                    Pt { x: 12.0, y: 8.0 },
                    Pt { x: 10.0, y: 10.0 },
                ),
            ],
        };
        let r = c.reversed();
        assert_eq!(r.start, Pt { x: 10.0, y: 10.0 });
        assert_eq!(
            format_contours(&[r.reversed()], 0.0, 0.0),
            format_contours(&[c], 0.0, 0.0)
        );
    }

    #[test]
    fn rejects_drawings_that_are_too_detailed() {
        let points: String = (0..MAX_POINTS + 10)
            .map(|i| format!("{} {} ", i % 100, i / 100))
            .collect();
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="1000"><path d="M{points}Z"/></svg>"#
        );
        let err = convert(&svg, "big.svg".into(), usvg::Options::default()).unwrap_err();
        assert!(err.contains("too detailed"), "{err}");
    }

    #[test]
    fn rejects_svgs_without_shapes() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>"#;
        assert!(convert(svg, "empty.svg".into(), usvg::Options::default()).is_err());
    }

    #[test]
    fn finds_font_faces_with_data_urls() {
        let css = r#"<style>.a{fill:red} @font-face { font-family: "d2-1-font-bold";
            src: url("data:application/font-woff;base64,AAAA"); }
            @font-face{font-family:plain;src:url('data:font/ttf;base64,BBBB')}
            @font-face { font-family: web; src: url("https://example.com/x.woff"); }</style>"#;
        assert_eq!(
            font_faces(css),
            [
                (
                    "d2-1-font-bold".to_owned(),
                    "data:application/font-woff;base64,AAAA".to_owned()
                ),
                ("plain".to_owned(), "data:font/ttf;base64,BBBB".to_owned()),
            ]
        );
    }

    /// An SVG with Arial embedded as WOFF under the CSS name "embedded".
    fn with_embedded_font(body: &str) -> Option<String> {
        use base64::Engine;
        let woff = woff::tests::encode(&woff::tests::system_font()?);
        let data = base64::engine::general_purpose::STANDARD.encode(woff);
        Some(format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><style>
            @font-face {{ font-family: "embedded"; src: url("data:application/font-woff;base64,{data}"); }}
            </style>{body}</svg>"#
        ))
    }

    #[test]
    fn draws_text_with_embedded_fonts() {
        let Some(svg) = with_embedded_font(
            r#"<text x="10" y="50" font-family="embedded" font-size="20">So</text>"#,
        ) else {
            return;
        };
        // No installed fonts at all: the text can only use the embedded one.
        let imported = convert(&svg, "t.svg".into(), usvg::Options::default()).unwrap();
        assert_eq!(imported.parts.len(), 1);
        assert!(imported.parts[0].path.contains(" b "), "glyph outlines");
    }

    #[test]
    fn places_text_inside_nested_viewboxes() {
        // As diagram tools write it: an inner <svg> whose viewBox starts at
        // -14, so everything inside moves 14 units right and down.
        let Some(svg) = with_embedded_font(
            r#"<svg viewBox="-14 -14 100 100" width="100" height="100">
            <rect x="-14" y="-14" width="1" height="1"/>
            <text x="0" y="40" font-family="embedded" font-size="20">I</text></svg>"#,
        ) else {
            return;
        };
        let imported = convert(&svg, "t.svg".into(), usvg::Options::default()).unwrap();
        // The rect lands at (0, 0); the "I" starts just right of x = 14 and
        // sits on the baseline at y = 54.
        let n: Vec<f64> = imported.parts[1]
            .path
            .split_whitespace()
            .filter_map(|t| t.parse().ok())
            .collect();
        let xs = n.iter().step_by(2);
        let ys = n.iter().skip(1).step_by(2);
        let min_x = xs.cloned().fold(f64::INFINITY, f64::min);
        let max_y = ys.cloned().fold(f64::NEG_INFINITY, f64::max);
        assert!((14.0..18.0).contains(&min_x), "{min_x}");
        assert!((max_y - 54.0).abs() < 0.5, "{max_y}");
    }

    /// Renders an imported even-odd ring with real libass: set
    /// BROWNASS_TEST_FFMPEG (ffmpeg.exe) and run `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn even_odd_holes_stay_open_in_libass() {
        let ffmpeg = std::env::var("BROWNASS_TEST_FFMPEG").unwrap();
        let svg = import(
            r#"<path fill-rule="evenodd" fill="white" d="M0 0 H40 V40 H0 Z M10 10 H30 V30 H10 Z"/>"#,
        );
        let ass = format!(
            "[Script Info]\nScriptType: v4.00+\nPlayResX: 100\nPlayResY: 100\n\n\
             [V4+ Styles]\nFormat: Name, PrimaryColour, Outline, Shadow, Alignment\n\
             Style: S,&H00FFFFFF,0,0,7\n\n\
             [Events]\nFormat: Layer, Start, End, Style, Text\n\
             Dialogue: 0,0:00:00.00,0:00:05.00,S,{{\\an7\\pos(20,30)\\p1}}{}\n",
            svg.parts[0].path
        );
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("subs.ass"), ass).unwrap();
        let out = std::process::Command::new(ffmpeg)
            .current_dir(dir.path())
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=black:s=100x100:d=1",
            ])
            .args(["-vf", "ass=subs.ass", "-frames:v", "1"])
            .args(["-f", "rawvideo", "-pix_fmt", "gray", "-"])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let lit = |x: usize, y: usize| out.stdout[y * 100 + x] > 128;
        // The ring spans 20..60 × 30..70, with the hole at 30..50 × 40..60.
        assert!(lit(25, 35) && lit(55, 65), "ring");
        assert!(!lit(40, 50), "hole");
        assert!(!lit(15, 35) && !lit(25, 25), "outside");
    }
}
