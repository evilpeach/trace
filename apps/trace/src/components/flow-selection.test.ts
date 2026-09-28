import { describe, expect, it } from "vitest";
import type { Evidence, Graph } from "@trace/report-contract";
import {
  clampInspectorWidth,
  nodeForEvidence,
  resolveFlowSelection,
  stepEvidence,
} from "./flow-selection";

const graph: Graph = {
  nodes: [
    { id: "trigger", kind: "entry", label: "Start", evidenceIds: [] },
    {
      id: "edit",
      kind: "action",
      label: "Edit",
      evidenceIds: ["old", "new", "missing"],
    },
    { id: "save", kind: "outcome", label: "Save", evidenceIds: ["saved"] },
  ],
  edges: [{ from: "edit", to: "save", evidenceIds: ["transition", "new"] }],
};
const evidence: Evidence[] = [
  { id: "old", fileId: "file", side: "base", startLine: 2, endLine: 3 },
  { id: "new", fileId: "file", side: "head", startLine: 4, endLine: 5 },
  { id: "transition", fileId: "other", side: "head", startLine: 8, endLine: 9 },
  { id: "saved", fileId: "other", side: "head", startLine: 12, endLine: 14 },
];

describe("flow inspector source selection", () => {
  it("keeps base/head anchors separate, includes transitions, and deduplicates", () => {
    expect(
      stepEvidence(graph, "edit", evidence, "before").map((x) => x.id),
    ).toEqual(["old"]);
    expect(
      stepEvidence(graph, "edit", evidence, "after").map((x) => x.id),
    ).toEqual(["new", "transition"]);
  });

  it("restores valid selected anchors and rejects anchors from other steps", () => {
    expect(
      resolveFlowSelection(graph, evidence, {
        nodeId: "edit",
        revision: "after",
        evidenceId: "transition",
      }).anchor?.id,
    ).toBe("transition");
    expect(
      resolveFlowSelection(graph, evidence, {
        nodeId: "edit",
        revision: "after",
        evidenceId: "saved",
      }).anchor?.id,
    ).toBe("new");
    expect(
      resolveFlowSelection(graph, evidence, {
        nodeId: "edit",
        revision: "before",
        evidenceId: "new",
      }).anchor?.id,
    ).toBe("old");
  });

  it("drops removed selections without claiming a trigger has evidence", () => {
    const resolved = resolveFlowSelection(graph, evidence, {
      nodeId: "removed",
      revision: "after",
      evidenceId: "new",
    });
    expect(resolved.node?.id).toBe("trigger");
    expect(resolved.anchor).toBeUndefined();
    expect(
      resolveFlowSelection({ nodes: [], edges: [] }, evidence, {
        nodeId: "edit",
        revision: "after",
        evidenceId: "new",
      }).node,
    ).toBeUndefined();
  });

  it("maps transcript transition evidence to its source step", () => {
    expect(nodeForEvidence(graph, "transition")).toBe("edit");
    expect(nodeForEvidence(graph, "saved")).toBe("save");
    expect(nodeForEvidence(graph, "missing-evidence")).toBeNull();
  });

  it("keeps keyboard and pointer resizing in the same bounds", () => {
    expect(clampInspectorWidth(-10)).toBe(30);
    expect(clampInspectorWidth(45)).toBe(45);
    expect(clampInspectorWidth(100)).toBe(65);
  });
});
