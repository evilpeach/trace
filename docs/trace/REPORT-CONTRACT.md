# Trace report contract

Trace consumes portable `.trace.json` reports. The report describes the review;
the Mac app resolves the checkout, reads Git snapshots, renders diffs and owns
reviewer progress. Version 1 is a proposed contract, not an implemented importer.

The canonical contract lives inside the portable skill so an agent receives the
same definitions as the app team:

- [Human-readable contract](skills/trace-report/references/contract.md): identity,
  file TLDRs, story flows, evidence, findings, missing states and legacy import.
- [JSON Schema](skills/trace-report/references/schema.json): executable Draft
  2020-12 structural validation, with unknown fields rejected.
- [Validator](skills/trace-report/scripts/validate.py): relational checks and
  optional verification against the exact Git commits.
- [Synthetic example](skills/trace-report/references/example.trace.json): a
  fictional two-file checkout change, explicitly marked as an example.
- [Agent skill](skills/trace-report/SKILL.md): generation and refresh workflow.

From the repository root:

```sh
python3 docs/trace/skills/trace-report/scripts/validate.py \
  docs/trace/skills/trace-report/references/example.trace.json
```

Validation needs Python 3 and `jsonschema>=4.18`. Schema/reference validation does
not establish source correctness. For a real report, add `--repo /path/to/repo` to
verify commits, inventory, status, source-side existence and line bounds. Semantic
claims still require the agent's code review and the human's judgment.
