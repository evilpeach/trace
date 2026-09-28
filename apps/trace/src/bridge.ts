import { invoke, isTauri } from "@tauri-apps/api/core";
import { createTwoFilesPatch, diffLines } from "diff";
import { exampleReport, parseReport } from "@trace/report-contract";
import type { TraceReport } from "@trace/report-contract";
import sources from "../resources/example-sources.json";
import type {
  Decision,
  EntityKind,
  FileDiff,
  LoadedReport,
  ReviewChanges,
  ReviewEntityChanges,
  ReviewState,
  TraceClient,
} from "./native-types";

function blankState(): ReviewState {
  return { revision: 0, files: {}, flows: {}, findings: {}, checkpoint: null };
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return "The operation could not be completed.";
}
async function nativeCall<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}
const nativeClient: TraceClient = {
  native: true,
  discoverReviewStack: (checkoutId, prUrl) =>
    nativeCall("discover_review_stack", { checkoutId, prUrl }),
  resolveReviewStack: (input) =>
    nativeCall("resolve_review_stack", { ...input }),
  getReviewAgents: () => nativeCall("get_review_agents"),
  launchReviewAgent: (ids, agent, options) =>
    nativeCall("launch_review_agent", { ids, agent, options: options ?? null }),
  listReviewAgentLaunches: () => nativeCall("list_review_agent_launches"),
  getReviewSetup: (checkoutId) =>
    nativeCall("get_review_setup", { checkoutId }),
  resolveReviewComparison: (input) =>
    nativeCall("resolve_review_comparison", { input }),
  prepareReviewRequest: (input) =>
    nativeCall("prepare_review_request", { input }),
  listReviewRequests: () => nativeCall("list_review_requests"),
  checkReviewRequest: (id) => nativeCall("check_review_request", { id }),
  cancelReviewRequest: (id) => nativeCall("cancel_review_request", { id }),
  importReviewRequest: (id) => nativeCall("import_review_request", { id }),
  importReviewRequestPath: (id, path) =>
    nativeCall("import_review_request_path", { id, path }),
  listReports: () => nativeCall("list_reports"),
  listProjects: () => nativeCall("list_projects"),
  addProject: () => nativeCall("add_project"),
  addProjectPath: (path) => nativeCall("add_project_path", { path }),
  discoverReports: () => nativeCall("discover_reports"),
  importReport: () => nativeCall("import_report"),
  importReportPath: (path) => nativeCall("import_report_path", { path }),
  openReport: (handle) => nativeCall("open_report", { handle }),
  loadExample: () => nativeCall("load_example"),
  chooseRepository: (selection = "folder") =>
    nativeCall("choose_repository", { selection }),
  chooseRepositoryPath: (path) =>
    nativeCall("choose_repository_path", { path }),
  attachRepository: (reportHandle, checkoutId) =>
    nativeCall("attach_repository", { reportHandle, checkoutId }),
  readDiff: (reportHandle, fileId) =>
    nativeCall("read_diff", { reportHandle, fileId }),
  getReviewChanges: (reportHandle) =>
    nativeCall("get_review_changes", { reportHandle }),
  setDecision: (
    reportHandle,
    kind,
    entityId,
    decision,
    expectedRevision,
    note,
  ) =>
    nativeCall("set_decision", {
      reportHandle,
      kind,
      entityId,
      decision,
      expectedRevision,
      note: note ?? null,
    }),
  saveCheckpoint: (reportHandle, expectedRevision) =>
    nativeCall("save_checkpoint", { reportHandle, expectedRevision }),
  openFileSource: (reportHandle, fileId, target, side) =>
    nativeCall("open_file_source", {
      reportHandle,
      fileId,
      target,
      side: side ?? null,
    }),
  openSource: (reportHandle, evidenceId) =>
    nativeCall("open_source", { reportHandle, evidenceId }),
};

/** Browser development is explicitly an in-memory report reader, not a native adapter. */
export function createBrowserClient(): TraceClient {
  const reports = new Map<string, LoadedReport>();
  const reviews = new Map<
    string,
    { activeHandle: string; state: ReviewState }
  >();
  const lineage = (report: TraceReport) =>
    JSON.stringify([report.repository.id, report.reportId]);
  async function digest(value: unknown) {
    const canonical = (item: unknown): unknown =>
      Array.isArray(item)
        ? item.map(canonical)
        : item !== null && typeof item === "object"
          ? Object.fromEntries(
              Object.entries(item)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonical(entry)]),
            )
          : item;
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(canonical(value))),
    );
    return Array.from(new Uint8Array(hash), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
  }
  function load(handle: string) {
    const value = reports.get(handle);
    if (!value)
      throw new Error("This report is no longer open. Import it again.");
    return value;
  }
  async function fingerprints(report: TraceReport) {
    const result = new Map<string, string>();
    const identity = (id: string) => ({
      // A browser cannot verify Git blobs. Keep its progress commit-bound.
      comparison: report.comparison,
      file: [...report.files, ...report.contextFiles].find(
        (file) => file.id === id,
      ),
    });
    for (const file of report.files)
      result.set(
        `file:${file.id}`,
        await digest({
          entity: file,
          round: report.rounds.find((round) => round.id === file.roundId),
          code: identity(file.id),
        }),
      );
    for (const flow of report.flows)
      result.set(
        `flow:${flow.id}`,
        await digest({
          entity: flow,
          code: flow.fileIds.map(identity),
          evidence: report.evidence.filter((anchor) =>
            flow.fileIds.includes(anchor.fileId),
          ),
          // Keep legacy fingerprints unchanged when no designation applies.
          ...(report.mainJourney?.flowId === flow.id
            ? { mainJourney: report.mainJourney }
            : {}),
        }),
      );
    for (const finding of report.findings) {
      const ids = new Set([
        finding.primaryEvidenceId,
        ...finding.trace.flatMap((step) => step.evidenceIds),
      ]);
      result.set(
        `finding:${finding.id}`,
        await digest({
          entity: finding,
          evidence: report.evidence
            .filter((anchor) => ids.has(anchor.id))
            .map((anchor) => ({ anchor, code: identity(anchor.fileId) })),
          flows: finding.flowIds.map((id) => result.get(`flow:${id}`)),
        }),
      );
    }
    return result;
  }
  async function snapshot(handle: string) {
    const value = structuredClone(load(handle));
    const current = await fingerprints(value.report);
    for (const [kind, collection] of [
      ["file", "files"],
      ["flow", "flows"],
      ["finding", "findings"],
    ] as const) {
      for (const [id, decision] of Object.entries(value.state[collection])) {
        const fingerprint = current.get(`${kind}:${id}`);
        if (fingerprint) decision.stale = decision.fingerprint !== fingerprint;
        else delete value.state[collection][id];
      }
    }
    return value;
  }
  async function open(handle: string) {
    const report = load(handle);
    const review = reviews.get(lineage(report.report))!;
    if (review.activeHandle !== handle) {
      review.activeHandle = handle;
      review.state.revision++;
    }
    return snapshot(handle);
  }
  async function install(report: TraceReport) {
    const hash = await digest(report);
    const handle = `preview:${hash}`;
    const previous = reports.get(handle);
    if (previous) return open(handle);
    const review = reviews.get(lineage(report));
    const value: LoadedReport = {
      handle,
      digest: hash,
      report,
      state: review?.state ?? blankState(),
      repository: null,
    };
    reports.set(handle, value);
    reviews.set(lineage(report), { activeHandle: handle, state: value.state });
    if (review) value.state.revision++;
    return snapshot(handle);
  }
  function checkRevision(report: LoadedReport, expected: number) {
    if (reviews.get(lineage(report.report))?.activeHandle !== report.handle)
      throw new Error("Reopen this report before changing its progress.");
    if (expected !== report.state.revision)
      throw new Error(
        "Review progress changed. Reopen the report and try again.",
      );
  }
  return {
    native: false,
    async discoverReviewStack() {
      throw new Error("PR discovery requires the Trace desktop app.");
    },
    async resolveReviewStack() {
      throw new Error("PR comparisons require the Trace desktop app.");
    },
    async getReviewAgents() {
      return [];
    },
    async launchReviewAgent() {
      throw new Error("Starting a CLI requires the Trace desktop app.");
    },
    async listReviewAgentLaunches() {
      return [];
    },
    async getReviewSetup() {
      throw new Error(
        "Preparing a review requires the Trace desktop app and a connected checkout.",
      );
    },
    async resolveReviewComparison() {
      throw new Error(
        "Resolving Git comparisons requires the Trace desktop app.",
      );
    },
    async prepareReviewRequest() {
      throw new Error("External-agent handoff requires the Trace desktop app.");
    },
    async listReviewRequests() {
      return [];
    },
    async checkReviewRequest() {
      throw new Error(
        "Checking a local report requires the Trace desktop app.",
      );
    },
    async cancelReviewRequest() {
      throw new Error("Review requests are managed in the Trace desktop app.");
    },
    async importReviewRequest() {
      throw new Error(
        "Importing a review request requires the Trace desktop app.",
      );
    },
    async importReviewRequestPath() {
      throw new Error(
        "Importing a review request requires the Trace desktop app.",
      );
    },
    async listReports() {
      return [...reports.values()].map((v) => ({
        projectId: v.report.repository.id,
        reportId: v.report.reportId,
        prNumber: v.report.pullRequest?.number ?? null,
        prUrl: v.report.pullRequest?.url ?? null,
        handle: v.handle,
        title: v.report.title,
        repositoryName: v.report.repository.name,
        generatedAt: v.report.generatedAt,
        head: v.report.comparison.head.oid,
      }));
    },
    async listProjects() {
      const projects = new Map<
        string,
        import("./native-types").ProjectSummary
      >();
      for (const value of reports.values()) {
        const repository = value.report.repository;
        const project = projects.get(repository.id) ?? {
          id: repository.id,
          name: repository.name,
          repositoryId: repository.id,
          repositories: [],
          reportCount: 0,
        };
        project.reportCount++;
        projects.set(repository.id, project);
      }
      return [...projects.values()];
    },
    async addProject() {
      throw new Error("Adding a local project requires the Trace desktop app.");
    },
    async addProjectPath() {
      throw new Error("Adding a local project requires the Trace desktop app.");
    },
    async discoverReports() {
      return { imported: 0, skipped: 0, scanned: 0, issues: [] };
    },
    async openReport(handle) {
      return open(handle);
    },
    async getReviewChanges(handle) {
      const current = await snapshot(handle);
      const empty = (): ReviewEntityChanges => ({
        added: [],
        changed: [],
        removed: [],
        unchanged: 0,
      });
      const result: ReviewChanges = {
        status: "no-checkpoint",
        baseline: null,
        reason: null,
        files: empty(),
        flows: empty(),
        findings: empty(),
        unchangedReviewedFileCount: 0,
      };
      const checkpoint = current.state.checkpoint;
      if (!checkpoint) return result;
      const baseline = [...reports.values()].find(
        (candidate) =>
          candidate.digest === checkpoint.digest &&
          lineage(candidate.report) === lineage(current.report),
      );
      if (
        !baseline ||
        baseline.report.comparison.head.oid !== checkpoint.head
      ) {
        result.status = "unavailable";
        result.reason =
          "The checkpoint snapshot is not available in this report's project and history.";
        return result;
      }
      const before = await fingerprints(baseline.report);
      const after = await fingerprints(current.report);
      for (const [kind, collection] of [
        ["file", "files"],
        ["flow", "flows"],
        ["finding", "findings"],
      ] as const) {
        const entity = (value: {
          id: string;
          title?: string;
          path?: string;
        }) => ({
          id: value.id,
          title: value.path ?? value.title ?? value.id,
          ...(value.path ? { path: value.path } : {}),
        });
        for (const value of current.report[collection]) {
          const key = `${kind}:${value.id}`;
          if (!before.has(key)) result[collection].added.push(entity(value));
          else if (before.get(key) === after.get(key))
            result[collection].unchanged++;
          else result[collection].changed.push(entity(value));
        }
        for (const value of baseline.report[collection]) {
          if (!after.has(`${kind}:${value.id}`))
            result[collection].removed.push(entity(value));
        }
      }
      result.status =
        baseline.digest === current.digest ? "current" : "compared";
      result.baseline = { ...checkpoint, handle: baseline.handle };
      result.unchangedReviewedFileCount = Object.entries(
        current.state.files,
      ).filter(
        ([id, decision]) =>
          decision.decision === "reviewed" &&
          !decision.stale &&
          before.has(`file:${id}`) &&
          before.get(`file:${id}`) === after.get(`file:${id}`),
      ).length;
      return result;
    },
    async importReport() {
      const file = await new Promise<File | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,.trace.json";
        input.addEventListener(
          "change",
          () => {
            resolve(input.files?.[0] ?? null);
            input.remove();
          },
          { once: true },
        );
        input.addEventListener(
          "cancel",
          () => {
            resolve(null);
            input.remove();
          },
          { once: true },
        );
        input.hidden = true;
        document.body.append(input);
        input.click();
      });
      if (!file) return null;
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Report exceeds the 20 MiB import limit.");
      const parsed = parseReport(await file.text());
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      return install(parsed.report);
    },
    async loadExample() {
      return install(structuredClone(exampleReport));
    },
    async importReportPath() {
      throw new Error("Importing a local path requires the Trace desktop app.");
    },
    async chooseRepositoryPath() {
      throw new Error(
        "Connecting a Git repository requires the Trace desktop app.",
      );
    },
    async chooseRepository() {
      throw new Error(
        "Connecting a Git repository requires the Trace desktop app.",
      );
    },
    async attachRepository() {
      throw new Error(
        "Connecting a Git repository requires the Trace desktop app.",
      );
    },
    async readDiff(handle, fileId) {
      const report = load(handle).report;
      const file = [...report.files, ...report.contextFiles].find(
        (f) => f.id === fileId,
      );
      if (!file) throw new Error("This file is not in the report.");
      const demo =
        report.provenance.mode === "synthetic-example" &&
        load(handle).digest === (await digest(exampleReport))
          ? sources[fileId as keyof typeof sources]
          : undefined;
      if (!demo)
        throw new Error(
          "Connect a local checkout in the desktop app to read these exact Git snapshots.",
        );
      const changes = diffLines(demo.base, demo.head);
      const result: FileDiff = {
        fileId,
        base: {
          path: file.path,
          oid: report.comparison.base.oid,
          blobOid: null,
          text: demo.base,
          kind: "text",
          reason: "Illustrative example source",
        },
        head: {
          path: file.path,
          oid: report.comparison.head.oid,
          blobOid: null,
          text: demo.head,
          kind: "text",
          reason: "Illustrative example source",
        },
        patch: createTwoFilesPatch(file.path, file.path, demo.base, demo.head),
        additions: changes.reduce(
          (n, c) => n + (c.added ? (c.count ?? 0) : 0),
          0,
        ),
        deletions: changes.reduce(
          (n, c) => n + (c.removed ? (c.count ?? 0) : 0),
          0,
        ),
      };
      return result;
    },
    async setDecision(
      handle,
      kind: EntityKind,
      entityId,
      decision,
      expectedRevision,
      note,
    ) {
      const report = load(handle);
      checkRevision(report, expectedRevision);
      const collection =
        kind === "file"
          ? report.report.files
          : kind === "flow"
            ? report.report.flows
            : report.report.findings;
      const entity = collection.find((e) => e.id === entityId);
      if (!entity)
        throw new Error("The selected item is not part of this report.");
      const valid =
        kind === "finding"
          ? ["confirmed", "fixed", "disputed", "needs-test", null]
          : ["reviewed", "unreviewed"];
      if (!valid.includes(decision))
        throw new Error("Unsupported review decision.");
      const fingerprint = (await fingerprints(report.report)).get(
        `${kind}:${entityId}`,
      )!;
      checkRevision(report, expectedRevision);
      const key =
        kind === "file" ? "files" : kind === "flow" ? "flows" : "findings";
      if (decision === null || decision === "unreviewed")
        delete report.state[key][entityId];
      else {
        const value: Decision = {
          decision,
          fingerprint,
          updatedAt: new Date().toISOString(),
          note,
          stale: false,
        };
        report.state[key][entityId] = value;
      }
      report.state.revision++;
      return (await snapshot(handle)).state;
    },
    async saveCheckpoint(handle, expectedRevision) {
      const report = load(handle);
      checkRevision(report, expectedRevision);
      report.state.checkpoint = {
        head: report.report.comparison.head.oid,
        digest: report.digest,
        savedAt: new Date().toISOString(),
      };
      report.state.revision++;
      return (await snapshot(handle)).state;
    },
    async openFileSource() {
      return {
        opened: false,
        reason: "Opening verified source files requires the Trace desktop app.",
        path: null,
        line: null,
      };
    },
    async openSource() {
      return {
        opened: false,
        reason:
          "Opening a verified local source line requires the Trace desktop app.",
        path: null,
        line: null,
      };
    },
  };
}
export const client: TraceClient = isTauri()
  ? nativeClient
  : createBrowserClient();
