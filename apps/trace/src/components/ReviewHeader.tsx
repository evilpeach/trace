import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  Check,
  FileCode2,
  Flag,
  FolderOpen,
  GitBranch,
  History,
  Info,
  LayoutGrid,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import type { LoadedReport } from "../native-types";
import { reportDisplayTitle } from "../report-label";
import { formatShortcut, type ShortcutBindings } from "../shortcuts";

export const reviewSections = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "files", label: "Files", icon: FileCode2 },
  { id: "flows", label: "User journeys", icon: GitBranch },
  { id: "findings", label: "Findings", icon: Flag },
] as const;
type View = (typeof reviewSections)[number]["id"];
type Action = {
  label: string;
  icon: typeof Info;
  onSelect: () => void;
  disabled?: boolean;
};

function ReviewActions({ actions }: { actions: Action[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="review-actions-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = [
            ...(root.current?.querySelectorAll<HTMLButtonElement>(
              "[role='menuitem']:not(:disabled)",
            ) ?? []),
          ];
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="button review-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Review actions"
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={16} />
        <span>Review actions</span>
      </button>
      {open ? (
        <div
          className="review-actions-popover"
          id={menuId}
          role="menu"
          aria-label="Review actions"
        >
          {actions.map(({ label, icon: Icon, onSelect, disabled }) => (
            <button
              key={label}
              role="menuitem"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                // Dialogs opened by the action restore focus to this stable trigger.
                trigger.current?.focus();
                onSelect();
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ReviewHeader({
  loaded,
  view,
  shortcuts,
  reviewedCount,
  done,
  disabled,
  native,
  onView,
  onDone,
  onRefresh,
  onCheckpoint,
  onRepository,
  onLibrary,
  onDetails,
  children,
}: {
  loaded: LoadedReport;
  view: View;
  shortcuts: ShortcutBindings;
  reviewedCount: number;
  done: boolean;
  disabled: boolean;
  native: boolean;
  onView: (view: View) => void;
  onDone: () => void;
  onRefresh: () => void;
  onCheckpoint: () => void;
  onRepository: () => void;
  onLibrary: () => void;
  onDetails: () => void;
  children: ReactNode;
}) {
  const { report } = loaded;
  const synthetic = report.provenance.mode === "synthetic-example";
  const prNumber = report.pullRequest?.number ?? null;
  const title =
    reportDisplayTitle(report.title, prNumber) || "Pull request review";
  const base = report.comparison.base.label ?? report.comparison.base.oid;
  const head = report.comparison.head.label ?? report.comparison.head.oid;
  const actions: Action[] = [
    ...(!synthetic
      ? [
          {
            label: "Prepare updated report",
            icon: RefreshCw,
            onSelect: onRefresh,
            disabled: !native || disabled,
          },
        ]
      : []),
    {
      label: loaded.state.checkpoint ? "Update checkpoint" : "Save checkpoint",
      icon: BookmarkCheck,
      onSelect: onCheckpoint,
      disabled,
    },
    { label: "Report details", icon: Info, onSelect: onDetails },
    synthetic
      ? { label: "Reports", icon: History, onSelect: onLibrary, disabled }
      : {
          label: loaded.repository ? "Change repository" : "Connect repository",
          icon: FolderOpen,
          onSelect: onRepository,
          disabled: !native || disabled,
        },
  ];
  return (
    <header className="review-header compact-review-header">
      <div className="compact-header-main">
        <div className="compact-review-identity">
          <div className="compact-review-title">
            {prNumber !== null ? (
              <span className="review-pr-badge">PR #{prNumber}</span>
            ) : null}
            <h1 title={report.title}>{title}</h1>
          </div>
          <div
            className="compact-review-branches"
            aria-label={
              report.pullRequest
                ? `Base ${base}, head ${head}`
                : `Comparison from ${base} to ${head}`
            }
          >
            <span className="compact-base-branch" title={base}>
              {report.comparison.base.label ?? base.slice(0, 8)}
            </span>
            {report.pullRequest ? (
              <ArrowLeft size={13} aria-hidden="true" />
            ) : (
              <ArrowRight size={13} aria-hidden="true" />
            )}
            <GitBranch size={13} aria-hidden="true" />
            <code title={head}>
              {report.comparison.head.label ?? head.slice(0, 8)}
            </code>
          </div>
        </div>
        <div className="compact-header-actions">
          <ReviewActions key={view} actions={actions} />
          <button
            className={`button ${done ? "" : "primary"}`}
            disabled={disabled}
            onClick={onDone}
            title="Personal review status; does not approve or merge the pull request"
          >
            <Check size={14} />
            {done ? "Reopen review" : "Mark done"}
          </button>
        </div>
      </div>
      <div className="compact-header-bottom">
        <nav className="compact-review-tabs" aria-label="Review sections">
          {reviewSections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              title={`${id === "flows" ? `${report.flows.length} documented user ${report.flows.length === 1 ? "journey" : "journeys"} · before/after behavior across files` : label}${shortcuts[id] ? ` (${formatShortcut(shortcuts[id])})` : ""}`}
              onClick={() => onView(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
              {id !== "overview" ? (
                <span className="review-tab-count">{report[id].length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="compact-header-status">
          {children}
          <div
            className="compact-review-progress"
            title={`${reviewedCount} of ${report.files.length} files reviewed`}
          >
            <span className="compact-progress-track" aria-hidden="true">
              <i
                style={{
                  width: `${report.files.length ? (reviewedCount / report.files.length) * 100 : 0}%`,
                }}
              />
            </span>
            <span>
              {reviewedCount}/{report.files.length}
              <span className="review-progress-label"> reviewed</span>
            </span>
          </div>
          <button
            className="review-details-trigger"
            onClick={onDetails}
            title="Report details: scope, branches, and generation date"
          >
            <Info size={14} />
            <span>Details</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function ReportDetails({
  loaded,
  reviewedCount,
  done,
}: {
  loaded: LoadedReport;
  reviewedCount: number;
  done: boolean;
}) {
  const { report } = loaded;
  return (
    <div className="report-details">
      <p className="dialog-lead">{report.title}</p>
      <dl>
        <dt>Repository</dt>
        <dd>{report.repository.name}</dd>
        {report.pullRequest ? (
          <>
            <dt>Pull request</dt>
            <dd>PR #{report.pullRequest.number}</dd>
          </>
        ) : null}
        <dt>Scope</dt>
        <dd>
          {report.files.length} changed files · {report.contextFiles.length}{" "}
          supporting files
        </dd>
        <dt>
          {report.pullRequest
            ? "Merge direction · base ← head"
            : "Comparison · base → head"}
        </dt>
        <dd>
          <code>
            {report.comparison.base.label ?? report.comparison.base.oid}{" "}
            {report.pullRequest ? "←" : "→"}{" "}
            {report.comparison.head.label ?? report.comparison.head.oid}
          </code>
        </dd>
        <dt>Base snapshot</dt>
        <dd>
          <code>{report.comparison.base.oid}</code>
        </dd>
        <dt>Head snapshot</dt>
        <dd>
          <code>{report.comparison.head.oid}</code>
        </dd>
        <dt>Report generated</dt>
        <dd>{new Date(report.generatedAt).toLocaleString()}</dd>
        <dt>Your review</dt>
        <dd>
          {reviewedCount} of {report.files.length} files reviewed ·{" "}
          {done ? "Done" : "In progress"}
        </dd>
        <dt>Local checkout</dt>
        <dd>{loaded.repository?.displayPath ?? "No repository connected"}</dd>
      </dl>
    </div>
  );
}
