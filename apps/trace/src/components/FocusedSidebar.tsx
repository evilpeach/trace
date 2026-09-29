import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Folder, Pin, Plus, Search, X } from "lucide-react";
import type { ProjectSummary, ReportSummary } from "../native-types";
import { reviewStatusLabel, useReviewWorkspace } from "../review-workspace";
import {
  filterProjectReviews,
  projectReviews,
  type SidebarFilter,
} from "../sidebar";
import { Dialog } from "./Dialog";

const filters: { id: SidebarFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-review", label: "Needs review" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Done" },
];
const countLabel = (count: number) =>
  `${count} ${count === 1 ? "review" : "reviews"}`;

export function FocusedSidebar({
  projects,
  reports,
  projectId,
  activeHandle,
  busy,
  native,
  newReviewShortcut,
  onProject,
  onOpen,
  onCreate,
  onAdd,
  onManage,
  footer,
}: {
  projects: ProjectSummary[];
  reports: ReportSummary[];
  projectId?: string;
  activeHandle?: string;
  busy: boolean;
  native: boolean;
  newReviewShortcut: string;
  onProject: (id: string) => void;
  onOpen: (handle: string) => void;
  onCreate: () => void;
  onAdd: () => void;
  onManage: () => void;
  footer: ReactNode;
}) {
  const workspace = useReviewWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SidebarFilter>("all");
  const [picking, setPicking] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const project = projects.find((item) => item.id === projectId);
  const groupsByProject = useMemo(
    () =>
      new Map(
        projects.map((item) => [
          item.id,
          projectReviews(reports, workspace, item.id),
        ]),
      ),
    [projects, reports, workspace],
  );
  const groups = (projectId && groupsByProject.get(projectId)) || [];
  const visible = filterProjectReviews(groups, filter, query);
  const hasArchivedReviews =
    !groups.length && reports.some((report) => report.projectId === projectId);
  const selectedHidden = groups.find(
    (group) =>
      group.reports.some((report) => report.handle === activeHandle) &&
      !visible.some((item) => item.id === group.id),
  );
  const visibleProjects = projects
    .filter((item) => !workspace.projects[item.id]?.archived)
    .sort(
      (a, b) =>
        Number(!!workspace.projects[b.id]?.pinned) -
        Number(!!workspace.projects[a.id]?.pinned),
    );
  const matchingProjects = visibleProjects.filter((item) =>
    item.name.toLowerCase().includes(projectQuery.trim().toLowerCase()),
  );
  function clearFilters() {
    setQuery("");
    setFilter("all");
  }

  return (
    <>
      <div className="focused-sidebar-top">
        <button
          className="focused-project-switch"
          aria-haspopup="dialog"
          disabled={busy}
          title="Switch project"
          onClick={() => {
            setProjectQuery("");
            setPicking(true);
          }}
        >
          <span className="focused-project-avatar">
            {project?.name.slice(0, 1).toUpperCase() || <Folder size={18} />}
          </span>
          <span>
            <strong>{project?.name ?? "Choose a project"}</strong>
            <small>
              {project
                ? workspace.projects[project.id]?.archived
                  ? "Archived project"
                  : countLabel(groups.length)
                : "Your review workspace"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <button
          className="button primary focused-create"
          disabled={busy}
          onClick={onCreate}
          title={`New review${newReviewShortcut ? ` (${newReviewShortcut})` : ""}`}
        >
          <Plus size={16} /> New review{" "}
          {newReviewShortcut ? <kbd>{newReviewShortcut}</kbd> : null}
        </button>
        <label className="focused-review-search">
          <Search size={15} />
          <input
            aria-label="Find a review in this project"
            placeholder="Find a review…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              className="icon-button"
              aria-label="Clear review search"
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          ) : null}
        </label>
        <div
          className="focused-review-filters"
          role="group"
          aria-label="Filter project reviews"
        >
          {filters.map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              title={
                item.id === "needs-review"
                  ? "New reviews and unread report updates"
                  : undefined
              }
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <nav className="focused-review-list" aria-label="Project reviews">
        <div className="focused-list-heading">
          <span>Pull requests & branches</span>
          <span>{countLabel(visible.length)}</span>
        </div>
        {selectedHidden ? (
          <button className="focused-filter-note" onClick={clearFilters}>
            Current review is hidden by filters. Show all
          </button>
        ) : null}
        {visible.map((group) => (
          <button
            key={group.id}
            className="focused-review-row"
            disabled={busy}
            aria-current={
              group.reports.some((report) => report.handle === activeHandle)
                ? "page"
                : undefined
            }
            title={`${group.title} · ${group.label} · ${reviewStatusLabel[group.status]}`}
            onClick={() => onOpen(group.target.handle)}
          >
            <span className={`focused-status-dot status-${group.status}`} />
            <span className="focused-review-copy">
              <strong>{group.title}</strong>
              <small>
                {group.label} <span aria-hidden="true">·</span>{" "}
                <span className={`focused-status status-${group.status}`}>
                  {reviewStatusLabel[group.status]}
                </span>
              </small>
            </span>
            {group.pinned ? <Pin size={12} aria-label="Pinned review" /> : null}
          </button>
        ))}
        {!visible.length ? (
          <div className="focused-empty">
            <p>
              {!project
                ? "Choose a project to see its reviews."
                : groups.length
                  ? "No reviews match these filters."
                  : workspace.projects[project.id]?.archived
                    ? "This project is archived. Restore it from the review inbox."
                    : hasArchivedReviews
                      ? "All reviews in this project are archived. Restore them from the review inbox."
                      : "No reviews yet. Start with a pull request or branch."}
            </p>
            {groups.length ? (
              <button className="text-button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : project &&
              !workspace.projects[project.id]?.archived &&
              !hasArchivedReviews ? (
              <button
                className="text-button"
                disabled={busy}
                onClick={onCreate}
              >
                Create first review
              </button>
            ) : (
              <button className="text-button" onClick={onManage}>
                Open review inbox
              </button>
            )}
          </div>
        ) : null}
      </nav>
      {footer}
      {picking ? (
        <Dialog title="Switch project" onClose={() => setPicking(false)}>
          <label className="focused-review-search project-picker-search">
            <Search size={16} />
            <input
              aria-label="Find a project"
              placeholder="Find a project…"
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
            />
          </label>
          <div className="focused-project-options">
            {matchingProjects.map((item) => (
              <button
                key={item.id}
                className="focused-project-option"
                disabled={busy}
                aria-current={item.id === projectId ? "true" : undefined}
                onClick={() => {
                  setPicking(false);
                  onProject(item.id);
                }}
              >
                <Folder size={19} />
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {countLabel(groupsByProject.get(item.id)?.length ?? 0)}
                  </small>
                </span>
                {workspace.projects[item.id]?.pinned ? (
                  <Pin size={13} aria-label="Pinned project" />
                ) : null}
                {item.id === projectId ? <Check size={16} /> : null}
              </button>
            ))}
            {!matchingProjects.length ? (
              <p className="caption">
                {projectQuery
                  ? "No matching projects."
                  : "Add a project or restore one from the review inbox."}
              </p>
            ) : null}
          </div>
          <div className="focused-project-actions">
            <button
              className="button"
              disabled={!native || busy}
              onClick={() => {
                setPicking(false);
                onAdd();
              }}
            >
              <Plus size={15} />
              Add project
            </button>
            <button
              className="button quiet"
              onClick={() => {
                setPicking(false);
                onManage();
              }}
            >
              Manage projects & archive
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
