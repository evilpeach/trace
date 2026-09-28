# Trace v1 portable review report

This is the proposed app/agent boundary. [schema.json](schema.json) defines the
closed JSON shape. [validate.py](../scripts/validate.py) checks shape and cross
references, and can check source facts against Git. A native importer must apply
the same semantics; successfully parsing JSON is insufficient.

## Ownership and identity

| Data | Owner |
| --- | --- |
| File TLDRs, why, review questions, flows, findings, evidence, proposed fixes | Agent report |
| Repository checkout location, allowed roots, recent reports | Mac app |
| Diff text, blob ids, additions/deletions, binary/submodule detection, fingerprints | Native Git service |
| Reviewed files/flows, finding dispositions, notes, checkpoints | App state store |

Write portable reports to `.trace/<slug>.trace.json` by default. The extension's
`.pr-review/*.prnav.json` files remain import sources. This contract does not
include the app state store's private persistence schema.

- `schemaVersion` is the integer `1`. Unknown properties are rejected so a
  misspelled field cannot silently disappear. Unsupported versions show an
  upgrade-required message, never a best-effort current-version render.
- `repository.id` is a transport-independent identity such as
  `github.com/owner/repo`. A repository without a remote receives a stable
  `local:<uuid>` chosen once by the app/user and reused. `repository.name` is a
  display label. `webUrl`, when included, is HTTPS. No absolute local root is
  serialized. The app maps the identity to a user-selected checkout and verifies
  that mapping; the Python validator only checks the provided checkout's objects.
- `reportId` identifies a review across updates, for example `orbit:pr:42` or
  `orbit:branch:checkout`. Key app state by `(repository.id, reportId)`, then by
  stable entity id. Two reports with the same filename need not be the same
  review. A new comparison for the same PR retains its report id.
- `comparison.base.oid` and `comparison.head.oid` are complete lowercase 40- or
  64-character commit ids of the same Git object format. Optional `label` values
  are display text, never refs to execute. The comparison is the direct two
  snapshot diff. For PRs, resolve the intended merge base first and store it as
  `base`; do not silently recompute it on import.
- `generatedAt` is an RFC 3339 timestamp with timezone. Optional `pullRequest`
  contains an HTTPS `url` and numeric `number`; this metadata confers no write
  authority. `provenance.mode` is `agent`, `legacy-import` or
  `synthetic-example`. Synthetic reports show a persistent example label.

Version 1 is commit-to-commit. Dirty working-tree review needs a future explicit
snapshot model; the app must never substitute working-tree contents for a
recorded commit. Source correctness requires both commits locally. Missing
objects show unavailable diffs and evidence until they are fetched through an
authorized flow, while the report prose remains readable.

## Summary and coverage

`summary` contains a short plain-text `tldr`, `outcome` (`changes-requested`,
`no-blockers-found`, `incomplete`) and explanatory `bodyMarkdown`. An outcome is
the author's assessment, not an automatic merge gate.

`coverage.inventory` is `complete` or `partial`. Complete means `files` covers
every changed path between the recorded commits, even if a file's analysis is
not available. `coverage.flowAnalysis` is `complete`, `partial` or
`not-assessed`. `coverage.note` states what was considered or what is missing.

These axes remain separate: 20/20 inventory does not mean 20/20 TLDRs, complete
flows, passed tests or human review. The UI derives file-guidance coverage from
`analysis.status` and shows it independently. `partial` inventory requires
`summary.outcome:incomplete`. No analyzed flows is represented by `flows:[]`;
`not-assessed` is not displayed as “0 flows affected.” If analysis establishes no
behavioral flow change, use `complete`, an empty array and a concrete note.

`provenance` records the generator, actual `checks` (`passed`, `failed`, `not-run`)
and `limitations`. Checks distinguish code inspection from executed tests and
native UI verification. A validator cannot establish that an agent's claim is
true; the author must not relabel unrun work as passed.

## Changed files and dependency rounds

Each `files` entry has an `id`, canonical repository-relative POSIX `path`,
`status`, `roundId` and `analysis`. Optional `kind` and `priority` guide navigation.
Priority is explicitly `P0`–`P3`; do not derive it from legacy severity groups.

`status` is `added`, `modified`, `deleted`, `renamed`, `copied` or `type-changed`.
`previousPath` is required only for renamed/copied files. For a deleted file,
`path` is its old location. For a rename/copy, `path` is the new location and
`previousPath` is the base location. No `pathPrefix`, absolute paths, backslashes,
empty segments, `.` or `..` segments are accepted. Each current path is unique.

`analysis` fields:

| Field | Meaning |
| --- | --- |
| `status` | `complete`, `partial`, `not-assessed` or `unavailable` |
| `tldr` | One sentence explaining what changed, maximum 280 characters; nullable when unknown |
| `why` | Why the change exists; label inferred intent explicitly; nullable when unknown |
| `focus` | Concrete things the reviewer should verify, as an array |
| `reason` | Required explanation when analysis is not complete; otherwise null |

Complete analysis requires nonempty TLDR, why and at least one focus item. Partial
analysis retains useful verified fields and marks its gaps; not-assessed and
unavailable analyses should leave unsupported fields null/empty. Binary files,
generated files, lockfiles and submodules stay in the inventory. Describe what
can be established and state the limitation; no fake text diff or line anchor.

`rounds` form a dependency DAG. Each has stable `id`, `title`, `why`, nonempty
`exitCriteria`, `questions` and `dependsOn` round ids. Array order is the preferred
order among dependencies at the same depth; the app topologically orders it.
Every changed file belongs to one declared round in a complete inventory.
`roundId:null` is allowed for partial legacy imports pending classification.
Do not infer that checking a box satisfies an exit criterion.

The native inventory policy is Git's raw NUL-delimited two-commit diff with
`--find-renames=50% --find-copies=50%`, without `--find-copies-harder`. Statuses and
paths must match that inventory; copies Git does not detect appear as additions.
The app computes stats and file fingerprints from status, paths, mode and blob
ids. The report contains no fabricated stats or authored diff hunks. Zero-change
comparisons may have empty files/rounds arrays.

## Source evidence

Unchanged supporting files live in `contextFiles:[{id,path}]`, never mixed into
changed-file counts. Their ids share the `files` namespace. Each must exist
unchanged on both sides, including mode and blob. Relevant changed dependencies
belong in `files` even if they are not the primary subject of a finding.

`evidence` is the shared source-anchor registry:

```json
{
  "id": "ev-account-guard",
  "fileId": "file-checkout",
  "side": "head",
  "startLine": 10,
  "endLine": 18,
  "note": "Checks selected account before awaiting the session."
}
```

Each anchor resolves to exactly `(repository.id, comparison[side].oid,
file-side-path, startLine..endLine)`. Ranges are one-based, inclusive and ordered.
Added files have no base evidence; deleted files have no head evidence. A
rename/copy uses `previousPath` on base. Source ranges must fit a regular text
blob; directory, submodule, symlink and binary anchors are not code lines.

The app reads source through Git object access, never by blindly joining report
paths to a filesystem root. Working-tree editor navigation is a separate action:
Trace constructs `vscode://file/{encoded-absolute-path}:{line}` from its validated
local mapping, encoding spaces, `#`, `?` and Unicode path segments. The report
never supplies an arbitrary navigation URL or shell command. It may open a
working-tree line only when the corresponding path and blob match the evidence
snapshot (or a verified line mapping is available). Otherwise show the committed
snapshot and explain the mismatch; do not label an unverified jump as exact.

## Flow stories and graphs

Each `flows` item contains stable `id`, `title`, `tldr`, `actor`, `trigger`, intended
`outcome`, `whyChanged`, related `fileIds` and `before`/`after` snapshots. File ids
can include changed files and unchanged context. `tldr` is a direct explanation
of the behavior change, not the flow's title repeated.

Each snapshot is `{status, graph, reason}`. For `known`, `graph` contains nodes and
edges and `reason` is null. For `unavailable` or `not-applicable`, graph is null
and the reason is nonempty. A newly introduced flow can have a not-applicable
before snapshot; do not invent a predecessor. An unavailable snapshot makes
overall flow analysis partial.

A node has `{id,kind,label,evidenceIds}`; kinds are `entry`, `action`, `decision`,
`outcome`. An edge has `{from,to,evidenceIds,label?}`. Node ids are local to each
graph. There must be an entry and an outcome; every node is reachable from an
entry and can reach an outcome. Cycles are permitted for retries/loops when an
outcome remains reachable. Decision nodes have at least two outgoing edges with
distinct nonempty condition labels. Include meaningful failure/permission/empty
branches established by the reviewed source, not speculative variants.

Every non-entry node requires evidence. Before-graph anchors use `base`; after
anchors use `head`. Every referenced evidence file appears in the flow's
`fileIds`. Entry nodes may represent the user's external trigger without a code
anchor. Edge evidence is optional; attach it when a transition needs evidence
beyond its nodes. Graph labels are text, not executable Mermaid or HTML.

## Findings and read-only repair proposals

`findings` may be empty. A finding has a stable `id` independent of severity,
explicit `priority` (`P0`–`P3`, or null for unclassified legacy material), an
`assessment` (`supported`, `needs-verification`, `refuted`), `title`, `tldr`,
`primaryEvidenceId`, related `flowIds`, `blocks`, causal `trace` and
`proposedFix`. Optional `category` is plain text. Supported findings require an
explicit priority. Assessments are agent statements; they are not reviewer
dispositions such as accepted, disputed or fixed.

Blocks contain `{label,tldr,bodyMarkdown}`. Prefer context, concrete scenario,
consequence and expected behavior when they add information. A trace is an
ordered list of `{note,evidenceIds}` explaining why the issue happens, not just
a list of files. Trace entries require at least one evidence id.

`proposedFix` is null or `{summary,patch,validation}`. `patch` is null or a standard
unified diff against the report's head, rendered as inert text. `validation`
lists proposed checks, not executed results. The app has no implied Apply button;
copying or viewing a proposal cannot execute it. An illustrative fragment should
remain Markdown code/prose rather than pretend to be an applicable patch.

Entity ids stay stable across regenerated reports while the concept persists.
Never reuse removed finding ids; never rename an id because its priority changes.
The app keeps removed findings in history and invalidates retained dispositions
when evidence or claims materially change. It computes staleness from all
referenced blobs, including `contextFiles`, plus guidance, flow and finding
content; unchanged source code alone does not mean unchanged review guidance.

Optional `domainPrimer` is a list of terms/definitions. Optional
`valueDerivations` describes displayed values with TLDR, surfaces, formula, units,
edge behavior and an evidence-backed trace. If absent, hide these sections; no
repository-specific fallback text is injected.

## Text and validation boundary

All strings are plain text except explicitly named `bodyMarkdown` fields. Render
Markdown with raw HTML disabled, no remote images, no scripting and a restricted
link policy; application-generated source actions use the anchor registry.
Strings such as `Promise<T>` remain text. Reports cannot choose CSS classes,
native capabilities, command ids or executable deep links. Reject unexpected
control characters and paths outside the canonical relative format. Native
import additionally enforces file-size/graph-size limits before rendering.

The bundled validator checks JSON Schema, unique ids and paths, references,
round cycles, graph connectivity/decision branches, correct flow evidence sides,
and known impossible file sides. With `--repo`, it verifies the commits, changed
inventory/statuses, unchanged context and actual evidence line bounds. It does
not verify review prose, test claims, patch correctness, repository remote
identity, or that the chosen base is the user's intended base. Report those
separate verification results honestly.

## Migration from `.prnav.json`

Migration is a proposed native import feature, not supplied implementation.
Import creates a new report and does not overwrite the original or silently
reassign reviewer state.

1. Resolve repository identity and exact base/head. Use `journey.reviewId`,
   `journey.base` and `journey.head` when present and verify against Git. Without
   verified commits, keep the legacy item in a “Needs comparison” import state;
   do not mint a valid v1 report by guessing refs or line sides.
2. Expand `pathPrefix` into canonical repo-relative paths. Use a fresh native Git
   inventory; retain round assignments when valid, map `oldPath` to
   `previousPath`, and derive stable file ids once. Existing fingerprints and
   line stats are hints to discard and recompute, not source truth.
3. Map a round's `why`, `exit` and questions; represent its explicit order as
   dependencies when that order was genuinely intended. Preserve old file focus
   but set missing TLDR/why to null and analysis to `partial` or `not-assessed`.
   Show “File summary missing.” Inventory can be complete while TLDR coverage is
   partial. Never relabel old focus as a summary of what changed.
4. Preserve valid finding ids. Old `medium` does not distinguish P1 from P2:
   preserve explicit old priorities, otherwise use null and `needs-verification`.
   Revalidate each anchor against the recorded revision before promotion. Missing
   or ambiguous anchors remain import warnings; they cannot become valid v1
   evidence. Do not silently drop findings with unresolved anchors.
5. Convert trusted legacy HTML into inert text/safe Markdown. Preserve readable
   content, discard interactive attributes/scripts/styles, and record conversion
   losses. Reconstruct old `ln`/`rn` half-row fix previews only when the contiguous
   source can be verified against head; otherwise keep the explanation with
   `patch:null` and an explicit limitation. Do not reinterpret them as standard
   unified-diff rows.
6. `riskFlow` is a risk-ordered reading guide, not proof of before/after user
   behavior. Preserve useful guidance in rounds, set `flows:[]` and
   `coverage.flowAnalysis:not-assessed` until an agent authors real flows. Preserve
   glossary/value derivations only after sanitizing and resolving their evidence.
7. Write `provenance.mode:legacy-import` with limitations. A separate app-owned,
   explicit state migration may bring over old dispositions/checkpoints only
   after matching identities and fingerprints. The agent never edits either
   app state or legacy `.prnav.triage.json` sidecars.
