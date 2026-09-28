import { describe, expect, it } from "vitest";
import { alignDiff, splitLines } from "./diff-model";

describe("source diff alignment", () => {
  it.each([
    ["added file", "", "one\ntwo\n"],
    ["deleted file", "one\ntwo\n", ""],
    ["replacement", "before\nold\nkeep\n", "before\nnew\nextra\nkeep\n"],
    ["empty lines", "start\n\nend", "\nstart\n\n\nend\n"],
    ["newline-only change", "one", "one\n"],
  ])("preserves every source line and its side for %s", (_name, base, head) => {
    const rows = alignDiff(base, head);
    expect(rows).not.toBeNull();
    for (const [side, text] of [
      ["left", base],
      ["right", head],
    ] as const) {
      const cells = rows!.flatMap((row) => (row[side] ? [row[side]!] : []));
      expect(cells.map((cell) => cell.text)).toEqual(splitLines(text));
      expect(cells.map((cell) => cell.line)).toEqual(
        cells.map((_, index) => index + 1),
      );
    }
  });

  it("keeps different base and head coordinates after an insertion", () => {
    const rows = alignDiff(
      "first\nanchor\nlast\n",
      "first\ninserted\nanchor\nlast\n",
    )!;
    expect(rows.find((row) => row.left?.line === 2)).toEqual({
      left: { line: 2, text: "anchor" },
      right: { line: 3, text: "anchor" },
      changed: false,
    });
  });
});
