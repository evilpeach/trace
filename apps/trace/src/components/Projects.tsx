import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  FileText,
  Folder,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { ProjectSummary, ReportSummary } from "../native-types";
import { groupPullRequests, reportDate } from "../projects";
import {
  getReviewStatus,
  reviewOpenTarget,
  reviewStatusLabel,
  setPRDone,
  setProjectOrganization,
  setReviewOrganization,
  useReviewWorkspace,
} from "../review-workspace";
import type { ReviewStatus, ReviewWorkspace } from "../review-workspace";
import "../inbox.css";

interface Props {
  projects: ProjectSummary[];
  reports: ReportSummary[];
  activeHandle?: string;
  activeProject?: string;
  busy: boolean;
  onOpen: (handle: string) => void;
  onContinue?: (handle: string) => void;
  onProject: (id: string) => void;
  onCreate?: (projectId: string) => void;
}
type InboxFilter = "all" | ReviewStatus | "archived";
const filters: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "updated", label: "Updated" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "archived", label: "Archived" },
];
function sortedProjects(
  projects: ProjectSummary[],
  workspace: ReviewWorkspace,
) {
  return [...projects].sort(
    (a, b) =>
      Number(workspace.projects[b.id]?.pinned ?? false) -
      Number(workspace.projects[a.id]?.pinned ?? false),
  );
}
function sortedGroups(reports: ReportSummary[], workspace: ReviewWorkspace) {
  return groupPullRequests(reports).sort(
    (a, b) =>
      Number(workspace.reviews[b.id]?.pinned ?? false) -
      Number(workspace.reviews[a.id]?.pinned ?? false),
  );
}
function Status({
  status,
  archived = false,
}: {
  status: ReviewStatus;
  archived?: boolean;
}) {
  return (
    <span className={`review-inbox-status status-${status}`}>
      {archived
        ? `Archived · ${reviewStatusLabel[status]}`
        : reviewStatusLabel[status]}
    </span>
  );
}
function OrganizationActions({
  label,
  pinned,
  archived,
  onPin,
  onArchive,
  busy,
}: {
  label: string;
  pinned: boolean;
  archived: boolean;
  onPin: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  return (
    <div className="review-organization-actions">
      <button
        className="icon-button"
        aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}
        title={`${pinned ? "Unpin" : "Pin"} ${label}`}
        aria-pressed={pinned}
        onClick={onPin}
        disabled={busy}
      >
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}
      </button>
      <button
        className="icon-button"
        aria-label={`${archived ? "Restore" : "Archive"} ${label}`}
        title={`${archived ? "Restore" : "Archive"} ${label}`}
        onClick={onArchive}
        disabled={busy}
      >
        {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
      </button>
    </div>
  );
}
export function ProjectLibrary({
  projects,
  reports,
  activeHandle,
  busy,
  onOpen,
  onContinue = onOpen,
  onProject,
  onCreate,
  onAdd,
  onScan,
  scanning,
  native,
  scope,
  onAll,
}: Props & {
  onAdd: () => void;
  onScan: () => void;
  scanning: boolean;
  native: boolean;
  scope: string | null;
  onAll: () => void;
}) {
  const workspace = useReviewWorkspace();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const scopedProjects = sortedProjects(
    scope ? projects.filter((project) => project.id === scope) : projects,
    workspace,
  );
  const allGroups = scopedProjects.flatMap((project) =>
    sortedGroups(
      reports.filter((report) => report.projectId === project.id),
      workspace,
    ).map((group) => ({
      ...group,
      project,
      status: getReviewStatus(workspace, group.reports),
      archived:
        !!workspace.projects[project.id]?.archived ||
        !!workspace.reviews[group.id]?.archived,
    })),
  );
  const matches = (group: (typeof allGroups)[number], tab: InboxFilter) =>
    tab === "archived"
      ? group.archived
      : !group.archived && (tab === "all" || group.status === tab);
  const visibleGroups = allGroups.filter((group) => matches(group, filter));
  const visible = scopedProjects.filter(
    (project) =>
      visibleGroups.some((group) => group.project.id === project.id) ||
      (!project.reportCount &&
        (filter === "all"
          ? !workspace.projects[project.id]?.archived
          : filter === "archived" && workspace.projects[project.id]?.archived)),
  );
  return (
    <div className="project-library">
      <div className="row between">
        <p className="dialog-lead">
          Your review inbox. Return to a PR or catch up on a newer report.
        </p>
        <div className="row">
          {scope ? (
            <button className="button small" onClick={onAll}>
              All projects
            </button>
          ) : null}
          <button
            className="button small"
            disabled={!native || scanning || busy}
            onClick={onScan}
          >
            <RefreshCw size={14} className={scanning ? "spin" : ""} />
            Check now
          </button>
          <button
            className="button primary small"
            disabled={!native || busy}
            onClick={onAdd}
          >
            <Plus size={14} />
            Add project
          </button>
        </div>
      </div>
      <div
        className="review-inbox-filters"
        role="group"
        aria-label="Filter review inbox"
      >
        {filters.map((tab) => (
          <button
            key={tab.id}
            className={filter === tab.id ? "selected" : ""}
            aria-pressed={filter === tab.id}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
            <span>
              {allGroups.filter((group) => matches(group, tab.id)).length}
            </span>
          </button>
        ))}
      </div>
      <p className="caption inbox-explanation">
        Updated means a newly detected report has not been opened. Done is your
        own review status; it does not approve a PR or mark findings fixed.
      </p>
      {visible.map((project) => {
        const preferences = workspace.projects[project.id];
        return (
          <section key={project.id} className="library-project">
            <div className="inbox-project-heading">
              <button
                className="library-project-title"
                onClick={() => onProject(project.id)}
              >
                <Folder size={20} />
                <strong>{project.name}</strong>
                <small>{project.reportCount} reports</small>
                {preferences?.pinned ? <Pin size={14} /> : null}
              </button>
              <OrganizationActions
                label={`project ${project.name}`}
                pinned={!!preferences?.pinned}
                archived={!!preferences?.archived}
                busy={busy}
                onPin={() =>
                  setProjectOrganization(project.id, {
                    pinned: !preferences?.pinned,
                  })
                }
                onArchive={() =>
                  setProjectOrganization(project.id, {
                    archived: !preferences?.archived,
                  })
                }
              />
            </div>
            <p className="caption project-path">
              {project.repositories.length
                ? project.repositories
                    .map((repo) => repo.displayPath)
                    .join(" · ")
                : "Connect a checkout to detect reports automatically."}
            </p>
            {preferences?.archived ? (
              <p className="caption inbox-archived-note">
                Restore this project to return its reviews to your inbox. New
                reports are still detected.
              </p>
            ) : null}
            {visibleGroups
              .filter((group) => group.project.id === project.id)
              .map((group) => {
                const review = workspace.reviews[group.id],
                  latest = group.reports[0];
                const resumeHandle = group.reports.some(
                  (report) => report.handle === review?.lastVisitedHandle,
                )
                  ? review?.lastVisitedHandle
                  : null;
                const resume = group.status !== "updated" && resumeHandle;
                const target =
                  reviewOpenTarget(workspace, group.reports) ?? latest;
                return (
                  <section key={group.id} className="library-pr inbox-pr">
                    <div className="inbox-pr-heading">
                      <h3>
                        {group.label}
                        <Status
                          status={group.status}
                          archived={group.archived}
                        />
                        {review?.pinned ? <Pin size={13} /> : null}
                      </h3>
                      <OrganizationActions
                        label={`${group.label} in ${project.name}`}
                        pinned={!!review?.pinned}
                        archived={!!review?.archived}
                        busy={busy}
                        onPin={() =>
                          setReviewOrganization(group.id, {
                            pinned: !review?.pinned,
                          })
                        }
                        onArchive={() =>
                          setReviewOrganization(group.id, {
                            archived: !review?.archived,
                          })
                        }
                      />
                    </div>
                    <p className="inbox-latest-title">{latest.title}</p>
                    <div className="inbox-pr-actions">
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => onContinue(target.handle)}
                      >
                        <Play size={14} />
                        {group.status === "updated"
                          ? target.handle === latest.handle
                            ? "Open latest"
                            : "Open update"
                          : resume
                            ? "Continue review"
                            : "Start review"}
                      </button>
                      <button
                        className="button small quiet"
                        disabled={busy}
                        onClick={() =>
                          setPRDone(latest, group.status !== "done")
                        }
                      >
                        <Check size={14} />
                        {group.status === "done"
                          ? "Reopen review"
                          : "Mark done"}
                      </button>
                      <span className="caption">
                        {reportDate(latest.generatedAt)} ·{" "}
                        <code>{latest.head.slice(0, 8)}</code>
                      </span>
                    </div>
                    <details className="inbox-snapshots">
                      <summary>
                        {group.reports.length}{" "}
                        {group.reports.length === 1
                          ? "report snapshot"
                          : "report snapshots"}
                      </summary>
                      {group.reports.map((item) => (
                        <button
                          key={item.handle}
                          className="recent-row"
                          disabled={busy}
                          aria-current={
                            item.handle === activeHandle ? "page" : undefined
                          }
                          onClick={() => onOpen(item.handle)}
                        >
                          <FileText size={17} />
                          <span>
                            <strong>{item.title}</strong>
                            <small>
                              {reportDate(item.generatedAt)}
                              {item.handle === activeHandle
                                ? " · Currently open"
                                : ""}
                              {review?.unreadHandles.includes(item.handle)
                                ? " · Unread update"
                                : ""}
                            </small>
                          </span>
                          <code>{item.head.slice(0, 8)}</code>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </details>
                  </section>
                );
              })}
            {!project.reportCount ? (
              <div className="project-empty-action">
                <p className="caption">
                  Create a review request for this project. Trace supplies the
                  instructions and detects the completed report.
                </p>
                {onCreate ? (
                  <button
                    className="button"
                    disabled={busy || !native}
                    onClick={() => onCreate(project.id)}
                  >
                    <Plus size={14} /> Create first review
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
      {!visible.length ? (
        <div className="view-empty compact">
          <Folder size={28} />
          <h3>
            {!projects.length
              ? "Your first project starts here"
              : filter === "all"
                ? "Your inbox is clear"
                : `No ${filters.find((tab) => tab.id === filter)?.label.toLowerCase()} reviews`}
          </h3>
          <p>
            {!projects.length
              ? "Add a local repository or import an existing report."
              : filter === "archived"
                ? "Archived projects and PRs appear here. Their reports are kept."
                : "Choose another filter or check for new reports."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
