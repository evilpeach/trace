import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { exampleReport, parseReport, REPORT_LIMITS, validateReport } from './index';
import type { TraceReport } from './index';
import { SCHEMA_SHA256 } from './generated/structural-validator.js';

const report = (): TraceReport => structuredClone(exampleReport);

function rejected(input: unknown, expected: string) {
  const result = validateReport(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join('\n')).toContain(expected);
}

describe('Trace report contract', () => {
  it('accepts the canonical synthetic report without mutating it', () => {
    const input = report();
    const before = structuredClone(input);
    const result = validateReport(input);
    expect(result).toEqual({ ok: true, report: input });
    expect(input).toEqual(before);
  });

  it('accepts a clean review with no findings', () => {
    const input = report();
    input.findings = [];
    input.summary.outcome = 'no-blockers-found';
    expect(validateReport(input).ok).toBe(true);
  });

  it('accepts older reports without inferring a main journey from flow order', () => {
    const input = report();
    delete input.mainJourney;
    const result = validateReport(input);
    expect(result).toEqual({ ok: true, report: input });
    expect(input).not.toHaveProperty('mainJourney');
    if (result.ok) expect(result.report).not.toHaveProperty('mainJourney');
  });

  it('accepts an explicit main journey regardless of flow order or findings', () => {
    const input = report();
    const centralFlow = input.flows[0];
    input.flows.unshift({ ...structuredClone(centralFlow), id: 'flow-supporting' });
    input.mainJourney = {
      flowId: centralFlow.id,
      why: 'Checkout connects the changed account guard, session request and navigation.',
    };
    input.findings = [];
    input.summary.outcome = 'no-blockers-found';
    expect(validateReport(input)).toEqual({ ok: true, report: input });
    expect(input.mainJourney.flowId).not.toBe(input.flows[0].id);
  });

  it('rejects a main journey that references a missing flow', () => {
    const input = report();
    input.mainJourney = { flowId: 'missing-flow', why: 'Central to the changed behavior.' };
    rejected(input, 'mainJourney.flowId: unknown reference missing-flow');
  });

  it.each(['', ' ', '\t\n', '\u00a0'])('rejects a blank main journey reason %j', why => {
    const input = report();
    input.mainJourney = { flowId: input.flows[0].id, why };
    rejected(input, '/mainJourney/why');
  });

  it.each([
    null,
    { flowId: 'flow-checkout' },
    { why: 'Central to the changed behavior.' },
    { flowId: 'flow-checkout', why: 'Central to the changed behavior.', priority: 'P1' },
  ])('rejects a malformed main journey designation %j', mainJourney => {
    rejected({ ...report(), mainJourney }, '/mainJourney');
  });

  it('requires main journey omission when there are no authored flows', () => {
    const input = report();
    input.flows = [];
    input.findings = [];
    input.coverage.flowAnalysis = 'not-assessed';
    input.coverage.note = 'Behavioral flows have not been assessed.';
    input.summary.outcome = 'incomplete';
    rejected(input, 'mainJourney.flowId: unknown reference flow-checkout');
    delete input.mainJourney;
    expect(validateReport(input).ok).toBe(true);
  });

  it('accepts a no-change comparison without artificial rounds or flows', () => {
    const input = report();
    input.comparison.head = { ...input.comparison.base };
    input.rounds = [];
    input.files = [];
    input.contextFiles = [];
    input.evidence = [];
    input.flows = [];
    delete input.mainJourney;
    input.findings = [];
    input.coverage.note = 'The two snapshots have identical trees.';
    input.summary.outcome = 'no-blockers-found';
    expect(validateReport(input).ok).toBe(true);
  });

  it('accepts honest partial imports with missing file explanations', () => {
    const input = report();
    input.provenance.mode = 'legacy-import';
    input.files[0].analysis = {
      status: 'not-assessed', tldr: null, why: null, focus: [], reason: 'The legacy report contains no file summary.',
    };
    input.files[0].roundId = null;
    input.coverage.inventory = 'partial';
    input.summary.outcome = 'incomplete';
    expect(validateReport(input).ok).toBe(true);
  });

  it('requires a real explanation when complete file analysis is claimed', () => {
    const input = report();
    (input.files[0].analysis as unknown as { tldr: null }).tldr = null;
    rejected(input, '/files/0/analysis/tldr');
  });

  it.each([
    '../outside.ts', '/absolute/file.ts', 'src/../outside.ts', 'src/./file.ts',
    'src//file.ts', 'src\\file.ts', 'C:/file.ts', 'src/file\nname.ts',
  ])('rejects noncanonical source path %j', path => {
    const input = report();
    input.files[0].path = path;
    rejected(input, 'canonical repository-relative POSIX path');
  });

  it('accepts valid Unicode and punctuation in source paths', () => {
    const input = report();
    input.files[0].path = 'src/บัญชี #1?.ts';
    expect(validateReport(input).ok).toBe(true);
  });

  it('rejects local checkout paths masquerading as portable repository identities', () => {
    const input = report();
    input.repository.id = '/Users/someone/private-repo';
    rejected(input, 'portable repository identities');
  });

  it('keeps changed and unchanged files in a shared identity namespace', () => {
    const input = report();
    input.contextFiles[0].id = input.files[0].id;
    rejected(input, 'duplicate id');
  });

  it('rejects duplicate file paths even with distinct identities', () => {
    const input = report();
    input.contextFiles[0].path = input.files[0].path;
    rejected(input, 'duplicate path');
  });

  it('requires distinct old and new paths only for renames and copies', () => {
    const input = report();
    input.files[0].status = 'renamed';
    rejected(input, 'previousPath is required');
    input.files[0].previousPath = input.files[0].path;
    rejected(input, 'previousPath must differ');
    input.files[0].previousPath = 'src/previous-session.ts';
    expect(validateReport(input).ok).toBe(true);
    input.files[0].status = 'modified';
    rejected(input, 'previousPath is required only');
  });

  it('does not permit anchors on absent added/deleted sides', () => {
    const input = report();
    input.files[0].status = 'added';
    rejected(input, 'base side does not exist');
    input.files[0].status = 'deleted';
    rejected(input, 'head side does not exist');
  });

  it('rejects dangling source, finding and flow references', () => {
    const input = report();
    input.evidence[0].fileId = 'missing-file';
    input.findings[0].primaryEvidenceId = 'missing-evidence';
    input.findings[0].flowIds = ['missing-flow'];
    rejected(input, 'unknown reference missing-file');
    rejected(input, 'unknown reference missing-evidence');
    rejected(input, 'unknown reference missing-flow');
  });

  it('requires ordered source ranges representable safely in JavaScript', () => {
    const input = report();
    input.evidence[0].endLine = 1;
    input.evidence[0].startLine = 2;
    rejected(input, 'endLine precedes');
    input.evidence[0].endLine = Number.MAX_SAFE_INTEGER + 1;
    rejected(input, 'safe integers');
  });

  it('rejects dependency cycles and missing rounds', () => {
    const input = report();
    input.rounds[0].dependsOn = [input.rounds[1].id];
    rejected(input, 'dependency cycle');
    input.rounds[0].dependsOn = ['missing-round'];
    rejected(input, 'unknown reference missing-round');
  });

  it('checks graph evidence against the correct snapshot and flow membership', () => {
    const input = report();
    const graph = input.flows[0].before.graph!;
    graph.nodes[1].evidenceIds = ['ev-session-head'];
    rejected(input, 'must use base revision');
    graph.nodes[1].evidenceIds = ['ev-session-base'];
    input.flows[0].fileIds = ['file-checkout'];
    rejected(input, 'must be listed in flow.fileIds');
  });

  it('requires evidence for behavioral nodes but permits an external entry', () => {
    const input = report();
    input.flows[0].after.graph!.nodes.find(node => node.kind === 'action')!.evidenceIds = [];
    rejected(input, 'code behavior needs source evidence');
  });

  it('rejects dead and orphaned graph nodes', () => {
    const input = report();
    input.flows[0].before.graph!.edges = [];
    rejected(input, 'unreachable from an entry');
    rejected(input, 'without a path to an outcome');
  });

  it('requires distinct labeled decision branches', () => {
    const input = report();
    const edges = input.flows[0].after.graph!.edges;
    const branches = edges.filter(edge => edge.from === 'selected');
    branches[1].label = branches[0].label;
    rejected(input, 'distinct labeled branches');
    delete branches[1].label;
    rejected(input, 'distinct labeled branches');
  });

  it('permits retry cycles when an outcome remains reachable', () => {
    const input = report();
    input.flows[0].before.graph!.edges.push({ from: 'request', to: 'request', label: 'Retry', evidenceIds: [] });
    expect(validateReport(input).ok).toBe(true);
  });

  it('rejects duplicate graph edges and node identities', () => {
    const input = report();
    const graph = input.flows[0].before.graph!;
    graph.edges.push(structuredClone(graph.edges[0]));
    graph.nodes.push(structuredClone(graph.nodes[0]));
    rejected(input, 'duplicate edge');
    rejected(input, 'duplicate id');
  });

  it('cannot infer a supported finding priority from legacy severity', () => {
    const input = report();
    input.findings[0].priority = null;
    rejected(input, 'supported findings require explicit priority');
    input.findings[0].assessment = 'needs-verification';
    expect(validateReport(input).ok).toBe(true);
  });

  it('enforces coverage consistency without requiring fabricated flows', () => {
    const input = report();
    input.coverage.inventory = 'partial';
    rejected(input, 'partial inventory requires outcome incomplete');
    input.summary.outcome = 'incomplete';
    input.coverage.flowAnalysis = 'not-assessed';
    rejected(input, 'must have no authored flows');
    input.coverage.flowAnalysis = 'complete';
    input.flows[0].before = { status: 'unavailable', graph: null, reason: 'Missing source snapshot.' };
    rejected(input, 'cannot be complete');
    input.coverage.flowAnalysis = 'partial';
    expect(validateReport(input).ok).toBe(true);
  });

  it('rejects unsupported versions, app state and invalid dates instead of silently stripping them', () => {
    const input = report() as unknown as Record<string, unknown>;
    input.reviewedFiles = ['file-session'];
    rejected(input, 'additional properties');
    delete input.reviewedFiles;
    input.schemaVersion = 2;
    rejected(input, '/schemaVersion');
    input.schemaVersion = 1;
    input.generatedAt = 'yesterday';
    rejected(input, '/generatedAt');
  });

  it('treats markup as inert data while rejecting terminal control characters', () => {
    const input = report();
    input.summary.bodyMarkdown = '<script>alert(1)</script> and Promise<T>';
    expect(validateReport(input).ok).toBe(true);
    input.summary.bodyMarkdown = 'safe\u001b[31m';
    rejected(input, 'forbidden control character');
  });
});

describe('import resource limits', () => {
  it('parses ordinary JSON and gives a stable invalid JSON result', () => {
    expect(parseReport(JSON.stringify(exampleReport)).ok).toBe(true);
    expect(parseReport('{broken')).toEqual({ ok: false, errors: ['Report is not valid JSON.'] });
  });

  it('checks bytes before parsing oversized source text', () => {
    expect(parseReport(' '.repeat(REPORT_LIMITS.bytes + 1))).toEqual({
      ok: false, errors: [`Report exceeds the ${REPORT_LIMITS.bytes} byte import limit.`],
    });
  });

  it('caps graph sizes before graph traversal', () => {
    const input = report();
    input.flows[0].after.graph!.nodes = Array.from({ length: REPORT_LIMITS.graphNodes + 1 }, (_, i) => ({
      id: `node-${i}`, kind: 'entry' as const, label: 'Synthetic node', evidenceIds: [],
    }));
    rejected(input, 'node limit');
  });

  it('bounds arrays and object depth before schema validation', () => {
    rejected(Array(REPORT_LIMITS.arrayItems + 1).fill(null), 'item-count limit');
    let nested: unknown = null;
    for (let i = 0; i < REPORT_LIMITS.depth + 2; i++) nested = { nested };
    rejected(nested, 'nesting-depth limit');
  });

  it('does not recurse into cyclic or accessor-bearing JavaScript inputs', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    rejected(cyclic, 'without cycles');
    let read = false;
    const accessor = Object.defineProperty({}, 'danger', { enumerable: true, get() { read = true; return 'value'; } });
    rejected(accessor, 'accessor properties');
    expect(read).toBe(false);
    const arrayAccessor = Object.defineProperty([], '0', { get() { read = true; return 'value'; } });
    rejected(arrayAccessor, 'without accessors');
    expect(read).toBe(false);
  });
});

describe('CSP-safe structural validation', () => {
  it('uses an artifact generated from the current canonical schema', () => {
    const schema = readFileSync(new URL('../../../docs/trace/skills/trace-report/references/schema.json', import.meta.url));
    expect(SCHEMA_SHA256).toBe(createHash('sha256').update(schema).digest('hex'));
  });

  it('imports the complete public API and validates under disabled string code generation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trace-csp-validation-'));
    try {
      const bundle = buildSync({
        entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
        bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false,
      });
      const entry = join(directory, 'contract.mjs');
      writeFileSync(entry, bundle.outputFiles[0].text);
      const source = `import * as contract from ${JSON.stringify(pathToFileURL(entry).href)};
        const result = contract.validateReport(contract.exampleReport);
        if (!result.ok) throw new Error(result.errors.join('\\n'));
        if (contract.validateReport({ schemaVersion: 99 }).ok) throw new Error('Invalid report was accepted');
        console.log('CSP validation passed');`;
      const output = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', source], { encoding: 'utf8' });
      expect(output).toContain('CSP validation passed');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
