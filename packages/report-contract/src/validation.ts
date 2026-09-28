import structurallyValid from './generated/structural-validator.js';
import type { ContextFile, Graph, ReportFile, Side, TraceReport } from './index';

/** Import limits are also enforced natively before JSON parsing and rendering. */
export const REPORT_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  depth: 32,
  values: 200_000,
  arrayItems: 20_000,
  files: 10_000,
  contextFiles: 10_000,
  evidence: 20_000,
  rounds: 2_000,
  flows: 500,
  findings: 5_000,
  graphNodes: 200,
  graphEdges: 800,
  errors: 100,
});

export type ReportValidationResult =
  | { ok: true; report: TraceReport }
  | { ok: false; errors: string[] };

const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const encoder = new TextEncoder();

const failure = (message: string): ReportValidationResult => ({ ok: false, errors: [message] });

/** Byte-capped JSON entry point. The returned report has not been verified against Git. */
export function parseReport(text: string): ReportValidationResult {
  // UTF-16 length rejects giant strings before allocating an encoded copy.
  if (text.length > REPORT_LIMITS.bytes || encoder.encode(text).length > REPORT_LIMITS.bytes) {
    return failure(`Report exceeds the ${REPORT_LIMITS.bytes} byte import limit.`);
  }
  try {
    return validateReport(JSON.parse(text));
  } catch {
    return failure('Report is not valid JSON.');
  }
}

/** Bound work before Ajv examines arbitrary input, and reject values JSON cannot carry. */
function preflight(input: unknown): string | undefined {
  const stack = [{ value: input, depth: 0 }];
  const visited = new WeakSet<object>();
  let values = 0;
  let bytes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++values > REPORT_LIMITS.values) return 'Report exceeds the value-count limit.';
    if (depth > REPORT_LIMITS.depth) return 'Report exceeds the nesting-depth limit.';
    if (typeof value === 'string') {
      if (value.length > REPORT_LIMITS.bytes) return 'Report exceeds the text-size limit.';
      bytes += encoder.encode(value).length + 2;
      if (controls.test(value)) return 'Report contains a forbidden control character.';
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 'Report must contain finite JSON numbers.';
      bytes += 24;
    } else if (typeof value === 'boolean' || value === null) {
      bytes += 5;
    } else if (typeof value === 'object') {
      if (visited.has(value)) return 'Report must be a JSON tree without cycles or shared objects.';
      visited.add(value);
      if (Array.isArray(value)) {
        if (value.length > REPORT_LIMITS.arrayItems) return 'Report array exceeds the item-count limit.';
        bytes += 2 + value.length;
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !('value' in descriptor)) return 'Report arrays must contain ordinary JSON values without accessors.';
          stack.push({ value: descriptor.value, depth: depth + 1 });
        }
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return 'Report must contain plain JSON objects.';
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Object.keys(descriptors);
        if (keys.length > REPORT_LIMITS.arrayItems) return 'Report object exceeds the property-count limit.';
        bytes += 2 + keys.length * 4;
        for (const key of keys) {
          const descriptor = descriptors[key];
          if (!('value' in descriptor)) return 'Report must not contain accessor properties.';
          if (key.length > REPORT_LIMITS.bytes) return 'Report exceeds the text-size limit.';
          bytes += encoder.encode(key).length;
          stack.push({ value: descriptor.value, depth: depth + 1 });
        }
      }
    } else {
      return 'Report contains a value that JSON cannot represent.';
    }
    if (bytes > REPORT_LIMITS.bytes) return 'Report exceeds the text-size limit.';
  }

  // Shape errors belong to Ajv; only inspect limits where arrays actually exist.
  if (input && typeof input === 'object') {
    const object = input as Record<string, unknown>;
    for (const field of ['files', 'contextFiles', 'evidence', 'rounds', 'flows', 'findings'] as const) {
      if (Array.isArray(object[field]) && object[field].length > REPORT_LIMITS[field]) {
        return `Report ${field} exceeds the ${REPORT_LIMITS[field]} item limit.`;
      }
    }
    if (Array.isArray(object.flows)) {
      for (const flow of object.flows) {
        for (const side of ['before', 'after']) {
          const graph = flow?.[side]?.graph;
          if (Array.isArray(graph?.nodes) && graph.nodes.length > REPORT_LIMITS.graphNodes) {
            return `Flow graph exceeds the ${REPORT_LIMITS.graphNodes} node limit.`;
          }
          if (Array.isArray(graph?.edges) && graph.edges.length > REPORT_LIMITS.graphEdges) {
            return `Flow graph exceeds the ${REPORT_LIMITS.graphEdges} edge limit.`;
          }
        }
      }
    }
  }
  return undefined;
}

/** Structural and relational validation only; Git existence/content is a native check. */
export function validateReport(input: unknown): ReportValidationResult {
  try {
    const limitError = preflight(input);
    if (limitError) return failure(limitError);
  } catch {
    return failure('Report must contain ordinary JSON data.');
  }
  if (!structurallyValid(input)) {
    return {
      ok: false,
      errors: (structurallyValid.errors ?? []).slice(0, REPORT_LIMITS.errors).map(
        error => `Schema ${error.instancePath || '/'}: ${error.message ?? 'invalid value'}`,
      ),
    };
  }
  const report = input;
  const errors: string[] = [];
  const error = (message: string) => {
    if (errors.length < REPORT_LIMITS.errors) errors.push(message);
  };
  const index = <T extends { id: string }>(items: T[], label: string) => {
    const map = new Map<string, T>();
    for (const item of items) {
      if (map.has(item.id)) error(`${label}: duplicate id ${item.id}`);
      map.set(item.id, item);
    }
    return map;
  };
  const refs = (ids: string[], target: ReadonlyMap<string, unknown>, label: string) => {
    for (const id of ids) if (!target.has(id)) error(`${label}: unknown reference ${id}`);
  };
  const pathCheck = (path: string, label: string) => {
    if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')
      || /[\u0000-\u001f]/.test(path)) {
      error(`${label}: must be a canonical repository-relative POSIX path`);
    }
  };

  const repositoryId = report.repository.id;
  if (repositoryId.startsWith('/') || repositoryId.startsWith('file:')
    || repositoryId.includes('\\') || /^[A-Za-z]:/.test(repositoryId)) {
    error('repository.id: local checkout paths are not portable repository identities');
  }
  const files = index<ReportFile | ContextFile>([...report.files, ...report.contextFiles], 'files/contextFiles');
  const rounds = index(report.rounds, 'rounds');
  const evidence = index(report.evidence, 'evidence');
  const flows = index(report.flows, 'flows');
  index(report.findings, 'findings');
  index(report.valueDerivations ?? [], 'valueDerivations');

  const paths = new Set<string>();
  for (const file of files.values()) {
    pathCheck(file.path, `file ${file.id}`);
    if (paths.has(file.path)) error(`files/contextFiles: duplicate path ${file.path}`);
    paths.add(file.path);
    if (!('status' in file)) continue;
    const moved = file.status === 'renamed' || file.status === 'copied';
    if (moved !== (file.previousPath !== undefined)) {
      error(`file ${file.id}: previousPath is required only for renamed/copied files`);
    }
    if (file.previousPath !== undefined) {
      pathCheck(file.previousPath, `file ${file.id} previousPath`);
      if (file.previousPath === file.path) error(`file ${file.id}: previousPath must differ from path`);
    }
    if (file.roundId !== null) refs([file.roundId], rounds, `file ${file.id} roundId`);
    else if (report.coverage.inventory === 'complete') {
      error(`file ${file.id}: a complete inventory requires a review round`);
    }
  }

  // Kahn's algorithm avoids recursion on an untrusted dependency chain.
  const dependencyCount = new Map<string, number>();
  const consumers = new Map<string, string[]>();
  for (const round of rounds.values()) {
    refs(round.dependsOn, rounds, `round ${round.id} dependsOn`);
    dependencyCount.set(round.id, round.dependsOn.filter(id => rounds.has(id)).length);
    for (const dependency of round.dependsOn) {
      if (!rounds.has(dependency)) continue;
      const list = consumers.get(dependency) ?? [];
      list.push(round.id);
      consumers.set(dependency, list);
    }
  }
  const ready = [...dependencyCount].filter(([, count]) => count === 0).map(([id]) => id);
  let visitedRounds = 0;
  while (ready.length) {
    const id = ready.pop()!;
    visitedRounds++;
    for (const consumer of consumers.get(id) ?? []) {
      const remaining = dependencyCount.get(consumer)! - 1;
      dependencyCount.set(consumer, remaining);
      if (remaining === 0) ready.push(consumer);
    }
  }
  if (visitedRounds !== rounds.size) error('rounds: dependency cycle');

  for (const anchor of evidence.values()) {
    refs([anchor.fileId], files, `evidence ${anchor.id} fileId`);
    if (anchor.startLine > anchor.endLine) error(`evidence ${anchor.id}: endLine precedes startLine`);
    if (!Number.isSafeInteger(anchor.startLine) || !Number.isSafeInteger(anchor.endLine)) {
      error(`evidence ${anchor.id}: line numbers must be safe integers`);
    }
    const file = files.get(anchor.fileId);
    if (file && 'status' in file && ((file.status === 'added' && anchor.side === 'base')
      || (file.status === 'deleted' && anchor.side === 'head'))) {
      error(`evidence ${anchor.id}: ${anchor.side} side does not exist`);
    }
  }

  const evidenceRefs = (ids: string[], label: string, side?: Side, flowFiles?: ReadonlySet<string>) => {
    refs(ids, evidence, label);
    for (const id of ids) {
      const anchor = evidence.get(id);
      if (!anchor) continue;
      if (side && anchor.side !== side) error(`${label}: evidence ${id} must use ${side} revision`);
      if (flowFiles && !flowFiles.has(anchor.fileId)) {
        error(`${label}: evidence ${id} file must be listed in flow.fileIds`);
      }
    }
  };
  const closure = (starts: string[], adjacency: ReadonlyMap<string, string[]>) => {
    const reached = new Set<string>();
    const pending = [...starts];
    while (pending.length) {
      const node = pending.pop()!;
      if (reached.has(node)) continue;
      reached.add(node);
      pending.push(...(adjacency.get(node) ?? []));
    }
    return reached;
  };
  const graphCheck = (graph: Graph, label: string, side: Side, flowFiles: ReadonlySet<string>) => {
    const nodes = index(graph.nodes, `${label} nodes`);
    const forward = new Map<string, string[]>();
    const reverse = new Map<string, string[]>();
    const outgoingLabels = new Map<string, (string | undefined)[]>();
    for (const node of nodes.values()) {
      forward.set(node.id, []);
      reverse.set(node.id, []);
      evidenceRefs(node.evidenceIds, `${label} node ${node.id}`, side, flowFiles);
      if (node.kind !== 'entry' && !node.evidenceIds.length) {
        error(`${label} node ${node.id}: code behavior needs source evidence`);
      }
    }
    const seenEdges = new Set<string>();
    for (const edge of graph.edges) {
      refs([edge.from, edge.to], nodes, `${label} edge`);
      evidenceRefs(edge.evidenceIds, `${label} edge`, side, flowFiles);
      const identity = JSON.stringify([edge.from, edge.to, edge.label ?? null]);
      if (seenEdges.has(identity)) error(`${label}: duplicate edge ${identity}`);
      seenEdges.add(identity);
      const labels = outgoingLabels.get(edge.from) ?? [];
      labels.push(edge.label);
      outgoingLabels.set(edge.from, labels);
      if (nodes.has(edge.from) && nodes.has(edge.to)) {
        forward.get(edge.from)!.push(edge.to);
        reverse.get(edge.to)!.push(edge.from);
      }
    }
    const entries = graph.nodes.filter(node => node.kind === 'entry').map(node => node.id);
    const outcomes = graph.nodes.filter(node => node.kind === 'outcome').map(node => node.id);
    if (!entries.length || !outcomes.length) error(`${label}: needs an entry and an outcome`);
    const reachable = closure(entries, forward);
    const terminating = closure(outcomes, reverse);
    if ([...nodes.keys()].some(id => !reachable.has(id))) error(`${label}: nodes unreachable from an entry`);
    if ([...nodes.keys()].some(id => !terminating.has(id))) error(`${label}: nodes without a path to an outcome`);
    for (const node of nodes.values()) {
      if (node.kind !== 'decision') continue;
      const labels = outgoingLabels.get(node.id) ?? [];
      if (labels.length < 2 || labels.some(label => !label) || new Set(labels).size !== labels.length) {
        error(`${label} decision ${node.id}: needs distinct labeled branches`);
      }
    }
  };

  for (const flow of flows.values()) {
    refs(flow.fileIds, files, `flow ${flow.id} fileIds`);
    const flowFiles = new Set(flow.fileIds);
    if (flow.before.graph) graphCheck(flow.before.graph, `flow ${flow.id} before`, 'base', flowFiles);
    if (flow.after.graph) graphCheck(flow.after.graph, `flow ${flow.id} after`, 'head', flowFiles);
  }
  for (const finding of report.findings) {
    const label = `finding ${finding.id}`;
    refs(finding.flowIds, flows, `${label} flowIds`);
    evidenceRefs([finding.primaryEvidenceId], `${label} primaryEvidenceId`);
    for (const step of finding.trace) evidenceRefs(step.evidenceIds, `${label} trace`);
    if (finding.assessment === 'supported' && finding.priority === null) {
      error(`${label}: supported findings require explicit priority`);
    }
  }
  for (const derivation of report.valueDerivations ?? []) {
    for (const step of derivation.trace) evidenceRefs(step.evidenceIds, `derivation ${derivation.id} trace`);
  }

  if (report.comparison.base.oid.length !== report.comparison.head.oid.length) {
    error('comparison: base/head must use the same Git object format');
  }
  if (report.pullRequest && !Number.isSafeInteger(report.pullRequest.number)) {
    error('pullRequest.number: must be a safe integer');
  }
  if (report.coverage.inventory === 'partial' && report.summary.outcome !== 'incomplete') {
    error('summary: partial inventory requires outcome incomplete');
  }
  if (report.coverage.flowAnalysis === 'not-assessed' && report.flows.length) {
    error('coverage: not-assessed flowAnalysis must have no authored flows');
  }
  if (report.coverage.flowAnalysis === 'complete'
    && report.flows.some(flow => flow.before.status === 'unavailable' || flow.after.status === 'unavailable')) {
    error('coverage: flowAnalysis cannot be complete with an unavailable snapshot');
  }
  return errors.length ? { ok: false, errors } : { ok: true, report };
}
