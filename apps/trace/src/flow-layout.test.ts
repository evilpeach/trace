import { describe, expect, it } from "vitest";
import type { Graph } from "@trace/report-contract";
import { edgePath, layoutFlowGraph, wrapFlowLabel } from "./flow-layout";

function graphOf(ids: string[], edges: [string, string, string?][]): Graph {
  return {
    nodes: ids.map((id, index) => ({
      id,
      kind: index ? "action" : "entry",
      label: id,
      evidenceIds: [],
    })),
    edges: edges.map(([from, to, label]) => ({
      from,
      to,
      label,
      evidenceIds: [],
    })),
  };
}

describe("flow layout", () => {
  it("keeps branches and their shared outcome after their incoming steps", () => {
    const graph = graphOf(
      ["start", "ready", "wait", "end"],
      [
        ["start", "ready", "Ready"],
        ["start", "wait", "Not ready"],
        ["ready", "end"],
        ["wait", "end"],
      ],
    );
    const layout = layoutFlowGraph(graph);
    for (const edge of graph.edges) {
      const from = layout.nodes.get(edge.from)!;
      const to = layout.nodes.get(edge.to)!;
      expect(to.x).toBeGreaterThan(from.x + from.width);
    }
    const ready = layout.nodes.get("ready")!;
    const wait = layout.nodes.get("wait")!;
    expect(Math.abs(ready.y - wait.y)).toBeGreaterThanOrEqual(ready.height);
  });

  it("reserves the measured height of long cards without overlapping adjacent branches", () => {
    const graph = graphOf(
      ["start", "tall", "short", "end"],
      [
        ["start", "tall"],
        ["start", "short"],
        ["tall", "end"],
        ["short", "end"],
      ],
    );
    const layout = layoutFlowGraph(
      graph,
      new Map([["tall", { width: 284, height: 620 }]]),
    );
    const tall = layout.nodes.get("tall")!;
    const short = layout.nodes.get("short")!;
    expect(tall.height).toBe(620);
    expect(
      tall.y + tall.height <= short.y || short.y + short.height <= tall.y,
    ).toBe(true);
  });

  it("preserves cycle, self-loop, parallel and disconnected nodes with finite routes", () => {
    const graph = graphOf(
      ["start", "work", "done", "unconnected"],
      [
        ["start", "work"],
        ["work", "start", "Retry"],
        ["work", "work", "Still waiting"],
        ["work", "done", "Saved"],
        ["work", "done", "Already saved"],
      ],
    );
    const layout = layoutFlowGraph(graph);
    expect(layout.nodes.size).toBe(4);
    expect(layout.edges).toHaveLength(5);
    expect(new Set(layout.edges.map((edge) => edge.id)).size).toBe(5);
    for (const node of layout.nodes.values()) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    }
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThan(1);
      expect(
        edge.points.every(
          (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
        ),
      ).toBe(true);
      expect(edgePath(edge.points)).not.toMatch(/NaN|undefined/);
    }
    expect(edgePath(layout.edges[3].points)).not.toBe(
      edgePath(layout.edges[4].points),
    );
  });

  it("retains full branch conditions and long identifiers while wrapping labels", () => {
    const label =
      "Chart not ready or geometry unavailable; keep all existing orders visible";
    const lines = wrapFlowLabel(label);
    expect(lines.join(" ")).toBe(label);
    expect(lines.every((line) => line.length <= 32)).toBe(true);
    const identifier = "a".repeat(130);
    expect(wrapFlowLabel(identifier).join("")).toBe(identifier);
    const layout = layoutFlowGraph(
      graphOf(["start", "end"], [["start", "end", label]]),
    );
    expect(layout.edges[0].labelLines).toEqual(lines);
  });
});
