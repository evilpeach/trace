# Trace documentation

Trace is the standalone macOS review app in [`apps/trace`](../../apps/trace/README.md).
The [app guide](../../apps/trace/README.md) documents implemented behavior, setup,
keyboard shortcuts, and current limits.

## Specifications and report tooling

- [Product specification](SPEC.md) and [HTML edition](spec.html): product direction
  and acceptance criteria, including future milestones. These are not a release
  checklist; consult the app guide for what currently ships.
- [Review continuity](REVIEW-CONTINUITY.md): checkpoints, inbox/resume, and the
  flow/code inspector.
- [Report contract](REPORT-CONTRACT.md): schema and authoring rules.
- [Portable report skill](skills/trace-report/SKILL.md): agent instructions,
  schema, Python validator, and a synthetic example. Trace bundles these resources
  when preparing a review request; global skill installation is optional.
- [Appearance research](APPEARANCE-RESEARCH.md) and
  [diagram library research](DIAGRAM-RESEARCH.md): design rationale and references.

Validate the bundled example from the repository root:

```sh
npm run test:contract
```

The validator requires Python 3 and `jsonschema>=4.18`. For a real report, use
`--repo` to check the Git inventory and source ranges:

```sh
python3 docs/trace/skills/trace-report/scripts/validate.py \
  /path/to/project/.trace/report.trace.json --repo /path/to/project
```

The synthetic example exercises the format, not a real repository comparison.
Schema validation does not establish the truth of review prose.

## Historical interactive prototypes

These self-contained HTML artifacts preserve the design exploration. They are
not the native implementation and do not establish its present feature coverage.

- [Workspace variants](prototypes/trace-prototype.html): A — Workbench,
  B — Story canvas, and C — Review brief. The app adopted Workbench with flow and
  overview ideas from the other directions.
- [Onboarding variants](prototypes/trace-onboarding-prototype.html): alternative
  paths for creating a report; Variant B informed the implemented New review flow.
- [Onboarding prototype notes](prototypes/trace-onboarding-prototype.NOTES.md).

Open either HTML file directly on macOS:

```sh
open docs/trace/prototypes/trace-prototype.html
open docs/trace/prototypes/trace-onboarding-prototype.html
```

Their examples are synthetic. Import, agent runs, validation, review state, and
editor handoffs are simulations; they do not read Git, run a CLI, or persist native
review decisions. The workspace prototype uses representative code excerpts,
not full repository diffs. No package installation or network connection is needed.
