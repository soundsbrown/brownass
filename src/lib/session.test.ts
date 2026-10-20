import { beforeEach, describe, expect, it, vi } from "vitest";
import { addItem, editText } from "$lib/commands/items";
import { projectStore } from "$lib/commands/store.svelte";
import { createProject } from "$lib/model/defaults";
import { parseProjectFile, serializeProjectFile } from "$lib/model/file";
import type { VideoInfo } from "$lib/player/api";

const backend = vi.hoisted(() => ({
  responses: {} as Record<string, unknown>,
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    backend.calls.push({ cmd, args });
    const r = backend.responses[cmd];
    if (r instanceof Error) throw r.message;
    return typeof r === "function" ? r(args) : r;
  },
  convertFileSrc: (p: string) => `asset://${p}`,
}));

const { session } = await import("./session.svelte");

const video: VideoInfo = {
  path: "C:\\v\\clip.mp4",
  width: 1280,
  height: 720,
  fps: 25,
  duration: 60,
  videoCodec: "h264",
  audioCodec: "aac",
};

const saves = () => backend.calls.filter((c) => c.cmd === "save_project").map((c) => c.args);

function addSubtitle(id = "a") {
  projectStore.execute(
    addItem({ id, type: "text", start: 1, end: 2, layer: 0, text: "hi", styleName: "Default" }),
  );
}

async function openWith(loaded: unknown) {
  backend.responses.open_video = video;
  backend.responses.load_project = loaded;
  await session.open();
}

beforeEach(() => {
  backend.calls = [];
  backend.responses = {
    save_project: { projectPath: "C:\\v\\clip.bwass", ass: "written" },
  };
});

describe("session", () => {
  it("creates no files until the first edit", async () => {
    await openWith({ kind: "none" });
    await session.flush();
    expect(saves()).toEqual([]);

    addSubtitle();
    await session.flush();
    expect(saves()).toHaveLength(1);
    const { json, ass, overwriteAss } = saves()[0];
    expect(parseProjectFile(json as string).items).toHaveLength(1);
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,hi");
    expect(overwriteAss).toBe(false);
    expect(session.saveStatus).toBe("saved");
  });

  it("does not save again without changes", async () => {
    await openWith({ kind: "none" });
    addSubtitle();
    await session.flush();
    await session.flush();
    expect(saves()).toHaveLength(1);
  });

  it("loads an existing project and refreshes its video details", async () => {
    const stored = createProject({ ...video, path: "D:\\old\\clip.mp4", duration: 59 });
    stored.items.push({
      id: "x",
      type: "text",
      start: 3,
      end: 4,
      layer: 0,
      text: "old",
      styleName: "Default",
    });
    await openWith({
      kind: "project",
      json: serializeProjectFile(stored),
      path: "C:\\v\\clip.bwass",
      assChanged: false,
    });

    expect(projectStore.project?.items.map((i) => i.id)).toEqual(["x"]);
    expect(projectStore.project?.video.path).toBe(video.path);
    expect(projectStore.project?.video.duration).toBe(60);
    expect(session.prompt).toBeNull();
  });

  it("never overwrites a project file it could not load", async () => {
    await openWith({
      kind: "project",
      json: "{broken",
      path: "C:\\v\\clip.bwass",
      assChanged: false,
    });
    expect(session.prompt).toMatchObject({ kind: "message", tone: "error" });
    addSubtitle();
    await session.flush();
    expect(saves()).toEqual([]);
  });

  it("leaves an existing .ass alone when there is no project", async () => {
    await openWith({ kind: "ass", text: "[Script Info]", path: "C:\\v\\clip.ass" });
    expect(session.prompt).toMatchObject({ kind: "message", tone: "info" });
    addSubtitle();
    await session.flush();
    expect(saves()[0].ass).toBeNull();
  });

  describe("when the .ass was changed outside the app", () => {
    beforeEach(async () => {
      await openWith({ kind: "none" });
      backend.responses.save_project = { projectPath: "C:\\v\\clip.bwass", ass: "conflict" };
      addSubtitle();
      await session.flush();
      backend.responses.save_project = { projectPath: "C:\\v\\clip.bwass", ass: "written" };
    });

    it("asks", () => {
      expect(session.prompt).toEqual({ kind: "assConflict", file: "clip.ass" });
    });

    it("overwrites once when told to, then saves normally", async () => {
      session.resolveAssConflict(true);
      await session.flush();
      expect(saves().at(-1)).toMatchObject({ overwriteAss: true });
      projectStore.execute(editText("a", "changed"));
      await session.flush();
      expect(saves().at(-1)).toMatchObject({ overwriteAss: false });
      expect(session.prompt).toBeNull();
    });

    it("stops writing the .ass when told to leave it", async () => {
      session.resolveAssConflict(false);
      await session.flush();
      expect(saves().at(-1)?.ass).toBeNull();
    });
  });

  it("asks at load time if the .ass is newer than the project", async () => {
    const stored = serializeProjectFile(createProject(video));
    await openWith({ kind: "project", json: stored, path: "C:\\v\\clip.bwass", assChanged: true });
    expect(session.prompt).toEqual({ kind: "assConflict", file: "clip.ass" });
  });

  it("saves pending edits before switching videos", async () => {
    await openWith({ kind: "none" });
    addSubtitle();
    await openWith({ kind: "none" });
    expect(saves()).toHaveLength(1);
    const first = backend.calls.findIndex((c) => c.cmd === "save_project");
    const secondLoad = backend.calls.findLastIndex((c) => c.cmd === "load_project");
    expect(first).toBeLessThan(secondLoad);
  });

  it("reports save errors", async () => {
    await openWith({ kind: "none" });
    backend.responses.save_project = new Error("Could not save: disk full");
    addSubtitle();
    await session.flush();
    expect(session.saveStatus).toBe("error");
    expect(session.saveError).toContain("disk full");
  });
});
