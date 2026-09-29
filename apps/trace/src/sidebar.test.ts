import { describe, expect, it } from "vitest";
import type { ReportSummary } from "./native-types";
import type { ReviewOrganization, ReviewWorkspace } from "./review-workspace";
import { filterProjectReviews, projectReviews } from "./sidebar";

const report = (
  handle: string,
  overrides: Partial<ReportSummary> = {},
): ReportSummary => ({
  projectId: "strat",
  reportId: "trigger-input",
  prNumber: 331,
  prUrl: null,
  handle,
  title: "PR 331 — TP/SL trigger input",
  generatedAt: "2026-09-28T00:00:00Z",
  repositoryName: "strat-web-app",
  head: "b5fadb4425a319b1",
  ...overrides,
});
const organization = (
  overrides: Partial<ReviewOrganization> = {},
): ReviewOrganization => ({
  pinned: false,
  archived: false,
  visitedHandles: [],
  knownHandles: [],
  unreadHandles: [],
  lastVisitedHandle: null,
  completedHandle: null,
  updatedAt: 0,
  ...overrides,
});
const workspace = (
  reviews: ReviewWorkspace["reviews"] = {},
  projects: ReviewWorkspace["projects"] = {},
): ReviewWorkspace => ({ version: 1, reviews, projects, sessions: {} });

describe("focused project sidebar", () => {
  it("counts PR and branch reviews rather than snapshots within the selected project", () => {
    const groups = projectReviews(
      [
        report("old", { generatedAt: "2026-09-24T00:00:00Z" }),
        report("latest"),
        report("another-project", { projectId: "kit" }),
        report("branch-old", {
          prNumber: null,
          reportId: "header-branch",
          generatedAt: "2026-09-24T00:00:00Z",
        }),
        report("branch-new", { prNumber: null, reportId: "header-branch" }),
        report("other-branch", { prNumber: null, reportId: "sidebar-branch" }),
      ],
      workspace(),
      "strat",
    );

    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.id === "strat:pr:331")).toMatchObject({
      label: "PR #331",
      title: "TP/SL trigger input",
      status: "new",
      target: { handle: "latest" },
    });
    expect(
      groups
        .find((group) => group.id === "strat:pr:331")
        ?.reports.map((item) => item.handle),
    ).toEqual(["latest", "old"]);
    expect(
      groups.find((group) => group.id === "strat:branch:header-branch")
        ?.reports,
    ).toHaveLength(2);
    expect(projectReviews([report("other")], workspace(), "empty")).toEqual([]);
  });

  it("uses the latest title but opens an unread arrival even when its timestamp is older", () => {
    const reports = [
      report("latest", { title: "PR #331 — Updated input design" }),
      report("arrival", {
        title: "Older source snapshot",
        generatedAt: "2026-09-25T00:00:00Z",
      }),
    ];
    const state = workspace({
      "strat:pr:331": organization({
        visitedHandles: ["latest"],
        knownHandles: ["latest", "arrival"],
        unreadHandles: ["arrival"],
        lastVisitedHandle: "latest",
        completedHandle: "latest",
      }),
    });

    expect(projectReviews(reports, state, "strat")[0]).toMatchObject({
      title: "Updated input design",
      status: "updated",
      target: { handle: "arrival" },
    });
  });

  it("resumes the last visited snapshot when there are no unread updates", () => {
    const reports = [
      report("latest"),
      report("old", { generatedAt: "2026-09-24T00:00:00Z" }),
    ];
    const state = workspace({
      "strat:pr:331": organization({
        visitedHandles: ["latest", "old"],
        knownHandles: ["latest", "old"],
        lastVisitedHandle: "old",
      }),
    });

    expect(projectReviews(reports, state, "strat")[0]).toMatchObject({
      status: "in-progress",
      target: { handle: "old" },
    });
  });

  it("hides archived reviews and projects without losing their stored state", () => {
    const reports = [report("hidden"), report("visible", { prNumber: 332 })];
    const archivedReview = organization({
      archived: true,
      visitedHandles: ["previous"],
      unreadHandles: ["hidden"],
    });
    const state = workspace({ "strat:pr:331": archivedReview });

    expect(
      projectReviews(reports, state, "strat").map((group) => group.id),
    ).toEqual(["strat:pr:332"]);
    expect(state.reviews["strat:pr:331"]).toEqual(archivedReview);
    expect(
      projectReviews(
        reports,
        workspace(state.reviews, {
          strat: { archived: true, pinned: false, updatedAt: 0 },
        }),
        "strat",
      ),
    ).toEqual([]);
  });

  it("puts pinned reviews first and keeps generated-time order within each set", () => {
    const reports = [
      report("recent", {
        prNumber: 333,
        generatedAt: "2026-09-28T00:00:00Z",
      }),
      report("pinned-old", {
        prNumber: 331,
        generatedAt: "2026-09-24T00:00:00Z",
      }),
      report("pinned-new", {
        prNumber: 332,
        generatedAt: "2026-09-25T00:00:00Z",
      }),
      report("earlier", {
        prNumber: 334,
        generatedAt: "2026-09-26T00:00:00Z",
      }),
    ];
    const state = workspace({
      "strat:pr:331": organization({ pinned: true }),
      "strat:pr:332": organization({ pinned: true }),
    });

    const groups = projectReviews(reports, state, "strat");
    expect(groups.map((group) => group.target.handle)).toEqual([
      "pinned-new",
      "pinned-old",
      "recent",
      "earlier",
    ]);
    expect(groups.map((group) => group.pinned)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("focused project filters", () => {
  it("combines new and updated in Needs review while keeping progress and done separate", () => {
    const reports = [
      report("new", { prNumber: 331 }),
      report("updated", { prNumber: 332 }),
      report("progress", { prNumber: 333 }),
      report("done", { prNumber: 334 }),
    ];
    const state = workspace({
      "strat:pr:332": organization({
        visitedHandles: ["previous"],
        knownHandles: ["previous", "updated"],
        unreadHandles: ["updated"],
        lastVisitedHandle: "previous",
      }),
      "strat:pr:333": organization({
        visitedHandles: ["progress"],
        knownHandles: ["progress"],
        lastVisitedHandle: "progress",
      }),
      "strat:pr:334": organization({
        visitedHandles: ["done"],
        knownHandles: ["done"],
        lastVisitedHandle: "done",
        completedHandle: "done",
      }),
    });
    const groups = projectReviews(reports, state, "strat");

    expect(filterProjectReviews(groups, "all", "")).toHaveLength(4);
    expect(
      filterProjectReviews(groups, "needs-review", "")
        .map((group) => group.status)
        .sort(),
    ).toEqual(["new", "updated"]);
    expect(
      filterProjectReviews(groups, "in-progress", "").map((group) => group.id),
    ).toEqual(["strat:pr:333"]);
    expect(
      filterProjectReviews(groups, "done", "").map((group) => group.id),
    ).toEqual(["strat:pr:334"]);
    expect(filterProjectReviews(groups, "needs-review", "#334")).toEqual([]);
  });

  it("searches titles from every snapshot plus review labels, report identity and commit", () => {
    const groups = projectReviews(
      [
        report("old", {
          title: "Legacy gain selector",
          generatedAt: "2026-09-24T00:00:00Z",
          head: "aabbccdd12345678",
        }),
        report("latest"),
        report("unrelated", {
          prNumber: 332,
          title: "Data layer",
          reportId: "data-layer",
          head: "1122334455667788",
        }),
      ],
      workspace(),
      "strat",
    );

    for (const query of [
      "  TrIgGeR InPuT  ",
      "LEGACY GAIN",
      "PR #331",
      "331",
      "trigger-input",
      "AABBCCDD",
    ]) {
      expect(
        filterProjectReviews(groups, "all", query).map((group) => group.id),
        query,
      ).toEqual(["strat:pr:331"]);
    }
    expect(filterProjectReviews(groups, "all", "  ")).toHaveLength(2);
    expect(filterProjectReviews(groups, "all", "not in this project")).toEqual(
      [],
    );
  });

  it("finds branch groups without requiring a PR number", () => {
    const groups = projectReviews(
      [
        report("branch", {
          prNumber: null,
          title: "Sidebar layout",
          reportId: "sidebar-branch",
        }),
      ],
      workspace(),
      "strat",
    );

    expect(
      filterProjectReviews(groups, "all", "branch").map((group) => group.id),
    ).toEqual(["strat:branch:sidebar-branch"]);
  });
});
