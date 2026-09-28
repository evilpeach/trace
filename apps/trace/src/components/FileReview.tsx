import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Globe,
  GitBranch,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { TraceReport } from "@trace/report-contract";
import { client } from "../bridge";
import type { Decision, FileDiff, LoadedReport } from "../native-types";
import { DiffView } from "./DiffView";
import { SeverityBadge } from "./SeverityBadge";
import { sortFindingsBySeverity } from "./finding-severity";

type ReportFile = TraceReport["files"][number];
type ContextFile = TraceReport["contextFiles"][number];
type Evidence = TraceReport["evidence"][number];
const cache = new Map<string, FileDiff>();

export function DecisionBadge({ value }: { value?: Decision }) {
  if (!value) return <span className="state-badge">Unreviewed</span>;
  if (value.stale)
    return (
      <span className="state-badge attention">
        Changed · was {value.decision.replaceAll("-", " ")}
      </span>
    );
  return (
    <span
      className={`state-badge ${value.decision === "needs-test" ? "attention" : "recorded"}`}
      data-decision={value.decision}
    >
      {value.decision === "needs-test" || value.decision === "confirmed" ? (
        <AlertCircle size={11} />
      ) : value.decision === "disputed" ? (
        <CircleHelp size={11} />
      ) : (
        <Check size={11} />
      )}
      {value.decision.replaceAll("-", " ")}
    </span>
  );
}

export function FileReview({
  loaded,
  file,
  layout,
  evidence,
  stacked,
  reviewRound,
  saving,
  onDecision,
  onFlow,
  onFinding,
  onSource,
  onUnanchoredLine,
}: {
  loaded: LoadedReport;
  file: ReportFile | ContextFile;
  layout: "split" | "unified";
  evidence?: Evidence;
  stacked: boolean;
  reviewRound?: TraceReport["rounds"][number];
  saving: boolean;
  onDecision: (id: string, decision: string | null) => void;
  onFlow: (id: string) => void;
  onFinding: (id: string) => void;
  onSource: (evidence: Evidence) => void;
  onUnanchoredLine: (
    fileId: string,
    side: "base" | "head",
    line: number,
  ) => void;
}) {
  const changed = "analysis" in file;
  const [contextExpanded, setContextExpanded] = useState(false);
  const contextId = useId();
  const contextRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (contextExpanded) contextRef.current?.scrollIntoView({ block: "start" });
  }, [contextExpanded]);
  const [collapsed, setCollapsed] = useState(stacked);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<"github" | "vscode" | null>(null);
  const [sourceFeedback, setSourceFeedback] = useState<{
    message: string;
    path: string | null;
  } | null>(null);
  const isCollapsed = stacked && collapsed && !evidence;
  const key = `${loaded.handle}:${loaded.digest}:${loaded.repository?.checkoutId ?? ""}:${file.id}`;
  useEffect(() => {
    if (isCollapsed) return;
    let active = true;
    const known = cache.get(key);
    setDiff(known ?? null);
    setError("");
    if (known) return;
    client
      .readDiff(loaded.handle, file.id)
      .then((result) => {
        if (cache.size >= 40) cache.delete(cache.keys().next().value!);
        cache.set(key, result);
        if (active) setDiff(result);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [key, loaded.handle, file.id, isCollapsed, attempt]);
  const decision = loaded.state.files[file.id];
  const relatedFlows = loaded.report.flows.filter((flow) =>
    flow.fileIds.includes(file.id),
  );
  const relatedFindings = sortFindingsBySeverity(
    loaded.report.findings.filter((finding) => {
      const ids = [
        finding.primaryEvidenceId,
        ...finding.trace.flatMap((step) => step.evidenceIds),
      ];
      return loaded.report.evidence.some(
        (anchor) => anchor.fileId === file.id && ids.includes(anchor.id),
      );
    }),
  );
  const sourceAnchor =
    evidence ??
    loaded.report.evidence.find(
      (anchor) => anchor.fileId === file.id && anchor.side === "head",
    ) ??
    loaded.report.evidence.find((anchor) => anchor.fileId === file.id);
  const sourceSide =
    evidence?.side ?? (changed && file.status === "deleted" ? "base" : "head");
  async function openFile(target: "github" | "vscode") {
    if (opening) return;
    setSourceFeedback(null);
    if (target === "vscode" && sourceAnchor) {
      onSource(sourceAnchor);
      return;
    }
    setOpening(target);
    try {
      const result = await client.openFileSource(
        loaded.handle,
        file.id,
        target,
        sourceSide,
      );
      setSourceFeedback({
        message: result.opened
          ? target === "github"
            ? "Opened this file’s committed snapshot on GitHub."
            : "Opened the matching local file in VS Code."
          : result.reason ||
            `This file could not be opened in ${target === "github" ? "GitHub" : "VS Code"}.`,
        path: result.opened ? null : result.path,
      });
    } catch (reason) {
      setSourceFeedback({
        message: reason instanceof Error ? reason.message : String(reason),
        path: null,
      });
    } finally {
      setOpening(null);
    }
  }
  return (
    <article
      className={`file-review ${stacked ? "stacked" : ""}`}
      aria-label={file.path}
    >
      <div
        className={`file-review-context ${isCollapsed ? "" : "is-sticky"}`}
        role={isCollapsed ? undefined : "region"}
        aria-label={isCollapsed ? undefined : "File review context"}
        tabIndex={isCollapsed ? undefined : 0}
      >
        <div className="file-review-header">
          <div className="file-heading">
            {stacked ? (
              <button
                className="icon-button"
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${file.path}`}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed(!collapsed)}
              >
                {isCollapsed ? (
                  <ChevronRight size={17} />
                ) : (
                  <ChevronDown size={17} />
                )}
              </button>
            ) : null}
            <div>
              <h2 title={file.path}>{file.path}</h2>
              <div className="file-meta">
                <span>
                  {changed
                    ? file.status.replaceAll("-", " ")
                    : "Unchanged supporting file"}
                </span>
                {changed && "previousPath" in file && file.previousPath ? (
                  <span>from {file.previousPath}</span>
                ) : null}
                {diff ? (
                  <span className="stats">
                    <b>+{diff.additions ?? "—"}</b>
                    <i>−{diff.deletions ?? "—"}</i>
                  </span>
                ) : null}
                {changed ? <DecisionBadge value={decision} /> : null}
              </div>
            </div>
          </div>
          <div className="row file-header-actions">
            <button
              className="button secondary small"
              disabled={opening !== null}
              title={`Open the ${sourceSide} snapshot (${loaded.report.comparison[sourceSide].oid.slice(0, 8)}) on GitHub`}
              onClick={() => openFile("github")}
            >
              <Globe size={14} />
              {opening === "github" ? "Opening…" : "GitHub"}
            </button>
            <button
              className="button secondary small"
              disabled={opening !== null}
              title={
                !sourceAnchor
                  ? "Open the matching local file at line 1"
                  : "Open the verified evidence location in your editor"
              }
              onClick={() => openFile("vscode")}
            >
              <ExternalLink size={13} />
              {opening === "vscode" ? "Opening…" : "VS Code"}
            </button>
            {changed ? (
              <button
                className={`button small ${decision?.decision === "reviewed" && !decision.stale ? "" : "primary"}`}
                disabled={saving}
                onClick={() =>
                  onDecision(
                    file.id,
                    decision?.decision === "reviewed" && !decision.stale
                      ? null
                      : "reviewed",
                  )
                }
              >
                <Check size={13} />
                {decision?.decision === "reviewed" && !decision.stale
                  ? "Reviewed"
                  : "Mark reviewed"}
              </button>
            ) : null}
          </div>
        </div>
        {!isCollapsed ? (
          <>
            <div className="file-summary-bar">
              <Sparkles size={15} aria-hidden="true" />
              <p
                title={changed ? (file.analysis.tldr ?? undefined) : undefined}
              >
                {changed
                  ? file.analysis.tldr || "File summary missing"
                  : "Unchanged supporting file · referenced by this report."}
              </p>
              <button
                className="file-context-toggle"
                aria-expanded={contextExpanded}
                aria-controls={contextId}
                onClick={() => setContextExpanded((value) => !value)}
              >
                Context
                <ChevronDown size={14} />
              </button>
            </div>
            {changed && file.analysis.status !== "complete" ? (
              <div className="analysis-gap">
                <AlertCircle size={13} />
                {file.analysis.reason ||
                  "This file has not been fully assessed."}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {!isCollapsed ? (
        <section
          className="file-context-expanded"
          id={contextId}
          ref={contextRef}
          hidden={!contextExpanded}
          aria-label="File explanation and review guidance"
        >
          <div className="file-context-columns">
            <div>
              <h3>The change</h3>
              <p>
                {changed
                  ? file.analysis.tldr || "File summary missing"
                  : "This file supports the explanation. It is unchanged between the recorded snapshots and is excluded from changed-file progress."}
              </p>
              {changed && file.analysis.why ? (
                <>
                  <h3>Why it matters</h3>
                  <p>{file.analysis.why}</p>
                </>
              ) : null}
              {changed && file.analysis.focus.length ? (
                <>
                  <h3>Review questions</h3>
                  <ul>
                    {file.analysis.focus.map((question, i) => (
                      <li key={i}>{question}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
            {reviewRound ? (
              <div>
                <h3>Review round · {reviewRound.title}</h3>
                <p>{reviewRound.why}</p>
                <h4>Exit when</h4>
                <ul>
                  {reviewRound.exitCriteria.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
                {reviewRound.questions.length ? (
                  <>
                    <h4>Questions to answer</h4>
                    <ul>
                      {reviewRound.questions.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {relatedFlows.length ? (
            <div className="linked-flows">
              <span>Part of</span>
              {relatedFlows.map((flow) => (
                <button key={flow.id} onClick={() => onFlow(flow.id)}>
                  <GitBranch size={13} />
                  {flow.title}
                  <ArrowUpRight size={12} />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {sourceFeedback ? (
        <div className="file-source-feedback" role="status">
          <p>{sourceFeedback.message}</p>
          {sourceFeedback.path ? (
            <label>
              Source location
              <input
                readOnly
                value={sourceFeedback.path}
                onFocus={(event) => event.target.select()}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {isCollapsed ? (
        <p className="collapsed-summary">
          {changed
            ? file.analysis.tldr || "File summary missing"
            : "Supporting source referenced by this report."}
        </p>
      ) : (
        <>
          {evidence ? (
            <div className="source-selection">
              <span className="pill">
                {evidence.side} · {evidence.startLine}–{evidence.endLine}
              </span>
              <p>{evidence.note}</p>
            </div>
          ) : null}
          {error ? (
            <div className="notice error">
              <AlertCircle size={17} />
              <div>
                <strong>Source could not be loaded</strong>
                <p>{error}</p>
                <button
                  className="button small"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  <RefreshCw size={13} />
                  Retry
                </button>
              </div>
            </div>
          ) : diff ? (
            <DiffView
              diff={diff}
              layout={layout}
              evidence={evidence}
              onLine={(side, line) => onUnanchoredLine(file.id, side, line)}
            />
          ) : (
            <div className="loading-panel">
              <span className="spinner" />
              Reading committed snapshots…
            </div>
          )}
          <div className="under-diff">
            <span>
              {loaded.report.provenance.mode === "synthetic-example"
                ? "Illustrative source · synthetic example"
                : "Source from fixed Git snapshots"}
            </span>
            <span>Line numbers inspect source anchors</span>
          </div>
          {relatedFindings.length ? (
            <div className="file-findings">
              {relatedFindings.map((finding) => (
                <button key={finding.id} onClick={() => onFinding(finding.id)}>
                  <SeverityBadge priority={finding.priority} />
                  <span>
                    <strong>{finding.title}</strong>
                    <small>{finding.assessment.replaceAll("-", " ")}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
