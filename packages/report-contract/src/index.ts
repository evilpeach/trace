import fixture from '../../../docs/trace/skills/trace-report/references/example.trace.json';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type Side = 'base' | 'head';
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed';

export interface Revision {
  oid: string;
  label?: string;
}

export type FileAnalysis = {
  status: 'complete';
  tldr: string;
  why: string;
  focus: string[];
  reason: null;
} | {
  status: 'partial' | 'not-assessed' | 'unavailable';
  tldr: string | null;
  why: string | null;
  focus: string[];
  reason: string;
};

export interface ReportFile {
  id: string;
  path: string;
  previousPath?: string;
  status: FileStatus;
  roundId: string | null;
  kind?: string;
  priority?: Priority;
  analysis: FileAnalysis;
}

export interface ContextFile {
  id: string;
  path: string;
}

export interface Round {
  id: string;
  title: string;
  why: string;
  exitCriteria: string[];
  questions: string[];
  dependsOn: string[];
}

export interface Evidence {
  id: string;
  fileId: string;
  side: Side;
  startLine: number;
  endLine: number;
  note?: string;
}

export interface GraphNode {
  id: string;
  kind: 'entry' | 'action' | 'decision' | 'outcome';
  label: string;
  evidenceIds: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  evidenceIds: string[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type FlowSnapshot = {
  status: 'known';
  graph: Graph;
  reason: null;
} | {
  status: 'unavailable' | 'not-applicable';
  graph: null;
  reason: string;
};

export interface Flow {
  id: string;
  title: string;
  tldr: string;
  actor: string;
  trigger: string;
  outcome: string;
  whyChanged: string;
  fileIds: string[];
  before: FlowSnapshot;
  after: FlowSnapshot;
}

export interface FindingBlock {
  label: string;
  tldr: string;
  bodyMarkdown: string;
}

export interface TraceStep {
  note: string;
  evidenceIds: string[];
}

export interface ProposedFix {
  summary: string;
  patch: string | null;
  validation: string[];
}

export interface Finding {
  id: string;
  priority: Priority | null;
  assessment: 'supported' | 'needs-verification' | 'refuted';
  title: string;
  tldr: string;
  category?: string;
  primaryEvidenceId: string;
  flowIds: string[];
  blocks: FindingBlock[];
  trace: TraceStep[];
  proposedFix: ProposedFix | null;
}

export interface ValueDerivation {
  id: string;
  value: string;
  tldr: string;
  surfaces: string[];
  formula: string;
  units: string;
  edgeBehavior: string;
  trace: TraceStep[];
}

export interface ProvenanceCheck {
  label: string;
  status: 'passed' | 'failed' | 'not-run';
  detail: string;
}

export interface Provenance {
  mode: 'agent' | 'legacy-import' | 'synthetic-example';
  generator: string;
  checks: ProvenanceCheck[];
  limitations: string[];
}

export interface TraceReport {
  schemaVersion: 1;
  reportId: string;
  title: string;
  generatedAt: string;
  repository: { id: string; name: string; webUrl?: string };
  comparison: { base: Revision; head: Revision };
  pullRequest?: { number: number; url: string };
  summary: {
    tldr: string;
    outcome: 'changes-requested' | 'no-blockers-found' | 'incomplete';
    bodyMarkdown: string;
  };
  coverage: {
    inventory: 'complete' | 'partial';
    flowAnalysis: 'complete' | 'partial' | 'not-assessed';
    note: string;
  };
  rounds: Round[];
  files: ReportFile[];
  contextFiles: ContextFile[];
  evidence: Evidence[];
  flows: Flow[];
  findings: Finding[];
  domainPrimer?: { term: string; definition: string }[];
  valueDerivations?: ValueDerivation[];
  provenance: Provenance;
}

/** Fictional report for the explicit example experience; never real Git evidence. */
export const exampleReport = fixture as TraceReport;

export { REPORT_LIMITS, parseReport, validateReport } from './validation';
export type { ReportValidationResult } from './validation';
