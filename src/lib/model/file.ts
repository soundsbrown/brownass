import * as v from "valibot";
import { PROJECT_VERSION, ProjectSchema, type Project } from "./project";

/**
 * Upgrades a project from version `n` to `n + 1`. Add an entry here (and bump
 * PROJECT_VERSION) whenever the schema changes; never edit existing entries.
 */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // v2: style sizes move from playRes pixels to 1080-line reference pixels,
  // and styles gain blur and fade. (Self-contained on purpose: migrations
  // must not change when the current code does.)
  1: (old) => {
    const playRes = old.playRes as { x: number; y: number };
    const factor = Math.min(playRes.x, playRes.y) / 1080;
    const scaled = ["fontSize", "spacing", "outline", "shadow", "marginL", "marginR", "marginV"];
    const styles = Object.fromEntries(
      Object.entries(old.styles as Record<string, Record<string, number>>).map(([name, style]) => [
        name,
        {
          ...style,
          ...Object.fromEntries(scaled.map((k) => [k, style[k] / factor])),
          blur: 0,
          fadeIn: 0,
          fadeOut: 0,
        },
      ]),
    );
    return { ...old, styles };
  },
  // v3: shape items, styled by shape styles. Linking to the stylesheet fills
  // these in on open.
  2: (old) => ({ ...old, shapeStyles: {} }),
  // v4: stylesheet overlays (filled in on open) and a per-video switch.
  3: (old) => ({ ...old, overlays: [], hideOverlays: false }),
};

export class ProjectFileError extends Error {}

/** Parses, migrates and validates the contents of a `.bwass` file. */
export function parseProjectFile(json: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new ProjectFileError(`The project file is not valid JSON: ${(e as Error).message}`);
  }
  return validate(migrate(data));
}

export function serializeProjectFile(project: Project): string {
  return JSON.stringify(project, null, 2) + "\n";
}

function migrate(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("version" in data)) {
    throw new ProjectFileError("The project file has no version.");
  }
  let current = data as Record<string, unknown>;
  let version = current.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectFileError(`Unknown project file version: ${String(version)}`);
  }
  if (version > PROJECT_VERSION) {
    throw new ProjectFileError(
      `This project was saved by a newer version of BrownASS (file version ${version}).`,
    );
  }
  while (version < PROJECT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ProjectFileError(`No migration from project version ${version}.`);
    current = { ...step(current), version: version + 1 };
    version += 1;
  }
  return current;
}

function validate(data: unknown): Project {
  const result = v.safeParse(ProjectSchema, data);
  if (result.success) return result.output;
  const issue = result.issues[0];
  const path = v.getDotPath(issue);
  throw new ProjectFileError(`Invalid project file${path ? ` at ${path}` : ""}: ${issue.message}`);
}
