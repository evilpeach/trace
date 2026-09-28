import type { Evidence, Graph } from "@trace/report-contract";
import type { FlowSelection } from "../review-workspace";
export type { FlowSelection } from "../review-workspace";

/** Only offer anchors belonging to this step (or its outgoing transitions)
 * and the displayed revision. Removed and stale anchors never leak through. */
export function stepEvidence(
  graph: Graph,
  nodeId: string,
  evidence: Evidence[],
  revision: FlowSelection["revision"],
) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  const ids = new Set([
    ...(node?.evidenceIds ?? []),
    ...graph.edges
      .filter((edge) => edge.from === nodeId)
      .flatMap((edge) => edge.evidenceIds),
  ]);
  const side = revision === "before" ? "base" : "head";
  return evidence.filter(
    (anchor) => ids.has(anchor.id) && anchor.side === side,
  );
}

export function nodeForEvidence(graph: Graph, evidenceId: string) {
  return (
    graph.nodes.find((node) => node.evidenceIds.includes(evidenceId))?.id ??
    graph.edges.find((edge) => edge.evidenceIds.includes(evidenceId))?.from ??
    null
  );
}

export function resolveFlowSelection(
  graph: Graph,
  evidence: Evidence[],
  selection: FlowSelection,
) {
  const node =
    graph.nodes.find((item) => item.id === selection.nodeId) ?? graph.nodes[0];
  const anchors = node
    ? stepEvidence(graph, node.id, evidence, selection.revision)
    : [];
  const anchor =
    anchors.find((item) => item.id === selection.evidenceId) ?? anchors[0];
  return { node, anchors, anchor };
}

export function clampInspectorWidth(value: number) {
  return Math.max(30, Math.min(65, value));
}
