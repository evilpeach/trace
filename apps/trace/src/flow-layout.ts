import dagre from "@dagrejs/dagre";
import type { Graph } from "@trace/report-contract";

export const FLOW_NODE_WIDTH = 284;
const FALLBACK_NODE_HEIGHT = 144;
const EDGE_LABEL_LINE_HEIGHT = 18;

export type Point = { x: number; y: number };
export type NodeSize = { width: number; height: number };
export type FlowLayout = {
  nodes: Map<string, Point & NodeSize>;
  edges: {
    id: string;
    points: Point[];
    label: Point;
    labelLines: string[];
    labelHeight: number;
  }[];
};

/** Keep every character, including long identifiers, instead of ellipsizing branches. */
export function wrapFlowLabel(label: string, maxLength = 32): string[] {
  const lines: string[] = [];
  for (const paragraph of label.split("\n")) {
    let remaining = paragraph.trim();
    while (remaining.length > maxLength) {
      const lastSpace = remaining.lastIndexOf(" ", maxLength);
      const end = lastSpace > 0 ? lastSpace : maxLength;
      lines.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

/** Directed layout retains parallel edges, joins and cycles; measured cards never overlap. */
export function layoutFlowGraph(
  graph: Graph,
  sizes: ReadonlyMap<string, NodeSize> = new Map(),
): FlowLayout {
  const layout = new dagre.graphlib.Graph({ multigraph: true });
  layout.setGraph({
    rankdir: "LR",
    ranksep: 72,
    nodesep: 68,
    edgesep: 32,
    marginx: 32,
    marginy: 32,
  });
  layout.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) {
    layout.setNode(node.id, {
      width: sizes.get(node.id)?.width ?? FLOW_NODE_WIDTH,
      height: sizes.get(node.id)?.height ?? FALLBACK_NODE_HEIGHT,
    });
  }
  const labels = graph.edges.map((edge) => wrapFlowLabel(edge.label ?? ""));
  graph.edges.forEach((edge, index) => {
    const lines = labels[index];
    layout.setEdge(
      edge.from,
      edge.to,
      {
        width: lines.length
          ? Math.max(...lines.map((line) => line.length)) * 8 + 24
          : 0,
        height: lines.length * EDGE_LABEL_LINE_HEIGHT + (lines.length ? 16 : 0),
        labelpos: "c",
      },
      String(index),
    );
  });
  dagre.layout(layout);
  const nodes = new Map<string, Point & NodeSize>();
  for (const node of graph.nodes) {
    const positioned = layout.node(node.id);
    nodes.set(node.id, {
      x: positioned.x - positioned.width / 2,
      y: positioned.y - positioned.height / 2,
      width: positioned.width,
      height: positioned.height,
    });
  }
  return {
    nodes,
    edges: graph.edges.map((edge, index) => {
      const positioned = layout.edge({
        v: edge.from,
        w: edge.to,
        name: String(index),
      });
      const middle =
        positioned.points[Math.floor(positioned.points.length / 2)];
      return {
        id: `transition-${index}`,
        points: positioned.points,
        label: { x: positioned.x ?? middle.x, y: positioned.y ?? middle.y },
        labelLines: labels[index],
        labelHeight: labels[index].length * EDGE_LABEL_LINE_HEIGHT,
      };
    }),
  };
}

export function edgePath(points: Point[]): string {
  return points
    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
    .join(" ");
}
