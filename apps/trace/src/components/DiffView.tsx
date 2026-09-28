import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning } from "lucide-react";
import type { TraceReport } from "@trace/report-contract";
import type { FileDiff, DiffSide } from "../native-types";
import {
  alignDiff,
  splitLines,
  type DiffCell,
  type DiffRow,
} from "./diff-model";

type Evidence = TraceReport["evidence"][number];
const PAGE_SIZE = 250;

function SideStatus({ side, name }: { side: DiffSide; name: string }) {
  return (
    <div className="diff-unavailable">
      <FileWarning size={20} />
      <div>
        <strong>
          {name}: {side.kind}
        </strong>
        <p>
          {side.reason ||
            (side.kind === "absent"
              ? "This file does not exist in this snapshot."
              : "A text preview is unavailable for this object.")}
        </p>
        {side.blobOid ? <code>{side.blobOid}</code> : null}
      </div>
    </div>
  );
}

export function DiffView({
  diff,
  layout,
  evidence,
  onLine,
  constrainAnchorScroll = false,
}: {
  diff: FileDiff;
  layout: "split" | "unified";
  evidence?: Evidence;
  onLine: (side: "base" | "head", line: number) => void;
  constrainAnchorScroll?: boolean;
}) {
  const aligned = useMemo(
    () => alignDiff(diff.base.text ?? "", diff.head.text ?? ""),
    [diff.base.text, diff.head.text],
  );
  const [rawSide, setRawSide] = useState<"base" | "head">("head");
  const rows = useMemo<DiffRow[]>(
    () =>
      aligned ??
      splitLines(diff[rawSide].text ?? "").map((text, index) => ({
        left: rawSide === "base" ? { line: index + 1, text } : undefined,
        right: rawSide === "head" ? { line: index + 1, text } : undefined,
        changed: false,
      })),
    [aligned, diff, rawSide],
  );
  const [page, setPage] = useState(0);
  const selectedCell = useRef<HTMLDivElement>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (evidence) setRawSide(evidence.side);
  }, [evidence]);
  useEffect(() => {
    const index = evidence
      ? rows.findIndex(
          (row) =>
            (evidence.side === "base" ? row.left : row.right)?.line ===
            evidence.startLine,
        )
      : -1;
    setPage(index < 0 ? 0 : Math.floor(index / PAGE_SIZE));
  }, [evidence, rows]);
  useEffect(() => {
    if (!evidence) return;
    // The page dependency catches the commit that renders a distant anchor.
    // Manual paging never changes the page back: off-page anchors have no ref.
    if (
      constrainAnchorScroll &&
      selectedCell.current &&
      scrollContainer.current
    ) {
      const container = scrollContainer.current;
      const selectedBounds = selectedCell.current.getBoundingClientRect();
      const containerBounds = container.getBoundingClientRect();
      container.scrollTop +=
        selectedBounds.top -
        containerBounds.top -
        container.clientHeight / 2 +
        selectedBounds.height / 2;
      return;
    }
    selectedCell.current?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }, [evidence, rows, page, constrainAnchorScroll]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = rows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const textKinds = ["text", "absent"];
  const canCompare =
    textKinds.includes(diff.base.kind) && textKinds.includes(diff.head.kind);
  function cell(
    value: DiffCell | undefined,
    side: "base" | "head",
    changed: boolean,
    key: string,
  ) {
    if (!value)
      return (
        <div key={key} className="code-cell code-blank" aria-hidden="true" />
      );
    const selected =
      evidence?.side === side &&
      value.line >= evidence.startLine &&
      value.line <= evidence.endLine;
    return (
      <div
        key={key}
        ref={
          selected && value.line === evidence?.startLine
            ? selectedCell
            : undefined
        }
        className={`code-cell ${changed ? (side === "base" ? "code-deleted" : "code-added") : "code-context"} ${selected ? "code-selected" : ""}`}
      >
        <button
          className="line-number"
          onClick={() => onLine(side, value.line)}
          aria-label={`Inspect ${side} line ${value.line}`}
        >
          {value.line}
        </button>
        <span className="line-sign" aria-hidden="true">
          {changed ? (side === "base" ? "−" : "+") : " "}
        </span>
        <code>{value.text || " "}</code>
      </div>
    );
  }
  return (
    <section
      className={`diff-view diff-${layout}`}
      aria-label="Committed source diff"
    >
      <div className="diff-heading">
        <span>
          BASE <code>{diff.base.oid.slice(0, 8)}</code>
        </span>
        <span>
          HEAD <code>{diff.head.oid.slice(0, 8)}</code>
        </span>
      </div>
      {!canCompare ? (
        <div className="diff-statuses">
          <SideStatus side={diff.base} name="Base" />
          <SideStatus side={diff.head} name="Head" />
        </div>
      ) : (
        <>
          {!aligned ? (
            <div className="diff-limit">
              <strong>Comparison limit reached</strong>
              <p>
                These files differ too much to align quickly. Read each complete
                snapshot below.
              </p>
              <div className="segmented">
                <button
                  aria-pressed={rawSide === "base"}
                  onClick={() => setRawSide("base")}
                >
                  Base source
                </button>
                <button
                  aria-pressed={rawSide === "head"}
                  onClick={() => setRawSide("head")}
                >
                  Head source
                </button>
              </div>
            </div>
          ) : null}
          {diff.base.kind === "absent" || diff.head.kind === "absent" ? (
            <div className="hunk-label">
              {diff.base.kind === "absent"
                ? "Added file · no base content"
                : "Deleted file · no head content"}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <p className="empty-note">
              Both snapshots contain an empty text file.
            </p>
          ) : (
            <div
              ref={scrollContainer}
              className="diff-scroll"
              tabIndex={0}
              role="region"
              aria-label="Source code"
            >
              <div className="diff-rows">
                {shown.map((row, index) => (
                  <div
                    className="diff-row"
                    key={currentPage * PAGE_SIZE + index}
                  >
                    {!aligned ? (
                      <div className="raw-source-row">
                        {cell(
                          rawSide === "base" ? row.left : row.right,
                          rawSide,
                          false,
                          "raw",
                        )}
                      </div>
                    ) : layout === "split" ? (
                      <>
                        {cell(row.left, "base", row.changed, "l")}
                        {cell(row.right, "head", row.changed, "r")}
                      </>
                    ) : row.changed ? (
                      <>
                        {row.left ? cell(row.left, "base", true, "l") : null}
                        {row.right ? cell(row.right, "head", true, "r") : null}
                      </>
                    ) : (
                      cell(
                        evidence?.side === "base" ? row.left : row.right,
                        evidence?.side === "base" ? "base" : "head",
                        false,
                        "r",
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {pages > 1 ? (
            <div className="diff-paging">
              <span>
                Rows {currentPage * PAGE_SIZE + 1}–
                {Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of{" "}
                {rows.length.toLocaleString()}
              </span>
              <div className="row">
                <button
                  className="button small"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <button
                  className="button small"
                  disabled={currentPage === pages - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
