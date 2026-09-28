import { describe, expect, it } from "vitest";
import { exampleReport } from "../../../packages/report-contract/src/index";
import type { ReportSummary } from "./native-types";
import {
  compactReviewWorkspace,
  getReviewStatus,
  normalizeReviewWorkspace,
  readReviewWorkspace,
  recentReviewTargets,
  reconcileReviewSession,
  reviewKey,
  reviewOpenTarget,
  withPRDone,
  withReportVisited,
  withSyncedReviewInbox,
} from "./review-workspace";
import type { ReviewSession } from "./review-workspace";
const empty = () => normalizeReviewWorkspace(null);
const report = (
  handle: string,
  date = "2026-09-24T00:00:00Z",
  prNumber: number | null = 1,
): ReportSummary => ({
  projectId: "repo",
  reportId: "stable-review",
  handle,
  generatedAt: date,
  prNumber,
  prUrl: null,
  title: handle,
  repositoryName: "Repository",
  head: handle,
});
const session = (): ReviewSession => ({
  position: {
    view: "files",
    fileId: exampleReport.files[0].id,
    flowId: exampleReport.flows[0].id,
    findingId: exampleReport.findings[0]?.id ?? "",
    evidenceId: null,
  },
  fileQuery: "session",
  roundFilter: exampleReport.rounds[0]?.id ?? "all",
  flowFilter: exampleReport.flows[0].id,
  unreviewedOnly: true,
  fileLayout: "stack",
  scrollY: 840,
  flowSelection: { revision: "after", nodeId: null, evidenceId: null },
});

describe("review inbox", () => {
  it("keeps new, in-progress, done, updated and reopen transitions separate", () => {
    const first = report("first"),
      next = report("next", "2026-09-25T00:00:00Z");
    let state = withSyncedReviewInbox(empty(), [first]);
    expect(getReviewStatus(state, [first])).toBe("new");
    state = withReportVisited(state, first);
    expect(getReviewStatus(state, [first])).toBe("in-progress");
    state = withPRDone(state, first, true);
    expect(getReviewStatus(state, [first])).toBe("done");
    state = withSyncedReviewInbox(state, [first, next]);
    expect(getReviewStatus(state, [first, next])).toBe("updated");
    state = withReportVisited(state, next);
    expect(getReviewStatus(state, [first, next])).toBe("in-progress");
    state = withPRDone(state, next, true);
    expect(getReviewStatus(state, [first, next])).toBe("done");
    state = withReportVisited(state, first);
    expect(getReviewStatus(state, [first, next])).toBe("done");
    state = withPRDone(state, next, false);
    expect(getReviewStatus(state, [first, next])).toBe("in-progress");
  });
  it("acknowledges existing history on first visit but detects later arrivals with older timestamps", () => {
    const old = report("old", "2026-09-01T00:00:00Z"),
      latest = report("latest"),
      arrival = report("late-arrival", "2026-09-10T00:00:00Z");
    let state = withSyncedReviewInbox(empty(), [old, latest]);
    state = withReportVisited(state, latest);
    expect(getReviewStatus(state, [old, latest])).toBe("in-progress");
    state = withPRDone(state, latest, true);
    state = withSyncedReviewInbox(state, [old, latest, arrival]);
    expect(getReviewStatus(state, [old, latest, arrival])).toBe("updated");
    expect(reviewOpenTarget(state, [old, latest, arrival])?.handle).toBe(
      arrival.handle,
    );
    state = withReportVisited(state, old);
    expect(getReviewStatus(state, [old, latest, arrival])).toBe("updated");
    state = withReportVisited(state, arrival);
    expect(getReviewStatus(state, [old, latest, arrival])).toBe("done");
  });
  it("does not mark a just-opened import unread when discovery catches up", () => {
    const old = report("old"),
      imported = report("imported", "2026-09-25T00:00:00Z");
    let state = withReportVisited(withSyncedReviewInbox(empty(), [old]), old);
    state = withReportVisited(state, imported);
    state = withSyncedReviewInbox(state, [old, imported]);
    expect(getReviewStatus(state, [old, imported])).toBe("in-progress");
    expect(state.reviews[reviewKey(old)].unreadHandles).toEqual([]);
  });
  it("opening one update does not hide another, and archived reviews retain their unread state", () => {
    const old = report("old"),
      second = report("second", "2026-09-25T00:00:00Z"),
      third = report("third", "2026-09-26T00:00:00Z");
    let state = withPRDone(withSyncedReviewInbox(empty(), [old]), old, true);
    state.reviews[reviewKey(old)].archived = true;
    state = withSyncedReviewInbox(state, [old, second, third]);
    state = withReportVisited(state, third);
    expect(getReviewStatus(state, [old, second, third])).toBe("updated");
    expect(state.reviews[reviewKey(old)].archived).toBe(true);
    expect(reviewOpenTarget(state, [old, second, third])?.handle).toBe(
      "second",
    );
  });
  it("groups real PRs by project and branch snapshots by stable report identity", () => {
    expect(reviewKey(report("one"))).toBe(reviewKey(report("two")));
    expect(reviewKey(report("one", undefined, null))).toBe(
      reviewKey(report("two", undefined, null)),
    );
    expect(reviewKey({ ...report("one"), projectId: "other" })).not.toBe(
      reviewKey(report("one")),
    );
    expect(
      reviewKey({
        ...report("one", undefined, null),
        reportId: "another-branch",
      }),
    ).not.toBe(reviewKey(report("one", undefined, null)));
  });
});

describe("welcome return targets", () => {
  it("excludes archived projects and archived PRs and returns one report per PR", () => {
    const old = report("old", "2026-09-01T00:00:00Z"),
      latest = report("latest");
    const archivedReview = report("archived-review", undefined, 2);
    const archivedProject = {
      ...report("archived-project"),
      projectId: "archived-project",
    };
    const reports = [old, latest, archivedReview, archivedProject];
    const state = withSyncedReviewInbox(empty(), reports);
    state.reviews[reviewKey(archivedReview)].archived = true;
    state.projects[archivedProject.projectId] = {
      pinned: false,
      archived: true,
      updatedAt: 0,
    };
    expect(
      recentReviewTargets(state, reports).map((item) => item.handle),
    ).toEqual(["latest"]);
  });
  it("ranks recently visited reviews above newer generated reports and resumes the last selected snapshot", () => {
    const old = report("old", "2026-09-01T00:00:00Z"),
      latest = report("latest");
    const newer = report("newer", "2026-09-25T00:00:00Z", 2);
    const reports = [old, latest, newer];
    let state = withSyncedReviewInbox(empty(), reports, 1);
    state = withReportVisited(state, newer, 10);
    state = withReportVisited(state, old, 20);
    expect(
      recentReviewTargets(state, reports).map((item) => item.handle),
    ).toEqual(["old", "newer"]);
  });
  it("uses unread update targets and generated time as the fallback order", () => {
    const first = report("first"),
      next = report("next", "2026-09-25T00:00:00Z");
    const newer = report("newer", "2026-09-26T00:00:00Z", 2);
    const reports = [first, next, newer];
    let state = withSyncedReviewInbox(empty(), [first, newer], 1);
    expect(
      recentReviewTargets(empty(), reports).map((item) => item.handle),
    ).toEqual(["newer", "next"]);
    state = withReportVisited(state, first, 2);
    state = withSyncedReviewInbox(state, reports, 3);
    expect(recentReviewTargets(state, reports)[0].handle).toBe("next");
  });
});

describe("resume context", () => {
  it("preserves valid filters and position for the same immutable snapshot", () => {
    const original = session();
    const restored = reconcileReviewSession(exampleReport, original);
    expect(restored.session).toEqual(original);
    expect(restored.notice).toBeUndefined();
  });
  it("clears filters, old anchors and scroll on a different snapshot while retaining valid selections", () => {
    const original = session();
    original.position.evidenceId = exampleReport.evidence[0].id;
    const restored = reconcileReviewSession(exampleReport, original, true);
    expect(restored.session.position.view).toBe("files");
    expect(restored.session.position.fileId).toBe(original.position.fileId);
    expect(restored.session.position.evidenceId).toBeNull();
    expect(restored.session.fileQuery).toBe("");
    expect(restored.session.roundFilter).toBe("all");
    expect(restored.session.flowFilter).toBe("all");
    expect(restored.session.unreviewedOnly).toBe(false);
    expect(restored.session.scrollY).toBe(0);
    expect(restored.notice).toContain("different report snapshot");
    expect(original.scrollY).toBe(840);
  });
  it("starts with the designated journey but preserves an existing selection", () => {
    const main = { ...exampleReport.flows[0], id: "designated-main" };
    const report = {
      ...exampleReport,
      flows: [...exampleReport.flows, main],
      mainJourney: { flowId: main.id, why: "The PR's central outcome." },
    };
    expect(
      reconcileReviewSession(report, undefined).session.position.flowId,
    ).toBe(main.id);
    const previous = session();
    expect(
      reconcileReviewSession(report, previous).session.position.flowId,
    ).toBe(previous.position.flowId);
  });

  it("reconciles removed files, flows, findings and anchors without dangling selections", () => {
    const original = session();
    original.position = {
      view: "findings",
      fileId: "gone",
      flowId: "gone",
      findingId: "gone",
      evidenceId: "gone",
    };
    original.flowSelection.nodeId = "gone";
    original.flowSelection.evidenceId = "gone";
    const restored = reconcileReviewSession(exampleReport, original);
    expect(restored.session.position.fileId).toBe(exampleReport.files[0].id);
    expect(restored.session.position.flowId).toBe(exampleReport.flows[0].id);
    expect(restored.session.position.evidenceId).toBeNull();
    expect(restored.session.flowSelection).toEqual({
      revision: "after",
      nodeId: null,
      evidenceId: null,
    });
    expect(restored.notice).toContain("no longer available");
  });
  it("retains outgoing transition evidence for the selected graph revision", () => {
    const report = structuredClone(exampleReport);
    const original = session();
    const flow = report.flows[0];
    if (!flow.after.graph) throw new Error("Fixture needs an after graph");
    const node = flow.after.graph.nodes[0];
    const edge = flow.after.graph.edges.find((item) => item.from === node.id);
    const anchor = report.evidence.find((item) => item.side === "head");
    if (!edge || !anchor)
      throw new Error("Fixture needs a head anchor and outgoing edge");
    edge.evidenceIds = [anchor.id];
    original.flowSelection = {
      revision: "after",
      nodeId: node.id,
      evidenceId: anchor.id,
    };
    expect(
      reconcileReviewSession(report, original).session.flowSelection,
    ).toEqual(original.flowSelection);
  });
});

describe("guarded workspace persistence", () => {
  it("never writes a cache larger than the reader accepts", () => {
    const handles = Array.from({ length: 500 }, (_, i) =>
      `${i}-`.padEnd(120, "x"),
    );
    const reviews = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `review-${i}`,
        {
          visitedHandles: handles,
          knownHandles: handles,
          unreadHandles: [],
          updatedAt: i,
        },
      ]),
    );
    const state = compactReviewWorkspace(
      normalizeReviewWorkspace({ version: 1, reviews }),
    );
    const serialized = JSON.stringify(state);
    expect(serialized.length).toBeLessThanOrEqual(3_500_000);
    expect(state.reviews["review-59"]).toBeDefined();
    expect(readReviewWorkspace({ getItem: () => serialized })).toEqual(state);
  });

  it("recovers from corrupt, blocked, oversized or unsupported storage", () => {
    expect(readReviewWorkspace({ getItem: () => "{bad json" })).toEqual(
      empty(),
    );
    expect(
      readReviewWorkspace({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(empty());
    expect(
      readReviewWorkspace({ getItem: () => " ".repeat(4_000_001) }),
    ).toEqual(empty());
    expect(
      normalizeReviewWorkspace({
        version: 22,
        projects: { x: { pinned: true } },
      }),
    ).toEqual(empty());
  });
  it("sanitizes malformed entries and bounds stored queries, positions and histories", () => {
    const state = normalizeReviewWorkspace({
      version: 1,
      reviews: {
        x: {
          pinned: "yes",
          visitedHandles: ["valid", null, "valid"],
          lastVisitedHandle: "unknown",
          unreadHandles: ["valid", "new"],
        },
      },
      sessions: {
        h: {
          ...session(),
          fileQuery: "x".repeat(400),
          scrollY: Infinity,
          fileLayout: "bad",
          flowSelection: { revision: "bad", nodeId: {}, evidenceId: 3 },
        },
      },
    });
    expect(state.reviews.x.visitedHandles).toEqual(["valid"]);
    expect(state.reviews.x.unreadHandles).toEqual(["new"]);
    expect(state.reviews.x.lastVisitedHandle).toBe("valid");
    expect(state.reviews.x.pinned).toBe(false);
    expect(state.sessions.h.fileQuery).toHaveLength(200);
    expect(state.sessions.h.scrollY).toBe(0);
    expect(state.sessions.h.fileLayout).toBe("single");
    expect(state.sessions.h.flowSelection).toEqual({
      revision: "after",
      nodeId: null,
      evidenceId: null,
    });
  });
  it("bounds the number of session entries and rejects prototype keys", () => {
    const sessions = Object.fromEntries(
      Array.from({ length: 450 }, (_, index) => [
        `h${index}`,
        { updatedAt: index },
      ]),
    );
    const malicious = JSON.parse(
      '{"__proto__":{"pinned":true},"constructor":{"pinned":true}}',
    );
    const state = normalizeReviewWorkspace({
      version: 1,
      sessions,
      projects: malicious,
    });
    expect(Object.keys(state.sessions)).toHaveLength(400);
    expect(state.sessions.h0).toBeUndefined();
    expect(state.sessions.h449).toBeDefined();
    expect(Object.keys(state.projects)).toEqual([]);
  });
});
