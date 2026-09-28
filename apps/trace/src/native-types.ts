import type { TraceReport } from "../../../packages/report-contract/src/index";
export type EntityKind = "file" | "flow" | "finding";
export type Disposition = "confirmed" | "fixed" | "disputed" | "needs-test";
export interface Decision {
  decision: string;
  fingerprint: string;
  updatedAt: string;
  note?: string;
  stale?: boolean;
}
export interface ReviewState {
  revision: number;
  files: Record<string, Decision>;
  flows: Record<string, Decision>;
  findings: Record<string, Decision>;
  checkpoint: { head: string; savedAt: string; digest: string } | null;
}
export interface ReviewChangeEntity {
  id: string;
  title: string;
  path?: string;
}
export interface ReviewEntityChanges {
  added: ReviewChangeEntity[];
  changed: ReviewChangeEntity[];
  removed: ReviewChangeEntity[];
  unchanged: number;
}
export interface ReviewChanges {
  status: "no-checkpoint" | "current" | "compared" | "unavailable";
  baseline: {
    handle: string;
    head: string;
    digest: string;
    savedAt: string;
  } | null;
  reason: string | null;
  files: ReviewEntityChanges;
  flows: ReviewEntityChanges;
  findings: ReviewEntityChanges;
  unchangedReviewedFileCount: number;
}
export interface RepositoryInfo {
  checkoutId: string;
  repositoryId: string;
  displayPath: string;
}
export interface LoadedReport {
  handle: string;
  digest: string;
  report: TraceReport;
  state: ReviewState;
  repository: RepositoryInfo | null;
}
export interface ProjectSummary {
  id: string;
  name: string;
  repositoryId: string;
  repositories: RepositoryInfo[];
  reportCount: number;
}
export interface DiscoveryResult {
  imported: number;
  skipped: number;
  scanned: number;
  issues: { projectId: string; path: string; message: string }[];
}
export interface ReportSummary {
  projectId: string;
  reportId: string;
  prNumber: number | null;
  prUrl: string | null;
  handle: string;
  title: string;
  repositoryName: string;
  generatedAt: string;
  head: string;
}
export interface DiffSide {
  path: string;
  oid: string;
  blobOid: string | null;
  text: string | null;
  kind:
    | "text"
    | "absent"
    | "binary"
    | "large"
    | "symlink"
    | "submodule"
    | "unavailable";
  reason: string | null;
}
export interface FileDiff {
  fileId: string;
  base: DiffSide;
  head: DiffSide;
  patch: string;
  additions: number | null;
  deletions: number | null;
}
export interface OpenSourceResult {
  opened: boolean;
  reason: string | null;
  path: string | null;
  line: number | null;
}
export interface ReviewSetup {
  checkoutId: string;
  headRef: string;
  defaultBaseRef: string | null;
  baseSource: "previous-report" | "remote-default" | "none";
}
export interface ResolveReviewInput {
  checkoutId: string;
  kind: "branch" | "pull-request";
  baseRef?: string;
  headRef?: string;
  prUrl?: string;
  previousReportHandle?: string;
}
export interface ReviewComparison {
  token: string;
  checkoutId: string;
  repositoryId: string;
  repositoryName: string;
  base: { oid: string; label: string };
  head: { oid: string; label: string };
  changedFileCount: number;
  pr: { number: number; url: string; title: string } | null;
  reportId: string;
  priorReportHandle: string | null;
}
export interface ReviewRequest {
  id: string;
  comparison: ReviewComparison;
  focus: string;
  prompt: string;
  outputPath: string;
  toolkitPath: string;
  createdAt: string;
  status: "waiting" | "needs-attention" | "ready" | "cancelled";
  error: string | null;
  reportHandle: string | null;
}
export interface StackPullRequest {
  number: number;
  url: string;
  title: string;
  baseRefName: string;
  headRefName: string;
}
export interface ReviewStack {
  seedNumber: number;
  pullRequests: StackPullRequest[];
  warnings: string[];
}
export type ReviewAgentId = "codex" | "claude";
export interface ReviewAgentModel {
  id: string;
  name: string;
  efforts: string[];
  defaultEffort: string | null;
}
export interface ReviewAgentOptions {
  model?: string | null;
  effort?: string | null;
}
export interface ReviewAgent {
  id: ReviewAgentId;
  name: string;
  path: string | null;
  available: boolean;
  reason: string | null;
  models: ReviewAgentModel[];
  modelSource: string;
  modelNote: string | null;
}
export interface AgentLaunch {
  id: string;
  agent: ReviewAgentId;
  requestIds: string[];
  launchedAt: string;
  terminalPath: string;
  model?: string | null;
  effort?: string | null;
}
export interface TraceClient {
  readonly native: boolean;
  discoverReviewStack(checkoutId: string, prUrl: string): Promise<ReviewStack>;
  resolveReviewStack(input: {
    checkoutId: string;
    urls: string[];
    previousReportHandle?: string;
  }): Promise<ReviewComparison[]>;
  getReviewAgents(): Promise<ReviewAgent[]>;
  launchReviewAgent(ids: string[], agent: ReviewAgentId, options?: ReviewAgentOptions): Promise<AgentLaunch>;
  listReviewAgentLaunches(): Promise<AgentLaunch[]>;
  getReviewSetup(checkoutId: string): Promise<ReviewSetup>;
  resolveReviewComparison(input: ResolveReviewInput): Promise<ReviewComparison>;
  prepareReviewRequest(input: {
    comparisonToken: string;
    focus: string;
  }): Promise<ReviewRequest>;
  listReviewRequests(): Promise<ReviewRequest[]>;
  checkReviewRequest(id: string): Promise<ReviewRequest>;
  cancelReviewRequest(id: string): Promise<ReviewRequest>;
  importReviewRequest(id: string): Promise<ReviewRequest | null>;
  importReviewRequestPath(id: string, path: string): Promise<ReviewRequest>;
  listReports(): Promise<ReportSummary[]>;
  listProjects(): Promise<ProjectSummary[]>;
  addProject(): Promise<ProjectSummary | null>;
  addProjectPath(path: string): Promise<ProjectSummary>;
  discoverReports(): Promise<DiscoveryResult>;
  importReport(): Promise<LoadedReport | null>;
  importReportPath(path: string): Promise<LoadedReport>;
  openReport(handle: string): Promise<LoadedReport>;
  loadExample(): Promise<LoadedReport>;
  chooseRepository(
    selection?: "folder" | "file",
  ): Promise<RepositoryInfo | null>;
  chooseRepositoryPath(path: string): Promise<RepositoryInfo>;
  attachRepository(
    reportHandle: string,
    checkoutId: string,
  ): Promise<LoadedReport>;
  readDiff(reportHandle: string, fileId: string): Promise<FileDiff>;
  getReviewChanges(reportHandle: string): Promise<ReviewChanges>;
  setDecision(
    reportHandle: string,
    kind: EntityKind,
    entityId: string,
    decision: string | null,
    expectedRevision: number,
    note?: string,
  ): Promise<ReviewState>;
  saveCheckpoint(
    reportHandle: string,
    expectedRevision: number,
  ): Promise<ReviewState>;
  openFileSource(
    reportHandle: string,
    fileId: string,
    target: "github" | "vscode",
    side?: "base" | "head",
  ): Promise<OpenSourceResult>;
  openSource(
    reportHandle: string,
    evidenceId: string,
  ): Promise<OpenSourceResult>;
}
