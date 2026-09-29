# Trace

A standalone macOS workspace for understanding a code review: file TLDRs,
cross-file behavior, findings, and full-width Git diffs. Built with Tauri 2,
React, TypeScript, and a Rust backend.

## Run

From the repository root, install Node.js 22.12+ (or a current supported LTS),
Rust 1.91+, and Xcode Command Line Tools. Then:

```sh
npm install
npm run dev
```

Build a local macOS application:

```sh
npm run build
open apps/trace/src-tauri/target/release/bundle/macos/Trace.app
```

The build targets the current Mac's architecture. It is a local development
build; signing, notarization, universal builds, and automatic updates are not yet
configured for distribution.

## Create a review

Open **New review** in the sidebar. Choose a project/worktree, then either paste a
GitHub PR URL or choose a branch comparison. PR lookup uses an installed,
signed-in GitHub CLI; Trace does not fetch missing Git objects.

For a PR, **Discover stack** finds connected open pull requests from their base
and head branches. Every discovered PR starts selected, in dependency order; clear
any you do not want to review, then choose **Check selected comparisons**. **Review
only this PR** checks one PR directly. For a branch, choose **Check comparison**.
These checks show each exact merge base, head, and changed-file count before
preparation. Each selected PR has a separate report using its own comparison.
Ambiguous links, forks, cycles, or bounded lookup limits are reported instead of
silently widening the review. Discovery uses GitHub branch relationships; it does
not read Graphite or other stack-tool metadata.

Add an optional review focus, then choose **Agent**, **Model**, and **Effort**.
Trace remembers the last choices for each agent. **Use CLI default** passes no
override; choose a specific model to select from its supported effort levels.
Codex models come from its local model catalog. Claude offers documented model
versions; account and provider availability still apply. **Run with Codex** or
**Run with Claude** prepares review requests and opens the installed CLI in macOS
Terminal with those choices and the requests loaded. Your existing CLI account
and normal approval flow remain in use. Sign-in, tool approvals, agent output, and stopping the agent stay
in Terminal. A batch instructs one agent session to produce each selected report in
order. **Prepare a request to copy instead** provides a manual handoff; for a batch,
it prepares a separate request for each selected PR. Use **Refresh agent availability**
after installing a CLI while Trace is open.

Trace packages the report skill, contract, example, and Python validator with exact comparison
instructions. You can also copy the prepared request into your existing coding
agent with access to that checkout. No global skill installation or Trace source
checkout is needed. The portable validator requires Python 3 and `jsonschema>=4.18`.

**Review activity** persists across app restarts. Trace checks the request's exact
`.trace/requests/<request-id>/report.trace.json` output, validates its identity,
commits, complete file inventory, and source evidence, then marks it **Ready**.
It does not open it or change your review decisions until you choose **Open review**.
Use **Check now** when automatic detection is off. **Import manually** accepts a
report saved elsewhere only if it matches the same request. Validation failures
provide a repair request you can copy back to your agent.

Preparing an unfinished request again reuses it when the target, worktree, exact
commits, review focus, and previous report match. Its output path, report identity,
and validation feedback stay intact. A conflicting unfinished request for that
target must be completed or stopped first. Different selected PRs may share a
checkout. If part of a batch fails to prepare, completed preparations remain in
Review activity and no agent is launched for that partial batch.

**Stop waiting** stops Trace's checks; it does not stop your external agent. A
completed report can still be imported separately. **Prepare updated report**
preserves a report's identity and supplies its previous snapshot so the agent can
retain stable file/flow/finding IDs. When reviewing a stack again, each PR uses its
own matching report history; sibling PRs do not inherit the seed PR's identity.

Trace records when a request was sent to Terminal, then waits for the validated
report. A successful handoff is not evidence that the agent authenticated, finished,
or passed tests. Trace does not supervise or cancel the external CLI process.
Local preparation and CLI handoff are available in the Mac app; the browser preview
supports example/import exploration.

The launch integration follows the installed CLIs' interactive prompt interfaces:
[Codex CLI](https://learn.chatgpt.com/docs/developer-commands#codex-interactive) and
[Claude Code CLI](https://code.claude.com/docs/en/cli-reference).
Model and effort overrides follow [Codex developer settings](https://learn.chatgpt.com/docs/developer-settings)
and [Claude model configuration](https://code.claude.com/docs/en/model-config).
The recorded handoff includes the requested model and effort; it does not claim
the provider accepted them or that a review finished.

## Projects and automatic detection

Projects group repositories, pull requests, and immutable report snapshots. Use
**Add project** to connect a repository or worktree by folder or absolute path.
Existing imported reports and connected checkouts migrate into this structure.
Multiple worktrees with the same repository identity share a project.

Trace checks connected `.trace/*.trace.json` folders on launch, when the app
regains focus, and every 30 seconds while visible. Detection is enabled by default;
**Review inbox → Check now** runs a manual check. New snapshots appear without moving
the report you are reading or replacing your review decisions. Unchanged content
is deduplicated across restarts. Invalid reports are explained in Projects.
Subdirectories, symlinks, and special files are not followed. A scan is bounded to
1,024 directory entries, 256 report files, and 64 MiB total.

The project name in the top bar opens its reports. The adjacent selector switches
between PRs and report snapshots in that project; the final label shows the active
review section. The back and forward buttons navigate selections within the current report. Each
PR number appears once in the selector; a short commit identifies its snapshot.

## Review inbox and checkpoints

The inbox groups PRs into **New**, **Updated**, **In progress**, **Done**, and
**Archived**. Pin important projects or PRs; archive finished work without deleting
its reports. Newly detected snapshots surface as Updated even for a completed PR.
Done is a personal status and does not approve a GitHub PR or mark findings fixed.

**Continue review** restores the selected section, file/flow/finding, source
anchor, file filters, layout, diagram revision/step, and primary reading position.
Opening a different snapshot reconciles its selections and clears restrictive
filters and scroll offsets so new changes are visible. Organization and sessions
persist in local WebView storage; decisions and checkpoints remain in SQLite.

The compact review header keeps the title, branch direction, section tabs, and
personal **Mark done** action visible. **Review actions** contains report updates,
checkpoint saving, and repository selection. **Details** shows the full title,
branches, commit IDs, file counts, and report date.

**User journeys** shows the report’s documented behaviors across source files;
the tab count is the number of journeys, not a severity or issue count. Reports
can explicitly designate their central end-to-end behavior with
`mainJourney: { flowId, why }`. Trace places it first, labels it **Main journey**,
and shows **Why this matters**. A different selected journey keeps its own label.
Older reports remain readable and show that a main journey has not been identified;
the app never infers importance from array order. Valid saved selections are preserved.
Priority and risk remain in linked findings, separate from the main designation.

Journey review has two full-width modes: **Diagram** for the authored behavior and
**Code diff** for its committed source. Select a diagram step and choose **Read
code**, then use the step ribbon or Previous/Next to follow its evidence. Switching
modes retains the selected step, evidence, diagram viewport, diff page, and code
scroll position. Unified/Split controls change the diff layout. **Expand** hides
the surrounding review context for more reading space; **Restore** brings it back.
Before/After changes the authored snapshot and resets its step selection. The
collapsed **Journey context** retains the actor, trigger, outcome, and rationale.

Save a checkpoint before leaving a review. The checkpoint status control beside
the tabs opens **Since your last review**, comparing the open report with that
exact saved snapshot and listing new,
updated, and removed files, flows, and findings. A disappeared finding is labeled
**No longer reported**, which does not claim it was fixed. Unchanged reviewed
files retain their marks when their source and review guidance still match.
Updating a checkpoint moves the baseline forward without marking files reviewed.

## Settings

Open **Settings** in the sidebar or top bar, or press **⌘,**.

- **Appearance:** Light, Dark, or System. System follows live macOS appearance;
  explicit choices also update the native window. Dark uses neutral black/charcoal.
- **Interface text:** 14–18 px, default 15 px, with proportional report typography.
- **Code text:** independent 12–18 px, default 13 px. Operator ligatures are off.
- **Diffs:** side-by-side or unified; optional long-line wrapping.
- **Detection:** enable/disable automatic scans of connected project folders.
- **Keyboard shortcuts:** record a replacement chord, disable a shortcut, or reset
  individual shortcuts/all defaults. Conflicts and reserved editing/system keys
  are explained before saving.

Preferences persist locally and apply immediately. Reset defaults restores System
appearance and the default reading/review choices. Browser previews save their own
appearance and reading settings.

## Keyboard and workspace layout

| Action                              | Default shortcut  |
| ----------------------------------- | ----------------- |
| Go back / forward within a report   | ⌘[ / ⌘]           |
| Collapse / expand workspace sidebar | ⌘B                |
| Search review                       | ⌘K                |
| Open Settings                       | ⌘,                |
| New review                          | ⌘N                |
| Overview / Files / Flows / Findings | ⌘1 / ⌘2 / ⌘3 / ⌘4 |
| Focus diff in Files                 | ⌘⇧F               |

The sidebar icon remains in the top bar when collapsed, and its state survives
restarts. **Focus diff** hides the report header and file explorer for a wider,
taller code view. The selected file path, actions, and compact TLDR remain sticky
while reading code; **Context** expands the explanation and review questions.
Text-editing fields retain their usual editing behavior. The browser preview uses
Ctrl instead of ⌘ on non-Apple platforms.

## Journeys and findings

Overview features the first authored end-to-end journey, including its actor,
trigger, intended outcome, before/after graphs, and exact evidence. Other authored
journeys can be selected. The report skill puts the main journey first; Trace does
not infer extra flow coverage.

Diagrams use React Flow with Dagre: drag to pan, scroll/pinch to zoom, use ±,
reset to 100%, or Fit. Keyboard controls support arrows, ±, 0, and F, while a text
transcript remains available. See [the library research](../../docs/trace/DIAGRAM-RESEARCH.md).

In **Flows**, selecting a step opens its evidence and committed diff beside the
diagram. Resize the divider by dragging or using Left/Right, Home, and End while
focused. Collapse the inspector for more canvas space. Previous/Next follow the
report's authored step order; they do not imply an execution route through a
branch. Before/After shows anchors from the matching snapshot. **Open in Files**
provides the full-width split diff; GitHub and verified VS Code actions remain
available in the inspector.

P0–P3 are severity levels, not list numbers: Critical, High, Medium, and Low.
Findings retain the report’s actual severity and are sorted by severity. A report
with only a **P2 / Medium** finding begins there; Trace does not invent missing
severity levels to fill the sequence.

## First review

1. Use **New review** to prepare a comparison and run your CLI or copy the request.
   Open the validated result from **Review activity**. You can also **Explore an
   example** for a synthetic walkthrough or **Import a report** you already have.
2. If an imported report has no local checkout, connect one containing its exact base/head commits.
   Choose the repository folder, choose any regular file inside it, or enter
   the checkout's absolute folder path. Trace finds the Git root and checks the
   changed-file inventory and every source range before enabling source access.
   Missing commits must be fetched separately.
3. Read the overview, file summaries and split/unified diffs, behavior flows, and
   findings. Unchanged supporting files are available through evidence links.
4. Mark files and flows reviewed, record finding decisions, and save a checkpoint.
   These decisions persist separately from the immutable imported report.
5. Each file has GitHub and VS Code actions. GitHub opens an immutable commit
   URL (GitHub.com repositories); source anchors open VS Code at their exact line. Trace checks that the current
   local file matches the report's selected snapshot before handing off; it shows
   an explanation if the checkout has moved or the source is otherwise unavailable.

For integrations and manual generation, the portable report skill is
[`docs/trace/skills/trace-report/SKILL.md`](../../docs/trace/skills/trace-report/SKILL.md).
Give it to your agent and ask for a report for a chosen base/head comparison. It
ships with the schema, example, and a Python validator. It is not installed into
your global agent configuration automatically.

Trace stores its database and imported reports in the macOS application-data
directory for `dev.trace.review` (normally
`~/Library/Application Support/dev.trace.review`). Report content never supplies
native filesystem paths or executable commands. Git reads are bounded and do not
fetch missing objects or run repository hooks, text converters, or external diffs.

## Browser preview

```sh
npm run dev:web
```

Open `http://127.0.0.1:1420`. The browser can display reports and the bundled example;
review decisions and imported reports last only for that page session. Appearance,
inbox organization, and reading positions use that browser's local storage.
Local Git access, native repository selection, persistent reports/decisions, and VS Code handoff require the desktop
app. Imported reports do not receive invented source previews.

## Checks

```sh
npm run check
npm test
npm run test:native
npm run test:contract
```

Schema validation is precompiled so the Mac app can keep its content-security
policy without runtime code generation. If the canonical schema changes, run
`npm run generate-validator --workspace @trace/report-contract`. Build, check,
and test commands reject a stale generated validator.

For a real Git integration fixture, this creates a new temporary repository with
two commits and writes a report beside its sources. It never modifies this repo:

```sh
python3 apps/trace/scripts/create-smoke-fixture.py
```

Import the printed report and select the printed checkout in Trace. This is an
integration fixture, not a review of production code.

## Reports and examples

**Explore an example** opens a bundled synthetic walkthrough. The portable JSON
example is at
[`docs/trace/skills/trace-report/references/example.trace.json`](../../docs/trace/skills/trace-report/references/example.trace.json).
Its commit IDs and source previews are illustrative; it is not a production review.

For your own repository, generate `.trace/report.trace.json` with the report skill
and import it, or connect the project for automatic detection. Guided requests
use their own `.trace/requests/<request-id>/report.trace.json` output paths.
Keep these reports local or share them deliberately; this repository ignores its
own `.trace/` folder. No private project report or developer-specific checkout is
required to run Trace.

## Current scope

The app covers guided review creation, PR-stack selection, Terminal CLI handoff,
report import, exact committed-source review, file and flow TLDRs, finding evidence,
editor handoff, and local progress. The full
product specification is in [`docs/trace/SPEC.md`](../../docs/trace/SPEC.md).
CLI agent supervision, filesystem event watching while the app is closed, legacy report migration,
GitHub Viewed sync, and release distribution remain later milestones. Trace does
not apply fixes or publish review comments.
