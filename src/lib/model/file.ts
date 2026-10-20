import * as v from "valibot";
import { PROJECT_VERSION, ProjectSchema, type Project } from "./project";

/**
 * Upgrades a project from version `n` to `n + 1`. Add an entry here (and bump
 * PROJECT_VERSION) whenever the schema changes; never edit existing entries.
 */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {};

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
