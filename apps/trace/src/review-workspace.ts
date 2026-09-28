import { useSyncExternalStore } from "react";
import type { TraceReport } from "../../../packages/report-contract/src/index";
import type { LoadedReport, ReportSummary } from "./native-types";
import { groupPullRequests } from "./projects";

export interface ReviewPosition {
  view: "overview" | "files" | "flows" | "findings";
  fileId: string;
  flowId: string;
  findingId: string;
  evidenceId: string | null;
}
export interface FlowSelection {
  nodeId: string | null;
  revision: "before" | "after";
  evidenceId: string | null;
}
export interface ReviewSession {
  position: ReviewPosition;
  fileQuery: string;
  roundFilter: string;
  flowFilter: string;
  unreviewedOnly: boolean;
  fileLayout: "single" | "stack";
  scrollY: number;
  flowSelection: FlowSelection;
}
export interface ReviewOrganization {
  pinned: boolean;
  archived: boolean;
  visitedHandles: string[];
  knownHandles: string[];
  unreadHandles: string[];
  lastVisitedHandle: string | null;
  completedHandle: string | null;
  updatedAt: number;
}
interface StoredSession extends ReviewSession {
  updatedAt: number;
}
export interface ReviewWorkspace {
  version: 1;
  projects: Record<
    string,
    { pinned: boolean; archived: boolean; updatedAt: number }
  >;
  reviews: Record<string, ReviewOrganization>;
  sessions: Record<string, StoredSession>;
}
export type ReviewStatus = "new" | "updated" | "in-progress" | "done";
export const REVIEW_WORKSPACE_KEY = "trace:review-workspace:v1";
export const reviewStatusLabel: Record<ReviewStatus, string> = {
  new: "New",
  updated: "Updated",
  "in-progress": "In progress",
  done: "Done",
};
const emptyWorkspace = (): ReviewWorkspace => ({
  version: 1,
  projects: {},
  reviews: {},
  sessions: {},
});
const defaultFlowSelection = (): FlowSelection => ({
  nodeId: null,
  revision: "after",
  evidenceId: null,
});
const defaultSession = (): ReviewSession => ({
  position: {
    view: "overview",
    fileId: "",
    flowId: "",
    findingId: "",
    evidenceId: null,
  },
  fileQuery: "",
  roundFilter: "all",
  flowFilter: "all",
  unreviewedOnly: false,
  fileLayout: "single",
  scrollY: 0,
  flowSelection: defaultFlowSelection(),
});
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const shortString = (value: unknown, fallback = "", limit = 512): string =>
  typeof value === "string" ? value.slice(0, limit) : fallback;
const nullableId = (value: unknown) =>
  typeof value === "string" && value.length ? shortString(value) : null;
const timestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
function normalizeSession(value: unknown): ReviewSession {
  const raw = record(value),
    position = record(raw.position),
    flow = record(raw.flowSelection);
  return {
    position: {
      view: ["files", "flows", "findings"].includes(String(position.view))
        ? (position.view as ReviewPosition["view"])
        : "overview",
      fileId: shortString(position.fileId),
      flowId: shortString(position.flowId),
      findingId: shortString(position.findingId),
      evidenceId: nullableId(position.evidenceId),
    },
    fileQuery: shortString(raw.fileQuery, "", 200),
    roundFilter: shortString(raw.roundFilter, "all"),
    flowFilter: shortString(raw.flowFilter, "all"),
    unreviewedOnly: raw.unreviewedOnly === true,
    fileLayout: raw.fileLayout === "stack" ? "stack" : "single",
    scrollY: Math.min(10_000_000, timestamp(raw.scrollY)),
    flowSelection: {
      nodeId: nullableId(flow.nodeId),
      revision: flow.revision === "before" ? "before" : "after",
      evidenceId: nullableId(flow.evidenceId),
    },
  };
}
function boundedEntries(value: unknown, limit: number) {
  return Object.entries(record(value))
    .filter(
      ([id]) =>
        id.length > 0 &&
        id.length <= 1024 &&
        !["__proto__", "constructor", "prototype"].includes(id),
    )
    .sort(
      (a, b) =>
        timestamp(record(b[1]).updatedAt) - timestamp(record(a[1]).updatedAt),
    )
    .slice(0, limit);
}
/** Invalid versions and malformed browser storage never become review decisions. */
export function normalizeReviewWorkspace(value: unknown): ReviewWorkspace {
  const raw = record(value);
  if (raw.version !== 1) return emptyWorkspace();
  return {
    version: 1,
    projects: Object.fromEntries(
      boundedEntries(raw.projects, 250).map(([id, value]) => {
        const item = record(value);
        return [
          id,
          {
            pinned: item.pinned === true,
            archived: item.archived === true,
            updatedAt: timestamp(item.updatedAt),
          },
        ];
      }),
    ),
    reviews: Object.fromEntries(
      boundedEntries(raw.reviews, 1000).map(([id, value]) => {
        const item = record(value);
        const handles = (values: unknown) =>
          Array.isArray(values)
            ? [
                ...new Set(
                  values.filter(
                    (handle): handle is string =>
                      typeof handle === "string" &&
                      handle.length > 0 &&
                      handle.length <= 512,
                  ),
                ),
              ].slice(-500)
            : [];
        const visited = handles(item.visitedHandles),
          known = handles(item.knownHandles),
          unread = handles(item.unreadHandles).filter(
            (handle) => !visited.includes(handle),
          );
        const last = nullableId(item.lastVisitedHandle),
          completed = nullableId(item.completedHandle);
        return [
          id,
          {
            pinned: item.pinned === true,
            archived: item.archived === true,
            visitedHandles: visited,
            knownHandles: known,
            unreadHandles: unread,
            lastVisitedHandle:
              last && visited.includes(last) ? last : (visited.at(-1) ?? null),
            completedHandle: completed,
            updatedAt: timestamp(item.updatedAt),
          },
        ];
      }),
    ),
    sessions: Object.fromEntries(
      boundedEntries(raw.sessions, 400).map(([id, value]) => [
        id,
        {
          ...normalizeSession(value),
          updatedAt: timestamp(record(value).updatedAt),
        },
      ]),
    ),
  };
}
export function readReviewWorkspace(
  storage: Pick<Storage, "getItem">,
): ReviewWorkspace {
  try {
    const text = storage.getItem(REVIEW_WORKSPACE_KEY);
    return text && text.length <= 4_000_000
      ? normalizeReviewWorkspace(JSON.parse(text))
      : emptyWorkspace();
  } catch {
    return emptyWorkspace();
  }
}
/** Keep the persisted cache below its read limit and typical WebView storage quotas. */
export function compactReviewWorkspace(
  value: ReviewWorkspace,
): ReviewWorkspace {
  const next = normalizeReviewWorkspace(value);
  let size = JSON.stringify(next).length;
  for (const collection of [next.sessions, next.reviews, next.projects]) {
    if (size <= 3_500_000) break;
    const oldest = Object.entries(collection).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (const [key, entry] of oldest) {
      if (size <= 3_500_000) break;
      delete collection[key];
      size -= JSON.stringify(key).length + JSON.stringify(entry).length + 1;
    }
  }
  return next;
}
type ReportIdentity = LoadedReport | ReportSummary;
export function reviewKey(item: ReportIdentity): string {
  const project = "report" in item ? item.report.repository.id : item.projectId;
  const pr = "report" in item ? item.report.pullRequest?.number : item.prNumber;
  const reportId = "report" in item ? item.report.reportId : item.reportId;
  return `${project}:${pr == null ? `branch:${reportId}` : `pr:${pr}`}`;
}
const newReview = (): ReviewOrganization => ({
  pinned: false,
  archived: false,
  visitedHandles: [],
  knownHandles: [],
  unreadHandles: [],
  lastVisitedHandle: null,
  completedHandle: null,
  updatedAt: 0,
});
export function getReviewStatus(
  workspace: ReviewWorkspace,
  reports: ReportSummary[],
): ReviewStatus {
  const latest = groupPullRequests(reports)[0]?.reports[0];
  if (!latest) return "new";
  const item = workspace.reviews[reviewKey(latest)];
  if (!item || (!item.visitedHandles.length && !item.completedHandle))
    return "new";
  if (reports.some((report) => item.unreadHandles.includes(report.handle)))
    return "updated";
  if (item.completedHandle === latest.handle) return "done";
  if (
    !item.visitedHandles.includes(latest.handle) &&
    !item.knownHandles.includes(latest.handle)
  )
    return "updated";
  return "in-progress";
}
export function reviewOpenTarget(
  workspace: ReviewWorkspace,
  reports: ReportSummary[],
): ReportSummary | undefined {
  const sorted = groupPullRequests(reports)[0]?.reports ?? [];
  if (!sorted.length) return undefined;
  const review = workspace.reviews[reviewKey(sorted[0])];
  return (
    sorted.find((report) => review?.unreadHandles.includes(report.handle)) ??
    (getReviewStatus(workspace, sorted) === "updated"
      ? sorted[0]
      : sorted.find((report) => report.handle === review?.lastVisitedHandle)) ??
    sorted[0]
  );
}
/** One useful return target per visible PR, ordered by the most recent review activity. */
export function recentReviewTargets(
  workspace: ReviewWorkspace,
  reports: ReportSummary[],
): ReportSummary[] {
  return groupPullRequests(reports)
    .filter((group) => {
      const projectId = group.reports[0]?.projectId;
      return (
        !workspace.reviews[group.id]?.archived &&
        !workspace.projects[projectId]?.archived
      );
    })
    .map((group) => ({
      report: reviewOpenTarget(workspace, group.reports)!,
      updatedAt: workspace.reviews[group.id]?.updatedAt ?? 0,
    }))
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        Date.parse(b.report.generatedAt) - Date.parse(a.report.generatedAt) ||
        a.report.handle.localeCompare(b.report.handle),
    )
    .map(({ report }) => report);
}
/** Existing history is a baseline on first visit. Later arrivals remain unread regardless of timestamp. */
export function withSyncedReviewInbox(
  workspace: ReviewWorkspace,
  reports: ReportSummary[],
  now = Date.now(),
): ReviewWorkspace {
  const reviews = { ...workspace.reviews };
  let changed = false;
  for (const group of groupPullRequests(reports)) {
    const review = reviews[group.id] ?? newReview();
    const handles = group.reports.map((report) => report.handle);
    const added = handles.filter(
      (handle) => !review.knownHandles.includes(handle),
    );
    if (!added.length) continue;
    const unread =
      review.visitedHandles.length || review.completedHandle
        ? added.filter((handle) => !review.visitedHandles.includes(handle))
        : [];
    reviews[group.id] = {
      ...review,
      knownHandles: [...review.knownHandles, ...added],
      unreadHandles: [...review.unreadHandles, ...unread],
      updatedAt: now,
    };
    changed = true;
  }
  return changed
    ? normalizeReviewWorkspace({ ...workspace, reviews })
    : workspace;
}
export function withReportVisited(
  workspace: ReviewWorkspace,
  item: ReportIdentity,
  now = Date.now(),
): ReviewWorkspace {
  const key = reviewKey(item),
    review = workspace.reviews[key] ?? newReview();
  return normalizeReviewWorkspace({
    ...workspace,
    reviews: {
      ...workspace.reviews,
      [key]: {
        ...review,
        visitedHandles: [
          ...review.visitedHandles.filter((handle) => handle !== item.handle),
          item.handle,
        ],
        knownHandles: [
          ...review.knownHandles.filter((handle) => handle !== item.handle),
          item.handle,
        ],
        unreadHandles: review.visitedHandles.length
          ? review.unreadHandles.filter((handle) => handle !== item.handle)
          : [],
        lastVisitedHandle: item.handle,
        updatedAt: now,
      },
    },
  });
}
export function withPRDone(
  workspace: ReviewWorkspace,
  item: ReportIdentity,
  done: boolean,
  now = Date.now(),
): ReviewWorkspace {
  const next = withReportVisited(workspace, item, now),
    key = reviewKey(item);
  return {
    ...next,
    reviews: {
      ...next.reviews,
      [key]: {
        ...next.reviews[key],
        completedHandle: done ? item.handle : null,
      },
    },
  };
}
/** Restore identifiers only when they still exist; a new snapshot always exposes the full inventory. */
export function reconcileReviewSession(
  report: TraceReport,
  value: ReviewSession | undefined,
  regenerated = false,
): { session: ReviewSession; notice?: string } {
  const session = value ? normalizeSession(value) : defaultSession();
  const old = JSON.stringify(session);
  const files = [...report.files, ...report.contextFiles];
  if (!files.some((file) => file.id === session.position.fileId))
    session.position.fileId = report.files[0]?.id ?? "";
  if (!report.flows.some((flow) => flow.id === session.position.flowId))
    session.position.flowId = report.flows[0]?.id ?? "";
  if (
    !report.findings.some(
      (finding) => finding.id === session.position.findingId,
    )
  ) {
    session.position.findingId =
      [...report.findings].sort((a, b) =>
        (a.priority ?? "P4").localeCompare(b.priority ?? "P4"),
      )[0]?.id ?? "";
  }
  const anchor = report.evidence.find(
    (item) => item.id === session.position.evidenceId,
  );
  if (!anchor || regenerated) session.position.evidenceId = null;
  else session.position.fileId = anchor.fileId;
  if (!report.rounds.some((round) => round.id === session.roundFilter))
    session.roundFilter = "all";
  if (!report.flows.some((flow) => flow.id === session.flowFilter))
    session.flowFilter = "all";
  const flow = report.flows.find((item) => item.id === session.position.flowId);
  const graph = flow?.[session.flowSelection.revision].graph;
  const node = graph?.nodes.find(
    (item) => item.id === session.flowSelection.nodeId,
  );
  if (!node || regenerated) session.flowSelection.nodeId = null;
  const evidenceIds = node
    ? [
        ...node.evidenceIds,
        ...(graph?.edges
          .filter((edge) => edge.from === node.id)
          .flatMap((edge) => edge.evidenceIds) ?? []),
      ]
    : [];
  const selectedEvidence = report.evidence.find(
    (anchor) => anchor.id === session.flowSelection.evidenceId,
  );
  if (
    !evidenceIds.includes(session.flowSelection.evidenceId ?? "") ||
    selectedEvidence?.side !==
      (session.flowSelection.revision === "before" ? "base" : "head") ||
    regenerated
  )
    session.flowSelection.evidenceId = null;
  if (regenerated) {
    session.fileQuery = "";
    session.roundFilter = "all";
    session.flowFilter = "all";
    session.unreviewedOnly = false;
    session.scrollY = 0;
  }
  const notice = regenerated
    ? "Opened a different report snapshot. Your section is restored; filters and reading position were reset so new changes remain visible."
    : value && old !== JSON.stringify(session)
      ? "Restored your review. Some saved selections are no longer available and were reset."
      : undefined;
  return { session, ...(notice ? { notice } : {}) };
}

let snapshot = emptyWorkspace();
let initialized = false;
const listeners = new Set<() => void>();
export function initializeReviewWorkspace() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    snapshot = readReviewWorkspace(window.localStorage);
  } catch {
    /* Private storage is optional. */
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== REVIEW_WORKSPACE_KEY && event.key !== null) return;
    try {
      snapshot = readReviewWorkspace(window.localStorage);
    } catch {
      snapshot = emptyWorkspace();
    }
    listeners.forEach((listener) => listener());
  });
}
export function getReviewWorkspace() {
  initializeReviewWorkspace();
  return snapshot;
}
function save(next: ReviewWorkspace) {
  snapshot = compactReviewWorkspace(next);
  try {
    window.localStorage.setItem(REVIEW_WORKSPACE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Keep session changes usable when persistence is unavailable. */
  }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useReviewWorkspace = () =>
  useSyncExternalStore(subscribe, getReviewWorkspace);
export function visitReport(item: ReportIdentity) {
  save(withReportVisited(getReviewWorkspace(), item));
}
export function syncReviewInbox(reports: ReportSummary[]) {
  const current = getReviewWorkspace(),
    next = withSyncedReviewInbox(current, reports);
  if (next !== current) save(next);
}
export function setPRDone(item: ReportIdentity, done: boolean) {
  save(withPRDone(getReviewWorkspace(), item, done));
}
export function setReviewOrganization(
  key: string,
  patch: Partial<Pick<ReviewOrganization, "pinned" | "archived">>,
) {
  const current = getReviewWorkspace();
  save({
    ...current,
    reviews: {
      ...current.reviews,
      [key]: {
        ...(current.reviews[key] ?? newReview()),
        ...patch,
        updatedAt: Date.now(),
      },
    },
  });
}
export function setProjectOrganization(
  id: string,
  patch: { pinned?: boolean; archived?: boolean },
) {
  const current = getReviewWorkspace();
  save({
    ...current,
    projects: {
      ...current.projects,
      [id]: {
        ...(current.projects[id] ?? { pinned: false, archived: false }),
        ...patch,
        updatedAt: Date.now(),
      },
    },
  });
}
export function saveReviewSession(item: LoadedReport, session: ReviewSession) {
  const current = getReviewWorkspace();
  const normalized = normalizeSession(session);
  const previous = current.sessions[item.handle];
  if (
    previous &&
    JSON.stringify(normalized) === JSON.stringify(normalizeSession(previous))
  )
    return;
  save({
    ...current,
    sessions: {
      ...current.sessions,
      [item.handle]: { ...normalized, updatedAt: Date.now() },
    },
  });
}
export function restoreReviewSession(item: LoadedReport): {
  session: ReviewSession;
  notice?: string;
} {
  const current = getReviewWorkspace(),
    exact = current.sessions[item.handle];
  const previous = current.reviews[reviewKey(item)]?.lastVisitedHandle;
  return reconcileReviewSession(
    item.report,
    exact ?? (previous ? current.sessions[previous] : undefined),
    !exact && !!previous && previous !== item.handle,
  );
}
