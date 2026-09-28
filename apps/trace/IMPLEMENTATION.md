# Trace implementation

Trace is a standalone Tauri 2 macOS app with a React/TypeScript interface and a
Rust backend. The [app guide](README.md) describes the current user workflow;
[the product specification](../../docs/trace/SPEC.md) also includes future goals.

## Ownership and boundaries

- Agents author portable `.trace.json` explanations, evidence, flows, and findings.
  The canonical schema, example, skill, and Python validator live in
  `docs/trace/skills/trace-report`. Review requests embed these resources.
- `packages/report-contract` provides shared TypeScript types and structural and
  semantic validation. Its generated validator runs without dynamic code
  generation under the native content-security policy.
- Rust validates reports and repository mappings, resolves immutable Git objects,
  reads committed source, discovers reports, and stores progress in SQLite.
  Missing Git objects are reported; Trace does not fetch them automatically.
- React owns presentation and local reading preferences, including navigation,
  report organization, appearance, font sizes, and editable keyboard shortcuts.
- Reviewer decisions and checkpoints stay separate from agent-authored reports.
  Source and guidance fingerprints determine whether earlier decisions are stale.

## App workflow

Projects contain pull requests and immutable report snapshots. New review checks
an explicit comparison, optionally discovers a PR stack, and prepares one report
request per selected PR. Agent, model, and effort choices are passed to an
installed Codex or Claude CLI through macOS Terminal. The CLI retains its normal
sign-in and approval flow; Trace tracks validated report arrival, not agent
execution progress.

The review workspace combines the main journey, file TLDRs, dependency rounds,
split/unified diffs, zoomable flow graphs, source evidence, and findings. GitHub
links use immutable commits. VS Code links require a verified local source match.
The inbox, checkpoints, and saved reading positions support revisiting a review.

The workspace sidebar can collapse with its toolbar icon or the configurable
Command-B shortcut. Compact sticky file context and Focus diff provide more room
for source. Light, Dark, and System appearance and separate interface/code sizes
are persisted preferences.

## Reproducible checks

From the repository root:

```sh
npm ci
npm run check
npm test
npm run test:native
npm run test:contract
npm run build
```

The Python contract check needs `jsonschema>=4.18`. Native tests use temporary Git
repositories and SQLite stores, not a developer's review library. The synthetic
`apps/trace/resources/example-sources.json` fixture is a required build input for
both the browser preview and native example. Build artifacts and local `.trace/`
reports are excluded from Git.

For a manual native import/source check, run
`python3 apps/trace/scripts/create-smoke-fixture.py` and use its printed temporary
checkout and report paths. The fixture is intentionally synthetic.

## Current limits

Agent process supervision, detection while the app is closed, GitHub Viewed sync,
release signing/notarization, universal builds, and automatic updates are not
implemented. Full VoiceOver, physical trackpad, and large-report performance
acceptance remain separate release gates. Trace does not apply source fixes or
publish review comments. The browser preview cannot perform native Git or agent
operations.
