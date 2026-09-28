import { useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clipboard,
  ExternalLink,
  Flag,
  GitBranch,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import type { TraceReport } from "@trace/report-contract";
import type { LoadedReport } from "../native-types";
import { DecisionBadge } from "./FileReview";
import { FlowGraph } from "./LazyFlowGraph";
import { SafeMarkdown } from "./SafeMarkdown";
import { SeverityBadge } from "./SeverityBadge";
import { SEVERITIES, sortFindingsBySeverity } from "./finding-severity";
import { FlowCodePanel, FlowCodeWorkspace } from "./FlowCodePanel";
import {
  nodeForEvidence,
  resolveFlowSelection,
  type FlowSelection,
} from "./flow-selection";

type Evidence = TraceReport["evidence"][number];
const assessmentLabels = {
  supported: "Supported by report",
  "needs-verification": "Needs verification",
  refuted: "Refuted hypothesis",
};
export function evidencePath(report: TraceReport, anchor: Evidence) {
  const file = [...report.files, ...report.contextFiles].find(
    (item) => item.id === anchor.fileId,
  );
  const changed = report.files.find((item) => item.id === anchor.fileId);
  return anchor.side === "base" && changed?.previousPath
    ? changed.previousPath
    : (file?.path ?? anchor.fileId);
}
export function EvidenceLink({
  report,
  anchor,
  onEvidence,
}: {
  report: TraceReport;
  anchor: Evidence;
  onEvidence: (id: string) => void;
}) {
  return (
    <button className="evidence-link" onClick={() => onEvidence(anchor.id)}>
      <span>
        <strong>{anchor.note}</strong>
        <code>
          {evidencePath(report, anchor)}:{anchor.startLine}
          {anchor.endLine !== anchor.startLine ? `–${anchor.endLine}` : ""}
        </code>
      </span>
      <span className="pill">{anchor.side}</span>
      <ArrowUpRight size={15} />
    </button>
  );
}

function MainJourney({
  report,
  onFlow,
  onEvidence,
}: {
  report: TraceReport;
  onFlow: (id: string) => void;
  onEvidence?: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState<"before" | "after">("after");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const flow =
    report.flows.find((item) => item.id === selectedId) ?? report.flows[0];
  if (!flow)
    return (
      <section className="main-journey journey-unavailable">
        <div className="journey-heading">
          <span className="eyebrow sage">MAIN JOURNEY</span>
          <h2>The end-to-end story is not available yet.</h2>
        </div>
        <p>
          {report.coverage.flowAnalysis === "not-assessed"
            ? "The report has not assessed behavioral flows. File explanations and findings remain available below."
            : "No user journey was authored for this comparison."}
        </p>
        <p className="journey-coverage">{report.coverage.note}</p>
      </section>
    );
  const snapshot = flow[revision];
  const graph = snapshot.graph;
  const node =
    graph?.nodes.find((item) => item.id === selectedNodeId) ?? graph?.nodes[0];
  const openAnchor = (id: string) =>
    onEvidence ? onEvidence(id) : onFlow(flow.id);
  const changedCount = flow.fileIds.filter((id) =>
    report.files.some((file) => file.id === id),
  ).length;
  const contextCount = flow.fileIds.length - changedCount;
  return (
    <section className="main-journey" aria-label="Main user journey">
      <div className="journey-heading-row">
        <div className="journey-heading">
          <span className="eyebrow sage">
            <GitBranch size={16} />
            MAIN JOURNEY · START HERE
          </span>
          <h2>{flow.title}</h2>
        </div>
        <button className="button secondary" onClick={() => onFlow(flow.id)}>
          Explore this journey
          <ArrowRight size={15} />
        </button>
      </div>
      <p className="journey-tldr">{flow.tldr}</p>
      <div className="journey-boundaries">
        <div>
          <span>Who</span>
          <strong>{flow.actor}</strong>
        </div>
        <div>
          <span>Starts when</span>
          <strong>{flow.trigger}</strong>
        </div>
        <div>
          <span>Intended result</span>
          <strong>{flow.outcome}</strong>
        </div>
      </div>
      <div className="journey-toolbar">
        {report.flows.length > 1 ? (
          <label className="journey-selector">
            Journey
            <select
              value={flow.id}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setSelectedNodeId(null);
              }}
            >
              {report.flows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="journey-file-count">
            {changedCount} changed {changedCount === 1 ? "file" : "files"}
            {contextCount
              ? ` · ${contextCount} supporting ${contextCount === 1 ? "file" : "files"}`
              : ""}
          </span>
        )}
        <div className="segmented" aria-label="Main journey revision">
          <button
            aria-pressed={revision === "before"}
            onClick={() => {
              setRevision("before");
              setSelectedNodeId(null);
            }}
          >
            Before
          </button>
          <button
            aria-pressed={revision === "after"}
            onClick={() => {
              setRevision("after");
              setSelectedNodeId(null);
            }}
          >
            After
          </button>
        </div>
      </div>
      {graph ? (
        <FlowGraph
          graph={graph}
          selected={node?.id ?? null}
          onSelect={setSelectedNodeId}
          onEvidence={openAnchor}
        />
      ) : (
        <div className="journey-missing-snapshot">
          <strong>
            {snapshot.status === "not-applicable"
              ? "This journey did not apply at this revision."
              : "This revision’s journey is unavailable."}
          </strong>
          <p>{snapshot.reason}</p>
        </div>
      )}
      {node ? (
        <div className="journey-step-evidence">
          <div>
            <span className="eyebrow sage">SELECTED STEP</span>
            <h3>{node.label}</h3>
            <p>
              {node.evidenceIds.length
                ? "Inspect the source behind this part of the journey."
                : "This is the user’s starting action; no source anchor is attached."}
            </p>
          </div>
          <div>
            {node.evidenceIds.map((id) => {
              const anchor = report.evidence.find((item) => item.id === id);
              return anchor ? (
                <EvidenceLink
                  key={id}
                  report={report}
                  anchor={anchor}
                  onEvidence={openAnchor}
                />
              ) : null;
            })}
          </div>
        </div>
      ) : null}
      <p className="journey-coverage">
        This is an authored journey from the report. Flow analysis:{" "}
        <strong>{report.coverage.flowAnalysis.replaceAll("-", " ")}</strong>.{" "}
        {report.coverage.note}
      </p>
    </section>
  );
}

export function Overview({
  loaded,
  onFlow,
  onFinding,
  onFiles,
  onPrimer,
  onEvidence,
}: {
  loaded: LoadedReport;
  onFlow: (id: string) => void;
  onFinding: (id: string) => void;
  onFiles: () => void;
  onPrimer: () => void;
  onEvidence?: (id: string) => void;
}) {
  const report = loaded.report;
  const supported = sortFindingsBySeverity(
    report.findings.filter((f) => f.assessment === "supported"),
  );
  const reviewed = report.files.filter(
    (f) =>
      loaded.state.files[f.id]?.decision === "reviewed" &&
      !loaded.state.files[f.id].stale,
  ).length;
  const explained = report.files.filter(
    (f) => f.analysis.status === "complete",
  ).length;
  const outcome = {
    "changes-requested": "Changes requested",
    "no-blockers-found": "No blockers found",
    incomplete: "Review incomplete",
  }[report.summary.outcome];
  return (
    <div className="overview page-scroll">
      <section className="overview-hero">
        <div>
          <div className="eyebrow accent">THE REVIEW AT A GLANCE</div>
          <h2>{report.summary.tldr}</h2>
          <SafeMarkdown>{report.summary.bodyMarkdown}</SafeMarkdown>
          <button className="button primary" onClick={onFiles}>
            Explore the changed files
            <ArrowRight size={15} />
          </button>
        </div>
        <aside className="verdict" data-outcome={report.summary.outcome}>
          <span className="eyebrow">AGENT ASSESSMENT</span>
          {report.summary.outcome === "no-blockers-found" ? (
            <Check size={23} />
          ) : report.summary.outcome === "incomplete" ? (
            <AlertCircle size={23} />
          ) : (
            <Flag size={23} />
          )}
          <h3>{outcome}</h3>
          <p>
            {supported.length
              ? `${supported.length} supported ${supported.length === 1 ? "finding" : "findings"} to investigate.`
              : "No supported findings in this report."}{" "}
            Coverage, verification, and your judgment remain separate.
          </p>
          <span className="pill">{report.provenance.generator}</span>
        </aside>
      </section>
      <MainJourney report={report} onFlow={onFlow} onEvidence={onEvidence} />
      <div className="metrics">
        <div>
          <strong>{String(report.files.length).padStart(2, "0")}</strong>
          <span>changed files · {report.coverage.inventory} inventory</span>
        </div>
        <div>
          <strong>
            {explained}
            <small>/{report.files.length}</small>
          </strong>
          <span>complete file explanations</span>
        </div>
        <div>
          <strong>{String(report.flows.length).padStart(2, "0")}</strong>
          <span>
            flows · {report.coverage.flowAnalysis.replaceAll("-", " ")}
          </span>
        </div>
        <div>
          <strong>
            {reviewed}
            <small>/{report.files.length}</small>
          </strong>
          <span>files reviewed by you</span>
        </div>
      </div>
      <p className="coverage-note">{report.coverage.note}</p>
      <div className="overview-columns">
        <section>
          <h3 className="section-heading">
            <GitBranch size={16} />
            The stories behind the change
          </h3>
          {report.flows.length ? (
            report.flows.map((flow, index) => (
              <button
                className="story-row"
                key={flow.id}
                onClick={() => onFlow(flow.id)}
              >
                <span className="story-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{flow.title}</strong>
                  <p>{flow.tldr}</p>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <p className="empty-note">
              {report.coverage.flowAnalysis === "not-assessed"
                ? "Flow analysis has not been performed."
                : "No flows are authored in this report."}
            </p>
          )}
        </section>
        <section>
          <h3 className="section-heading">
            <Flag size={16} />
            Where to look closely
          </h3>
          {supported.length ? (
            supported.map((finding) => (
              <button
                className="story-row"
                key={finding.id}
                onClick={() => onFinding(finding.id)}
              >
                <SeverityBadge priority={finding.priority} />
                <span>
                  <strong>{finding.title}</strong>
                  <p>{finding.tldr}</p>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <div className="no-findings">
              <Check size={20} />
              <strong>No supported findings</strong>
              <p>
                A quiet findings list does not replace human review of the
                change.
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="overview-columns bottom-sections">
        <section>
          <h3 className="section-heading">
            <Check size={16} />
            What was actually checked
          </h3>
          {report.provenance.checks.length ? (
            report.provenance.checks.map((check, i) => (
              <div className="check-row" key={i}>
                <span
                  className={`pill ${check.status === "passed" ? "success" : check.status === "failed" ? "danger" : ""}`}
                >
                  {check.status.replaceAll("-", " ")}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-note">No validation checks were recorded.</p>
          )}
        </section>
        <section>
          <h3 className="section-heading">
            <BookOpen size={16} />
            Context and limitations
          </h3>
          {report.provenance.limitations.length ? (
            <ul className="plain-list">
              {report.provenance.limitations.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">
              No limitations were recorded by the author.
            </p>
          )}
          {report.domainPrimer?.length || report.valueDerivations?.length ? (
            <button className="button quiet" onClick={onPrimer}>
              Read the project primer
              <ArrowRight size={14} />
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export function FlowsView({
  loaded,
  selectedId,
  saving,
  onSelect,
  onEvidence,
  onFinding,
  onDecision,
  selection,
  onSelectionChange,
  onSource,
}: {
  loaded: LoadedReport;
  selectedId: string;
  saving: boolean;
  onSelect: (id: string) => void;
  onEvidence: (id: string) => void;
  onFinding: (id: string) => void;
  onDecision: (id: string, value: string | null) => void;
  selection?: FlowSelection;
  onSelectionChange?: (selection: FlowSelection) => void;
  onSource?: (anchor: Evidence) => void;
}) {
  const [localSelection, setLocalSelection] = useState<FlowSelection>({
    revision: "after",
    nodeId: null,
    evidenceId: null,
  });
  const [inspectorOpen, setInspectorOpen] = useState(
    Boolean(selection?.nodeId),
  );
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const activeSelection = selection ?? localSelection;
  const { revision } = activeSelection;
  function changeSelection(next: FlowSelection) {
    setLocalSelection(next);
    onSelectionChange?.(next);
  }
  const report = loaded.report;
  const flow =
    report.flows.find((item) => item.id === selectedId) ?? report.flows[0];
  if (!flow)
    return (
      <div className="view-empty">
        <GitBranch size={32} />
        <h2>No flow stories yet</h2>
        <p>
          {report.coverage.flowAnalysis === "not-assessed"
            ? "The author has not assessed behavioral flows."
            : "This report contains no authored flow graphs."}
        </p>
        <p>{report.coverage.note}</p>
      </div>
    );
  const snapshot = flow[revision];
  const graph = snapshot.graph;
  const { node, anchors, anchor } = graph
    ? resolveFlowSelection(graph, report.evidence, activeSelection)
    : { node: undefined, anchors: [], anchor: undefined };
  function selectNode(id: string) {
    if (!graph) return;
    const next = resolveFlowSelection(graph, report.evidence, {
      revision,
      nodeId: id,
      evidenceId: null,
    });
    changeSelection({
      revision,
      nodeId: next.node?.id ?? null,
      evidenceId: next.anchor?.id ?? null,
    });
    setInspectorOpen(true);
  }
  function selectEvidence(id: string) {
    if (!graph) return;
    const evidence = report.evidence.find((item) => item.id === id);
    if (
      !evidence ||
      evidence.side !== (revision === "before" ? "base" : "head")
    )
      return;
    const owner =
      node && anchors.some((item) => item.id === id)
        ? node.id
        : nodeForEvidence(graph, id);
    if (!owner) return;
    changeSelection({ revision, nodeId: owner, evidenceId: id });
    setInspectorOpen(true);
  }
  const decision = loaded.state.flows[flow.id];
  const relatedFindings = sortFindingsBySeverity(
    report.findings.filter((item) => item.flowIds.includes(flow.id)),
  );
  return (
    <div className="flows-view page-scroll">
      <div className="section-intro">
        <div>
          <h2>Follow the behavior across files.</h2>
          <p>Select a step to read its code alongside the journey.</p>
        </div>
        <div className="row">
          <DecisionBadge value={decision} />
          <button
            className="button small"
            disabled={saving}
            onClick={() =>
              onDecision(
                flow.id,
                decision?.decision === "reviewed" && !decision.stale
                  ? null
                  : "reviewed",
              )
            }
          >
            <Check size={14} />
            {decision?.decision === "reviewed" && !decision.stale
              ? "Unmark flow"
              : "Mark flow reviewed"}
          </button>
        </div>
      </div>
      <div className="flow-tabs">
        {report.flows.map((item, index) => (
          <button
            className={flow.id === item.id ? "selected" : ""}
            key={item.id}
            onClick={() => {
              onSelect(item.id);
              changeSelection({ revision, nodeId: null, evidenceId: null });
            }}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.title}
          </button>
        ))}
      </div>
      <div className="flow-summary">
        <div className="eyebrow sage">
          <Sparkles size={13} />
          FLOW TLDR{" "}
          <span className="pill">{flow.fileIds.length} source files</span>
        </div>
        <h3>{flow.tldr}</h3>
        <p>{flow.whyChanged}</p>
        <div className="flow-context">
          <span>
            <strong>Actor</strong>
            {flow.actor}
          </span>
          <span>
            <strong>Trigger</strong>
            {flow.trigger}
          </span>
          <span>
            <strong>Intended outcome</strong>
            {flow.outcome}
          </span>
        </div>
      </div>
      <div className="graph-toolbar">
        <div className="row">
          <GitBranch size={15} />
          <span>
            {revision === "before" ? "BASE" : "HEAD"}{" "}
            <code>
              {report.comparison[
                revision === "before" ? "base" : "head"
              ].oid.slice(0, 8)}
            </code>
          </span>
          <span className="muted">Authored behavior</span>
        </div>
        <div className="row">
          {node ? (
            <button
              ref={inspectorToggle}
              className="button small flow-inspector-toggle"
              aria-expanded={inspectorOpen}
              onClick={() => {
                setInspectorOpen((value) => !value);
                if (!inspectorOpen)
                  requestAnimationFrame(() =>
                    inspectorHeading.current?.focus(),
                  );
              }}
            >
              <PanelRightOpen size={14} />
              {inspectorOpen ? "Hide code" : "Show code"}
            </button>
          ) : null}
          <div className="segmented">
            <button
              aria-pressed={revision === "before"}
              onClick={() => {
                changeSelection({
                  revision: "before",
                  nodeId: null,
                  evidenceId: null,
                });
              }}
            >
              Before
            </button>
            <button
              aria-pressed={revision === "after"}
              onClick={() => {
                changeSelection({
                  revision: "after",
                  nodeId: null,
                  evidenceId: null,
                });
              }}
            >
              After
            </button>
          </div>
        </div>
      </div>
      {graph ? (
        <FlowCodeWorkspace
          open={inspectorOpen && Boolean(node)}
          inspector={
            node ? (
              <FlowCodePanel
                loaded={loaded}
                node={node}
                anchors={anchors}
                anchor={anchor}
                index={graph.nodes.findIndex((item) => item.id === node.id)}
                count={graph.nodes.length}
                revision={revision}
                onStep={(index) => {
                  const step = graph.nodes[index];
                  if (step) selectNode(step.id);
                }}
                onEvidence={selectEvidence}
                onSource={onSource}
                onOpenFile={onEvidence}
                onClose={() => {
                  setInspectorOpen(false);
                  inspectorToggle.current?.focus();
                }}
                headingRef={inspectorHeading}
              />
            ) : null
          }
        >
          <FlowGraph
            graph={graph}
            selected={node?.id ?? null}
            onSelect={selectNode}
            onEvidence={selectEvidence}
            layoutKey={inspectorOpen ? "with-code" : "diagram-only"}
          />
        </FlowCodeWorkspace>
      ) : (
        <div className="view-empty compact">
          <GitBranch size={24} />
          <h3>
            {snapshot.status === "not-applicable"
              ? "This flow did not apply at this revision"
              : "This snapshot is unavailable"}
          </h3>
          <p>{snapshot.reason}</p>
        </div>
      )}
      {relatedFindings.length ? (
        <section className="related-findings">
          <h3 className="section-heading">
            <Flag size={15} />
            Findings in this flow
          </h3>
          {relatedFindings.map((finding) => (
            <button
              className="story-row"
              key={finding.id}
              onClick={() => onFinding(finding.id)}
            >
              <SeverityBadge priority={finding.priority} />
              <span>
                <strong>{finding.title}</strong>
                <p>{assessmentLabels[finding.assessment]}</p>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function FindingsView({
  loaded,
  selectedId,
  saving,
  onSelect,
  onEvidence,
  onSource,
  onDecision,
  onCopy,
}: {
  loaded: LoadedReport;
  selectedId: string;
  saving: boolean;
  onSelect: (id: string) => void;
  onEvidence: (id: string) => void;
  onSource: (anchor: Evidence) => void;
  onDecision: (id: string, decision: string | null) => void;
  onCopy: (text: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const report = loaded.report;
  const ranked = sortFindingsBySeverity(report.findings);
  const finding =
    report.findings.find((item) => item.id === selectedId) ?? ranked[0];
  if (!finding)
    return (
      <div className="view-empty">
        <Check size={34} />
        <span className="pill success">No findings</span>
        <h2>No findings were reported.</h2>
        <p>
          File summaries, flow coverage, and validation evidence are still
          available. This is the author’s report, not an automatic approval.
        </p>
      </div>
    );
  const anchor = report.evidence.find(
    (item) => item.id === finding.primaryEvidenceId,
  )!;
  const decision = loaded.state.findings[finding.id];
  const visible = ranked.filter(
    (item) =>
      filter === "all" ||
      (filter === "attention"
        ? !loaded.state.findings[item.id] ||
          loaded.state.findings[item.id].stale ||
          loaded.state.findings[item.id].decision === "needs-test"
        : item.assessment === filter),
  );
  const copyComment = () =>
    onCopy(
      `**[${finding.priority ?? "Unclassified"} · ${finding.id}] ${finding.title}**\n\n\`${evidencePath(report, anchor)}:${anchor.startLine}\` (${anchor.side} ${report.comparison[anchor.side].oid})\n\n${finding.tldr}\n\n${finding.blocks.map((block) => `### ${block.label}\n${block.tldr}\n\n${block.bodyMarkdown}`).join("\n\n")}${finding.proposedFix ? `\n\n**Suggested change:** ${finding.proposedFix.summary}` : ""}`,
    );
  return (
    <div className="findings-layout">
      <aside className="finding-sidebar">
        <div className="explorer-label">
          FINDINGS BY SEVERITY <span>{report.findings.length}</span>
        </div>
        <select
          className="filter-select"
          aria-label="Filter findings"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All findings</option>
          <option value="attention">Needs your attention</option>
          <option value="supported">Supported by report</option>
          <option value="needs-verification">Needs verification</option>
          <option value="refuted">Refuted hypotheses</option>
        </select>
        {visible.map((item) => (
          <button
            className={`finding-nav ${item.id === finding.id ? "active" : ""}`}
            key={item.id}
            onClick={() => onSelect(item.id)}
          >
            <div className="row">
              <SeverityBadge priority={item.priority} />
              <small>{item.id}</small>
            </div>
            <strong>{item.title}</strong>
            <DecisionBadge value={loaded.state.findings[item.id]} />
          </button>
        ))}
        {!visible.length ? (
          <p className="empty-note">No findings match this filter.</p>
        ) : null}
        <details className="severity-legend">
          <summary>What do P0–P3 mean?</summary>
          <p>
            These codes describe severity and urgency. They are not steps in the
            review.
          </p>
          <ul>
            {Object.entries(SEVERITIES).map(([code, definition]) => (
              <li key={code}>
                <strong>
                  {code} · {definition.label}
                </strong>
                <span>{definition.urgency}</span>
              </li>
            ))}
          </ul>
        </details>
      </aside>
      <article className="finding-main">
        <div className="finding-topbar">
          <div className="row">
            <SeverityBadge priority={finding.priority} />
            <span className="pill" data-assessment={finding.assessment}>
              {assessmentLabels[finding.assessment]}
            </span>
            {finding.category ? (
              <span className="muted">{finding.category}</span>
            ) : null}
          </div>
          <button className="button small" onClick={copyComment}>
            <Clipboard size={13} />
            Copy comment
          </button>
        </div>
        <h2>{finding.title}</h2>
        <div className="finding-severity-explanation">
          <strong>
            {finding.priority
              ? `${finding.priority} · ${SEVERITIES[finding.priority].label} severity — ${SEVERITIES[finding.priority].urgency}`
              : "Severity has not been classified"}
          </strong>
          <p>
            {finding.priority
              ? SEVERITIES[finding.priority].description
              : "This imported finding has no assigned severity. Review its evidence before choosing an urgency level."}
          </p>
          <span>
            The report author assigned this level. The scenario and evidence
            below explain the reported issue.
          </span>
        </div>
        <div className="finding-anchor">
          <button className="inline-link" onClick={() => onEvidence(anchor.id)}>
            {evidencePath(report, anchor)}:{anchor.startLine}
            <ArrowUpRight size={13} />
          </button>
          <button
            className="button quiet small"
            onClick={() => onSource(anchor)}
          >
            <ExternalLink size={13} />
            VS Code
          </button>
        </div>
        <div className="dispositions">
          <span>Your assessment</span>
          {(["confirmed", "fixed", "disputed", "needs-test"] as const).map(
            (value) => (
              <button
                key={value}
                aria-pressed={!decision?.stale && decision?.decision === value}
                disabled={saving}
                onClick={() =>
                  onDecision(
                    finding.id,
                    !decision?.stale && decision?.decision === value
                      ? null
                      : value,
                  )
                }
              >
                {value.replaceAll("-", " ")}
              </button>
            ),
          )}
          {decision?.stale ? <DecisionBadge value={decision} /> : null}
        </div>
        <div className="finding-content">
          <section className="tldr-panel">
            <div className="eyebrow sage">
              <Sparkles size={13} />
              FINDING TLDR
            </div>
            <h3>{finding.tldr}</h3>
          </section>
          {finding.blocks.map((block, index) => (
            <section className="finding-block" key={index}>
              <h3>{block.label}</h3>
              <p className="block-tldr">{block.tldr}</p>
              <SafeMarkdown>{block.bodyMarkdown}</SafeMarkdown>
            </section>
          ))}
          <section className="finding-block">
            <h3>Trace the evidence</h3>
            <ol className="causal-trace">
              {finding.trace.map((step, index) => (
                <li key={index}>
                  <div className="trace-number">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div>
                    <p>{step.note}</p>
                    {step.evidenceIds.map((id) => {
                      const source = report.evidence.find(
                        (item) => item.id === id,
                      );
                      return source ? (
                        <EvidenceLink
                          key={id}
                          report={report}
                          anchor={source}
                          onEvidence={onEvidence}
                        />
                      ) : null;
                    })}
                  </div>
                </li>
              ))}
            </ol>
          </section>
          {finding.proposedFix ? (
            <section className="finding-block">
              <div className="row between">
                <h3>Suggested change</h3>
                <span className="pill">Read-only · not applied</span>
              </div>
              <p>{finding.proposedFix.summary}</p>
              {finding.proposedFix.patch ? (
                <div className="proposal">
                  <div className="row between">
                    <span>
                      Proposed patch against{" "}
                      <code>{report.comparison.head.oid.slice(0, 8)}</code>
                    </span>
                    <button
                      className="button small"
                      onClick={() => onCopy(finding.proposedFix!.patch!)}
                    >
                      <Clipboard size={13} />
                      Copy patch
                    </button>
                  </div>
                  <pre>{finding.proposedFix.patch}</pre>
                </div>
              ) : null}
              <h4>Proposed verification</h4>
              <ul className="plain-list">
                {finding.proposedFix.validation.map((check, index) => (
                  <li key={index}>{check}</li>
                ))}
              </ul>
              <p className="caption">
                These are suggested checks. Actual results are listed in the
                overview.
              </p>
            </section>
          ) : null}
          <button
            className="button"
            onClick={() =>
              onCopy(
                `Review context: ${report.title}\nRepository: ${report.repository.id}\nBase: ${report.comparison.base.oid}\nHead: ${report.comparison.head.oid}\nFinding: ${finding.id} — ${finding.title}\n${finding.tldr}\nEvidence: ${evidencePath(report, anchor)}:${anchor.startLine}-${anchor.endLine} (${anchor.side})\nQuestion: Verify this scenario and explain the smallest justified fix.`,
              )
            }
          >
            <Clipboard size={14} />
            Copy context for an agent
          </button>
        </div>
      </article>
    </div>
  );
}
