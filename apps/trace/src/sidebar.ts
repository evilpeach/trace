import type { ReportSummary } from "./native-types";
import { groupPullRequests } from "./projects";
import { reportDisplayTitle } from "./report-label";
import {
  getReviewStatus,
  reviewOpenTarget,
  type ReviewWorkspace,
} from "./review-workspace";

export type SidebarFilter = "all" | "needs-review" | "in-progress" | "done";

/** Sidebar counts and rows represent reviews, never individual snapshots. */
export function projectReviews(
  reports: ReportSummary[],
  workspace: ReviewWorkspace,
  projectId: string,
) {
  if (workspace.projects[projectId]?.archived) return [];
  return groupPullRequests(
    reports.filter((report) => report.projectId === projectId),
  )
    .filter((group) => !workspace.reviews[group.id]?.archived)
    .map((group) => ({
      ...group,
      title:
        reportDisplayTitle(group.reports[0].title, group.reports[0].prNumber) ||
        group.label,
      status: getReviewStatus(workspace, group.reports),
      pinned: !!workspace.reviews[group.id]?.pinned,
      target: reviewOpenTarget(workspace, group.reports)!,
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function filterProjectReviews(
  groups: ReturnType<typeof projectReviews>,
  filter: SidebarFilter,
  query: string,
) {
  const search = query.trim().toLowerCase();
  return groups.filter((group) => {
    const matchesStatus =
      filter === "all" ||
      (filter === "needs-review"
        ? group.status === "new" || group.status === "updated"
        : group.status === filter);
    return (
      matchesStatus &&
      (!search ||
        [
          group.label,
          ...group.reports.flatMap((report) => [
            report.title,
            report.reportId,
            report.head,
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search))
    );
  });
}
