import { diffLines } from "diff";

export type DiffCell = { line: number; text: string };
export type DiffRow = { left?: DiffCell; right?: DiffCell; changed: boolean };
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Pair adjacent deletions/additions, retaining actual line numbers on each side.
 * Hard time/edit limits prevent adversarial or unrelated blobs blocking the UI. */
export function alignDiff(base: string, head: string): DiffRow[] | null {
  const chunks = diffLines(base, head, { timeout: 400, maxEditLength: 5000 });
  if (!chunks) return null;
  const rows: DiffRow[] = [];
  let leftLine = 1;
  let rightLine = 1;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const lines = splitLines(chunk.value);
    if (!chunk.added && !chunk.removed) {
      for (const text of lines)
        rows.push({
          left: { line: leftLine++, text },
          right: { line: rightLine++, text },
          changed: false,
        });
    } else if (chunk.removed) {
      const added = chunks[index + 1]?.added
        ? splitLines(chunks[++index].value)
        : [];
      for (let row = 0; row < Math.max(lines.length, added.length); row++)
        rows.push({
          left:
            row < lines.length
              ? { line: leftLine++, text: lines[row] }
              : undefined,
          right:
            row < added.length
              ? { line: rightLine++, text: added[row] }
              : undefined,
          changed: true,
        });
    } else
      for (const text of lines)
        rows.push({ right: { line: rightLine++, text }, changed: true });
  }
  return rows;
}
