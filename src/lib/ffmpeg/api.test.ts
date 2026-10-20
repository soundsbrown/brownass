import { describe, expect, it } from "vitest";
import { toFfmpegError } from "./api";

describe("toFfmpegError", () => {
  it("passes through errors from the backend", () => {
    const err = { kind: "noLibass", message: "no libass" };
    expect(toFfmpegError(err)).toEqual(err);
  });

  it("wraps anything else as a generic failure", () => {
    expect(toFfmpegError("command not found")).toEqual({
      kind: "failed",
      message: "command not found",
    });
  });
});
