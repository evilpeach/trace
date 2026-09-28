import type { Priority } from "@trace/report-contract";

export const SEVERITIES = {
  P0: {
    label: "Critical",
    urgency: "Address immediately",
    description:
      "A blocking problem with potentially severe consequences. Resolve it before proceeding.",
  },
  P1: {
    label: "High",
    urgency: "Fix before release",
    description:
      "A significant correctness, security, or user-facing problem that deserves prompt attention.",
  },
  P2: {
    label: "Medium",
    urgency: "Plan a fix",
    description:
      "A meaningful defect with more limited impact or triggering conditions. It should be fixed, but does not carry the urgency of P0 or P1.",
  },
  P3: {
    label: "Low",
    urgency: "Fix when practical",
    description:
      "A lower-impact issue that can usually be handled after more consequential problems.",
  },
} satisfies Record<
  Priority,
  { label: string; urgency: string; description: string }
>;

/** Stable severity ordering: preserve authored order within the same level. */
export function sortFindingsBySeverity<T extends { priority: Priority | null }>(
  findings: readonly T[],
): T[] {
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...findings].sort(
    (a, b) =>
      (a.priority === null ? 4 : rank[a.priority]) -
      (b.priority === null ? 4 : rank[b.priority]),
  );
}
