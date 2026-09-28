---
name: trace-report
description: Create or refresh an evidence-backed .trace.json review report for the Trace macOS app, including changed-file TLDRs, before-and-after user flows, findings and dependency rounds. Use when exporting a review to Trace; does not implement fixes or publish review comments.
---

# Trace report

Generate `.trace/<review-slug>.trace.json` in the reviewed repository, or the
user's requested output path. This package is a proposed portable skill shipped
with the Trace specification; creating this package does not install it globally.

Read [the contract](references/contract.md) before writing. Use
[schema.json](references/schema.json) for exact field names and
[example.trace.json](references/example.trace.json) only to understand structure.
The example is fictional: never reuse its claims, source ranges or commit ids.

## Gather the comparison

Resolve the repository identity and full base/head commit ids before reviewing.
For a PR comparison, use the intended merge base as `comparison.base`; the report
always describes the direct comparison between its two recorded snapshots. If
the user's intended base is unclear, inspect the repository/PR context before
choosing. Do not silently review working-tree changes as if they were committed.

Use Git to collect every changed path, status and previous path, including
renames, copies, binary assets, generated files and deletions. The canonical
inventory policy is `git diff --raw -z --no-abbrev --find-renames=50%
--find-copies=50% <base> <head> --`; parse NUL-delimited output. Prefer the app's
verified inventory when available. Do not copy old agent-authored counts or
fingerprints: native Trace derives stats, diffs and fingerprints from Git.

Read the changed snapshots and relevant callers, guards, tests and unchanged
dependencies. Add unchanged evidence sources to `contextFiles`, separate from
the changed-file inventory. Evidence uses an explicit `base` or `head` side and
positive line ranges; a deleted file has no head side and an added file has no
base side. Local absolute checkout paths belong to app configuration, never the
portable report.

## Author the review

- Give **every changed file** a standalone change TLDR, why the change exists,
  and concrete review focus. Explain behavior, not only syntax. If the reason is
  an inference, say so. Mark incomplete or unavailable analysis explicitly with
  its reason; do not manufacture a TLDR for an unread file.
- Order dependency rounds by what the reviewer must establish first. Include a
  rationale, concrete questions and exit criteria. Keep `dependsOn` acyclic.
- Describe each meaningful changed user or system flow: actor, trigger,
  intended outcome, change TLDR and before/after node-and-edge graphs. Branch
  labels state the actual condition. Connect behavioral nodes to exact source
  evidence on that snapshot's side. Show relevant error, empty, loading and
  permission paths only when supported by source. Do not invent UI states.
- Identify the PR's central end-to-end user or system journey within the
  comparison's actual scope. Set root `mainJourney` to `{ "flowId": "<existing
  flow id>", "why": "<why this journey is central to the change>" }`. Choose it
  by the change's purpose and the behavior it connects; explain that choice
  independently of finding severity. The selected journey can have no findings.
  Flow order does not designate importance. If the reviewed evidence cannot
  support a central journey, omit `mainJourney` and explain the limitation in
  `coverage.note`; always omit it when `flows` is empty. Older reports without
  this field remain valid and have no explicitly designated main journey.
- Use `coverage.flowAnalysis` and its note to distinguish complete coverage,
  partial analysis and no analysis. A change with no behavioral flow can have an
  empty `flows` array and a concrete explanation. A risk-ordered reading list is
  a set of review rounds, not automatically a user-flow graph.
- Findings explain a reproducible trigger, consequence, expected behavior and
  ordered causal trace. Use explicit priority for supported findings. Zero
  findings is valid; a clean report still includes file and flow guidance.
  Proposed fixes are read-only suggestions. Add a standard unified patch only
  when it has been checked against this report's head; otherwise use `patch:null`
  and explain the repair in prose.
- All fields are plain text except named `bodyMarkdown` fields. Raw HTML is
  never trusted. Supply domain terms and value derivations only when useful and
  evidenced; Trace has no built-in repository-specific fallback glossary.
- Record actual checks as passed, failed or not-run and explain limitations.
  Distinguish source inspection from runtime verification. Never turn a test
  you propose into a test you claim to have run.

## Refresh and validate

Keep `reportId` for the same review. Preserve file, round, flow and finding ids
when their conceptual identity persists; severity changes do not change finding
identity. Never reuse a retired id for a different issue. Update exact commits
and recheck all source ranges and affected prose. A removed finding is not proof
that a human marked it fixed.

Reassess `mainJourney` and its reason against the updated comparison. Keep its
`flowId` when the same central behavior persists; if the selected flow is removed,
choose another supported journey with a new reason or omit the designation.

Do not create or modify Trace's app-owned state, old `.prnav.triage.json` files,
checkpoints, reviewed marks or finding dispositions. Do not apply patches, send
commands to a terminal, or post comments as a side effect of report generation.

Connected projects automatically detect completed `.trace/*.trace.json` files
while Trace is open. Write drafts with another suffix, validate, then atomically
rename the completed report into place so a partial write is not imported.
Each unique report snapshot remains available under its project and PR.

Run the bundled validator (requires Python 3 and `jsonschema>=4.18`):

```sh
python3 /path/to/trace-report/scripts/validate.py \
  .trace/<review-slug>.trace.json --repo /absolute/path/to/reviewed-repo
```

Resolve every error. Then read the rendered report if Trace is available: check
one added/deleted/renamed file when present, one branching flow, one finding and
its source navigation. When Trace is unavailable, report that limitation and
the exact validation performed; do not claim native-app verification.

For `.prnav.json` conversion, follow the migration section in the contract.
Missing summaries and flows remain missing until reviewed; old HTML and diff
half-rows cannot simply be copied into the new fields.
