import { describe, expect, it } from "vitest";
import { wrapInTag } from "./format";

describe("wrapInTag", () => {
  it("wraps the selection and keeps it selected", () => {
    const edit = wrapInTag("one two three", 4, 7, "i");
    expect(edit.text).toBe("one {\\i1}two{\\i0} three");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("two");
  });

  it("puts the caret between the tags without a selection", () => {
    const edit = wrapInTag("ab", 1, 1, "b");
    expect(edit.text).toBe("a{\\b1}{\\b0}b");
    expect(edit.selectionStart).toBe(edit.selectionEnd);
    expect(edit.text.slice(0, edit.selectionStart)).toBe("a{\\b1}");
  });

  it("handles a backwards selection", () => {
    expect(wrapInTag("abc", 3, 1, "u").text).toBe("a{\\u1}bc{\\u0}");
  });
});
