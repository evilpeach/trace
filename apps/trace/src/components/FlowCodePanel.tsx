import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Globe,
  RefreshCw,
} from "lucide-react";
import type { Evidence, GraphNode } from "@trace/report-contract";
import { client } from "../bridge";
import type { FileDiff, LoadedReport } from "../native-types";
import { DiffView } from "./DiffView";
import "./flow-code-panel.css";

const sourceCache = new Map<string, FileDiff>();

/** Keep both reading surfaces mounted: switching modes must not reset the
 * diagram viewport, diff page, or the reader's scroll position. The inactive
 * surface keeps its geometry so asynchronous evidence can still scroll to its
 * anchor before it becomes visible; inert removes it from keyboard navigation. */
export function FlowCodeWorkspace({
  mode,
  diagramId,
  codeId,
  children,
  inspector,
}: {
  mode: "diagram" | "code";
  diagramId: string;
  codeId: string;
  children: ReactNode;
  inspector: ReactNode;
}) {
  return (
    <div className="flow-code-workspace">
      <div
        id={diagramId}
        className={`flow-code-diagram ${mode !== "diagram" ? "flow-surface-inactive" : ""}`}
        role="region"
        aria-label="Journey diagram"
        aria-hidden={mode !== "diagram"}
        inert={mode !== "diagram"}
      >
        {children}
      </div>
      <section
        id={codeId}
        className={`flow-code-inspector ${mode !== "code" ? "flow-surface-inactive" : ""}`}
        aria-label="Journey code diff"
        aria-hidden={mode !== "code"}
        inert={mode !== "code"}
      >
        {inspector}
      </section>
    </div>
  );
}

function anchorPath(loaded: LoadedReport, anchor: Evidence) {
  const file = [...loaded.report.files, ...loaded.report.contextFiles].find(
    (item) => item.id === anchor.fileId,
  );
  return anchor.side === "base" &&
    file &&
    "previousPath" in file &&
    typeof file.previousPath === "string"
    ? file.previousPath
    : (file?.path ?? anchor.fileId);
}

/** Mount by snapshot/file identity so source feedback cannot cross reports. */
function AnchoredSource({
  loaded,
  anchor,
  anchors,
  onEvidence,
  onSource,
  onOpenFile,
  layout,
}: {
  loaded: LoadedReport;
  anchor: Evidence;
  layout: "unified" | "split";
  anchors: Evidence[];
  onEvidence: (id: string) => void;
  onSource?: (anchor: Evidence) => void;
  onOpenFile: (id: string) => void;
}) {
  const [result, setResult] = useState<{
    key: string;
    diff?: FileDiff;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [lineNotice, setLineNotice] = useState<{
    anchorId: string;
    text: string;
  } | null>(null);
  const alive = useRef(true);
  const diffKey = `${loaded.handle}:${loaded.digest}:${loaded.repository?.checkoutId ?? ""}:${anchor.fileId}`;
  const diff = result?.key === diffKey ? result.diff : undefined;
  const error = result?.key === diffKey ? result.error : undefined;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const known = sourceCache.get(diffKey);
    setResult(known ? { key: diffKey, diff: known } : null);
    if (known) return;
    client.readDiff(loaded.handle, anchor.fileId).then(
      (value) => {
        if (sourceCache.size >= 30)
          sourceCache.delete(sourceCache.keys().next().value!);
        sourceCache.set(diffKey, value);
        if (active) setResult({ key: diffKey, diff: value });
      },
      (reason) => {
        if (active)
          setResult({
            key: diffKey,
            error: reason instanceof Error ? reason.message : String(reason),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [loaded.handle, anchor.fileId, diffKey, attempt]);

  async function openSource(target: "github" | "vscode") {
    if (opening) return;
    if (target === "vscode" && onSource) {
      onSource(anchor);
      return;
    }
    setOpening(true);
    setFeedback("");
    try {
      const value =
        target === "vscode"
          ? await client.openSource(loaded.handle, anchor.id)
          : await client.openFileSource(
              loaded.handle,
              anchor.fileId,
              target,
              anchor.side,
            );
      if (alive.current)
        setFeedback(
          value.opened
            ? target === "github"
              ? "Opened this file’s committed snapshot on GitHub."
              : "Opened the verified source location in VS Code."
            : [value.reason || "This source could not be opened.", value.path]
                .filter(Boolean)
                .join(" "),
        );
    } catch (reason) {
      if (alive.current)
        setFeedback(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setOpening(false);
    }
  }

  return (
    <div className="flow-code-source">
      <div className="flow-code-source-heading">
        <code>
          {anchor.side === "base" ? "Base" : "Head"} lines {anchor.startLine}
          {anchor.endLine !== anchor.startLine ? `–${anchor.endLine}` : ""}
        </code>
        {anchor.note ? (
          <details className="flow-code-anchor-note">
            <summary>Evidence note</summary>
            <p>{anchor.note}</p>
          </details>
        ) : null}
        <div className="flow-code-actions">
          <button
            className="button small"
            disabled={opening}
            onClick={() => void openSource("github")}
            title="Open this committed file on GitHub"
          >
            <Globe size={14} />
            GitHub
          </button>
          <button
            className="button small"
            disabled={opening}
            onClick={() => void openSource("vscode")}
            title="Open the exact anchor in a verified local file"
          >
            <ExternalLink size={14} />
            VS Code
          </button>
          <button className="text-button" onClick={() => onOpenFile(anchor.id)}>
            Open in Files
            <ArrowUpRight size={13} />
          </button>
        </div>
        {feedback ? (
          <p className="flow-code-feedback" role="status">
            {feedback}
          </p>
        ) : null}
      </div>
      {error ? (
        <div className="flow-code-empty" role="status">
          <strong>Source could not be loaded</strong>
          <p>{error}</p>
          <button
            className="button small"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      ) : diff ? (
        <>
          <DiffView
            diff={diff}
            layout={layout}
            evidence={anchor}
            constrainAnchorScroll
            onLine={(side, line) => {
              const match = anchors.find(
                (item) =>
                  item.fileId === anchor.fileId &&
                  item.side === side &&
                  line >= item.startLine &&
                  line <= item.endLine,
              );
              if (match) {
                setLineNotice(null);
                onEvidence(match.id);
              } else
                setLineNotice({
                  anchorId: anchor.id,
                  text: `${side === "base" ? "Base" : "Head"} line ${line} is committed source; no anchor for this step references it.`,
                });
            }}
          />
          {lineNotice?.anchorId === anchor.id ? (
            <p className="flow-code-line-notice" role="status">
              {lineNotice.text}
            </p>
          ) : null}
        </>
      ) : (
        <div className="flow-code-empty" role="status">
          <Code2 size={22} />
          <p>Loading committed source…</p>
        </div>
      )}
    </div>
  );
}

export function FlowCodePanel({
  loaded,
  node,
  anchors,
  anchor,
  index,
  count,
  layout,
  onLayoutChange,
  onStep,
  onEvidence,
  onSource,
  onOpenFile,
  headingRef,
}: {
  loaded: LoadedReport;
  node: GraphNode;
  anchors: Evidence[];
  anchor?: Evidence;
  index: number;
  count: number;
  layout: "unified" | "split";
  onLayoutChange: (layout: "unified" | "split") => void;
  onStep: (index: number) => void;
  onEvidence: (id: string) => void;
  onSource?: (anchor: Evidence) => void;
  onOpenFile: (id: string) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const evidenceSelect = useId();
  return (
    <>
      <div className="flow-code-panel-heading">
        <div className="flow-code-step-title">
          <span className="eyebrow sage">
            STEP {index + 1} OF {count} · {node.kind}
          </span>
          <h3 ref={headingRef} tabIndex={-1}>
            {node.label}
          </h3>
        </div>
        <div className="flow-code-step-navigation">
          <button
            className="button small"
            disabled={index <= 0}
            onClick={() => onStep(index - 1)}
            aria-label="Previous journey step"
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <button
            className="button small"
            disabled={index >= count - 1}
            onClick={() => onStep(index + 1)}
            aria-label="Next journey step"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {anchor ? (
        <>
          <div className="flow-code-evidence-picker">
            <label htmlFor={evidenceSelect}>
              Source evidence <span className="muted">({anchors.length})</span>
            </label>
            <select
              id={evidenceSelect}
              value={anchor.id}
              onChange={(event) => onEvidence(event.target.value)}
            >
              {anchors.map((item, i) => (
                <option key={item.id} value={item.id}>
                  {i + 1}. {anchorPath(loaded, item)}:{item.startLine}
                </option>
              ))}
            </select>
            <div
              className="segmented"
              role="group"
              aria-label="Journey diff layout"
            >
              <button
                aria-pressed={layout === "unified"}
                onClick={() => onLayoutChange("unified")}
              >
                Unified
              </button>
              <button
                aria-pressed={layout === "split"}
                onClick={() => onLayoutChange("split")}
              >
                Split
              </button>
            </div>
          </div>
          <AnchoredSource
            key={`${loaded.handle}:${loaded.digest}:${loaded.repository?.checkoutId ?? ""}:${anchor.fileId}:${anchor.id}`}
            loaded={loaded}
            layout={layout}
            anchor={anchor}
            anchors={anchors}
            onEvidence={onEvidence}
            onSource={onSource}
            onOpenFile={onOpenFile}
          />
        </>
      ) : (
        <div className="flow-code-empty">
          <Code2 size={25} />
          <strong>
            {node.kind === "entry"
              ? "The journey starts here"
              : "No source anchor for this step"}
          </strong>
          <p>
            {node.kind === "entry" && !node.evidenceIds.length
              ? "This step describes the user’s trigger. Continue to the next step to inspect the implementation."
              : "The report does not provide source evidence for this step at the selected revision."}
          </p>
        </div>
      )}
    </>
  );
}
