# Trace sidebar exploration

Question: How should Trace organize projects, reviews, and agent requests without
repeating the same PR at several levels?

Decision: **B — Focused project**, selected by the user on 29 September 2026.
This HTML remains a historical design reference; native behavior is documented in
the [app guide](../../../apps/trace/README.md).

Open `trace-sidebar-prototype.html` directly, or run from the repository root:

```sh
python3 -m http.server 4179 --bind 127.0.0.1 --directory docs/trace/prototypes
```

Visit `http://127.0.0.1:4179/trace-sidebar-prototype.html?variant=B`.
The A–E controls, previous/next arrows, and keyboard left/right arrows switch
variants. URL parameters survive reload; all other prototype state is in memory.

## Findings from the current app

- The sidebar mixes global navigation, request activity, and a three-level
  project → PR → report tree. Continue/start actions add another row per PR.
- The inbox counter currently counts projects; project counters count report
  snapshots; review statuses describe PR/branch groups. These units are unclear.
- Recent activity repeats PRs already listed in projects.
- A report snapshot remains necessary for comparison and continuity, but does
  not need to be a permanent sidebar navigation row.

## Alternatives

| Variant | Navigation model | Best fit | Tradeoff |
| --- | --- | --- | --- |
| A — Project library | Collapsible named projects, one row per review | Familiar project organization | Large projects need filtering or Show all |
| B — Focused project **(selected)** | One project switcher, local filters, flat review list | Reviewing one repository for a sustained period | Other projects’ activity is less visible |
| C — Review queue | Global progress queues with project scope | Cross-project daily triage | Reviews move as their status changes |
| D — Project rail | Project icons plus a separately collapsible review drawer | Fast switching and more code space | Initials need labels and learning |
| E — Stack navigator | Project, named stack, ordered PRs | Stacked features with many related PRs | Requires persisted, trustworthy stack relationships |

The user selected **B** for its focused project navigation. **E** remains an
unselected proposal: current stack discovery in New review is not a persisted
sidebar model. The comparison records design tradeoffs, not measured usability
results.

## Shared decisions and interactions

- Every review row shows its title, one PR number (or Branch), and review status.
- Report history moves to **Reports** in the selected review’s upper-right corner.
- Counts say **reviews**, **reports**, or **waiting** instead of mixing bare numbers.
- Agent activity is separate from reviewer progress. Waiting does not claim that
  the external agent is running. Updated means an unread report snapshot, not
  necessarily new GitHub commits. Done does not approve or merge a PR.
- New review, import, project switching, search, settings, help, project primer,
  pinning, archive/restore, and report history remain reachable.
- Try **⌘B** (sidebar/drawer), **⌘K** (search), and **⌘N** (new review).
- Light, Dark, and System are available for previewing contrast.
- In production, review selection should retain the current unread-report /
  last-visited / latest targeting behavior. This prototype opens a sample review.

## Boundaries

All counts, statuses, report history, source excerpts, and stack relationships are
illustrative. Familiar project and PR names anchor the designs in the user's
workspace, but this is not a live review report. No Git reads, agent launches,
file uploads, settings persistence, or native reviewer-state writes occur.
The same representative workspace is used across variants for a fair comparison.
No external packages, fonts, or network assets are required.

## Accepted implementation behavior

- Put one project switcher above a flat list with one row per PR or branch review.
  Do not repeat report snapshots or Continue actions as nested navigation rows.
- Keep search and **All / Needs review / In progress / Done** filters local to
  the selected project. Needs review combines **New** and **Updated**; these
  statuses retain their existing unread-report semantics.
- Count PR/branch reviews in the list and filters, not report snapshots. Label
  counts explicitly; report history separately counts **reports**.
- Move immutable report generations to a **Reports** control for the selected
  review. Opening a review preserves the existing unread-report, last-visited,
  then latest targeting rules; choosing a historical report remains explicit.
- Keep global **Agent activity** separate from the project list and reviewer
  progress. Any activity count describes requests across all projects. Waiting
  for an external report does not establish that an agent process is running.
- Preserve New review, import, inbox/archive access, project management, settings,
  help, pinning, and the editable sidebar shortcut (default **⌘B**).
- When navigation opens a review outside the current project, switch project and
  clear list constraints as needed to reveal the selected review.

Implement B as native application components. The A–E HTML is retained only in
the documentation's historical prototypes, not bundled into the application.
Its in-memory actions and synthetic counts do not establish native behavior.

## Validation

JavaScript syntax and whitespace checks pass. All five variants were inspected
in the browser. Interaction checks covered filtered search revealing the selected
review, project switching resetting report selection, cross-project queue scope,
and the project rail remaining accessible when its drawer is collapsed. Light and
dark colors were checked; these checks do not validate native app integration.
