import { expect, it } from "vitest";
import { groupPullRequests } from "./projects";
import type { ReportSummary } from "./native-types";
const summary = (
  projectId: string,
  handle: string,
  prNumber: number | null,
  generatedAt = "2026-09-24T00:00:00Z",
): ReportSummary => ({
  projectId,
  handle,
  prNumber,
  generatedAt,
  reportId: handle,
  prUrl: null,
  title: handle,
  repositoryName: projectId,
  head: "abc",
});
it("groups PR snapshots by project, keeps branch reviews distinct, and sorts newest first", () => {
  const groups = groupPullRequests([
    summary("a", "old", 1),
    summary("b", "other-repo", 1),
    summary("a", "latest", 1, "2026-09-25T00:00:00Z"),
    summary("a", "branch-a", null),
    summary("a", "branch-b", null),
  ]);
  expect(groups).toHaveLength(4);
  expect(groups[0].reports.map((item) => item.handle)).toEqual([
    "latest",
    "old",
  ]);
  expect(
    groups.find((group) => group.reports[0].handle === "other-repo")?.reports,
  ).toHaveLength(1);
});

it("orders timestamp offsets by actual time", () => {
  const groups = groupPullRequests([
    summary("a", "earlier", 1, "2026-09-24T09:00:00+07:00"),
    summary("a", "later", 1, "2026-09-24T03:00:00Z"),
    summary("a", "latest-group", 2, "2026-09-24T03:30:00Z"),
  ]);
  expect(groups[0].reports[0].handle).toBe("latest-group");
  expect(groups[1].reports.map((report) => report.handle)).toEqual([
    "later",
    "earlier",
  ]);
});
