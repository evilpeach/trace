import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  FileCode2,
  Flag,
  GitBranch,
  History,
  RefreshCw,
} from "lucide-react";
import { client } from "../bridge";
import type { EntityKind, LoadedReport, ReviewChanges } from "../native-types";
import { Dialog } from "./Dialog";
import "./review-changes.css";

/** Reading a checkpoint comparison must never activate its older report. */
export function ReviewChangesControl({
  loaded,
  saving,
  onCheckpoint,
  onEntity,
  onBaseline,
}: {
  loaded: LoadedReport;
  saving: boolean;
  onCheckpoint: () => void;
  onEntity: (kind: EntityKind, id: string) => void;
  onBaseline: (handle: string) => void;
}) {
  const [result, setResult] = useState<ReviewChanges | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    client
      .getReviewChanges(loaded.handle)
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [loaded.handle, loaded.state.revision, attempt]);

  const groups = result
    ? [
        {
          key: "files" as const,
          label: "Files",
          kind: "file" as const,
          icon: FileCode2,
        },
        {
          key: "flows" as const,
          label: "User journeys",
          kind: "flow" as const,
          icon: GitBranch,
        },
        {
          key: "findings" as const,
          label: "Findings",
          kind: "finding" as const,
          icon: Flag,
        },
      ]
    : [];
  const count = result
    ? groups.reduce(
        (total, { key }) =>
          total +
          result[key].added.length +
          result[key].changed.length +
          result[key].removed.length,
        0,
      )
    : 0;
  const groupCount = (key: "files" | "flows" | "findings") =>
    result
      ? result[key].added.length +
        result[key].changed.length +
        result[key].removed.length
      : 0;
  const detail = error
    ? "Checkpoint comparison could not be read."
    : !result
      ? "Checking your checkpoint…"
      : result.status === "no-checkpoint"
        ? "Save a checkpoint to compare the next report with this one."
        : result.status === "unavailable"
          ? "The saved comparison is unavailable."
          : result.status === "current"
            ? "You’re viewing your saved checkpoint."
            : count
              ? `${groupCount("files")} file ${groupCount("files") === 1 ? "change" : "changes"} · ${groupCount("flows")} journey ${groupCount("flows") === 1 ? "change" : "changes"} · ${groupCount("findings")} finding ${groupCount("findings") === 1 ? "change" : "changes"}`
              : "No changes to files, user journeys, or findings since your checkpoint.";
  const hasChanges = result?.status === "compared" && count > 0;
  const isSaved =
    result?.status === "current" ||
    (result?.status === "compared" && count === 0);
  const label = error
    ? "Retry checkpoint"
    : !result
      ? "Checking checkpoint…"
      : result.status === "no-checkpoint"
        ? "Save checkpoint"
        : result.status === "unavailable"
          ? "Checkpoint unavailable"
          : result.status === "current"
            ? "Checkpoint saved"
            : hasChanges
              ? `${count} ${count === 1 ? "change" : "changes"} since review`
              : "No changes since review";
  const actionHint = error
    ? ` ${error} Click to retry.`
    : result && result.status !== "no-checkpoint"
      ? " Open checkpoint details."
      : "";
  const description = `${label}. ${detail}${actionHint}`;
  const statusClass = error
    ? "is-error"
    : hasChanges || result?.status === "unavailable"
      ? "is-warning"
      : isSaved
        ? "is-saved"
        : "";
  const Icon = error
    ? RefreshCw
    : result?.status === "unavailable"
      ? AlertTriangle
      : isSaved || result?.status === "no-checkpoint"
        ? BookmarkCheck
        : History;
  return (
    <>
      <button
        className={`checkpoint-control ${statusClass}`}
        disabled={saving || (!result && !error)}
        title={description}
        aria-label={description}
        aria-haspopup={
          result && result.status !== "no-checkpoint" ? "dialog" : undefined
        }
        onClick={() => {
          if (error) setAttempt((value) => value + 1);
          else if (result?.status === "no-checkpoint") onCheckpoint();
          else setExpanded(true);
        }}
      >
        <Icon size={15} aria-hidden="true" />
        <span className="checkpoint-control-label">{label}</span>
        {hasChanges ? (
          <span className="checkpoint-control-count" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>
      {expanded && result ? (
        <Dialog
          title="Since your last review"
          wide
          onClose={() => setExpanded(false)}
        >
          <p className="dialog-lead">{detail}</p>
          {result.baseline ? (
            <p className="dialog-lead">
              Compared with your checkpoint saved{" "}
              {new Date(result.baseline.savedAt).toLocaleString()} at{" "}
              <code>{result.baseline.head.slice(0, 8)}</code>.
            </p>
          ) : null}
          {result.reason ? <p className="notice">{result.reason}</p> : null}
          <p className="caption">
            This compares report snapshots and their source evidence. “No longer
            reported” does not mean a finding was fixed.
          </p>
          {result.status === "compared" || result.status === "current" ? (
            <>
              <div className="changes-summary">
                <BookmarkCheck size={17} />
                <strong>
                  {result.unchangedReviewedFileCount} unchanged{" "}
                  {result.unchangedReviewedFileCount === 1
                    ? "file remains"
                    : "files remain"}{" "}
                  reviewed
                </strong>
              </div>
              {groups.map(({ key, label, kind, icon: Icon }) => {
                const group = result[key];
                return (
                  <section className="changes-group" key={key}>
                    <h3>
                      <Icon size={17} />
                      {label}
                      <span>{group.unchanged} unchanged</span>
                    </h3>
                    {!group.added.length &&
                    !group.changed.length &&
                    !group.removed.length ? (
                      <p className="caption">
                        No changes since this checkpoint.
                      </p>
                    ) : null}
                    {(["added", "changed", "removed"] as const).flatMap(
                      (status) =>
                        group[status].map((entity) => {
                          const label =
                            status === "added"
                              ? "New"
                              : status === "changed"
                                ? "Updated"
                                : kind === "finding"
                                  ? "No longer reported"
                                  : "Removed from report";
                          return (
                            <div
                              className="change-entity"
                              key={`${status}:${entity.id}`}
                            >
                              <span className={`change-kind ${status}`}>
                                {label}
                              </span>
                              {status === "removed" ? (
                                <span>{entity.path ?? entity.title}</span>
                              ) : (
                                <button
                                  disabled={saving}
                                  onClick={() => {
                                    setExpanded(false);
                                    onEntity(kind, entity.id);
                                  }}
                                >
                                  {entity.path ?? entity.title}
                                  <ArrowRight size={13} />
                                </button>
                              )}
                            </div>
                          );
                        }),
                    )}
                  </section>
                );
              })}
            </>
          ) : null}
          <div className="changes-actions">
            <button
              className="button"
              disabled={saving}
              onClick={() => {
                setExpanded(false);
                onCheckpoint();
              }}
            >
              <BookmarkCheck size={14} />
              {result.status === "no-checkpoint"
                ? "Save checkpoint"
                : "Update checkpoint"}
            </button>
            {result.baseline && result.baseline.handle !== loaded.handle ? (
              <button
                className="button"
                disabled={saving}
                onClick={() => {
                  setExpanded(false);
                  onBaseline(result.baseline!.handle);
                }}
              >
                Open checkpoint report
                <ArrowRight size={14} />
              </button>
            ) : null}
          </div>
          <p className="caption changes-footnote">
            Updated can include source, explanation, or evidence changes. Saving
            a new checkpoint moves this comparison forward; it does not mark
            files reviewed.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}
