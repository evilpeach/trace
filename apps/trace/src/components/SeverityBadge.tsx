import type { Priority } from "@trace/report-contract";
import { SEVERITIES } from "./finding-severity";
import "./review-details.css";

export function SeverityBadge({ priority }: { priority: Priority | null }) {
  if (priority === null)
    return <span className="severity-badge unclassified">Unclassified</span>;
  const severity = SEVERITIES[priority];
  return (
    <span
      className={`severity-badge severity-${priority.toLowerCase()}`}
      title={`${priority} · ${severity.label} severity. ${severity.urgency}. ${severity.description}`}
    >
      <strong>{priority}</strong>
      <span>{severity.label}</span>
    </span>
  );
}
