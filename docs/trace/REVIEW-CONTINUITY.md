# Review continuity

This milestone adds three connected features to the existing macOS workspace:
checkpoint comparison, a review inbox with resume, and an inline flow/code inspector.

## Since your last review

The saved checkpoint is the comparison baseline. Its immutable report digest is
resolved within the same repository and report identity. Merely reading a
comparison must not activate the baseline or change review decisions.

Show added, updated, removed, and unchanged files, flows, and findings. A finding
that disappears is **No longer reported**, never automatically **Fixed**. Updates
can include explanation and evidence changes, not only source changes. Retain
reviewed marks only when the existing fingerprint establishes unchanged source
and review guidance. Missing baseline or unavailable source must be explicit.

Saving a checkpoint moves the baseline forward and does not mark anything
reviewed. Users can explicitly open the older report to inspect removed items.

## Inbox and resume

Projects contain PRs (or branch reviews) with immutable report histories. Provide
New, Updated, In progress, Done, and Archived views, plus project/PR pinning.
Done is a personal organization state, separate from file decisions, findings,
GitHub approval, or merge status. A newly available report can make a completed
review require attention again.

Persist organization and reading sessions locally in versioned WebView storage.
Review decisions and checkpoints remain in SQLite. Resume the selected section,
file/flow/finding, evidence, file filters and layout, diagram revision/step, and
primary reading-pane scroll. Restore an exact report's valid selections. When
moving to a different generation, reconcile IDs and clear restrictive filters
and stale reading offsets; explain the reset so new work stays visible.

Opening historical reports must not silently mark later reports seen. Archiving
hides organization items without deleting reports or review decisions. Archived
items remain available through the inbox.

## Flow and code together

The flow diagram stays visible when a step or source anchor is selected. A
resizable inspector contains that step, its source anchors, and the committed
base/head diff. Previous/Next follow authored node order rather than claiming an
execution route across branches. Before/After selects evidence from the proper
report revision. Steps without code anchors explain the absence.

Support collapse/reopen, pointer and keyboard resizing, and the existing GitHub
and verified VS Code source actions. Async diff loads must not show a previous
step's source after selection changes. Missing checkout, unavailable Git source,
and unsupported content retain explicit error or unavailable states.

## Verification

Use regression tests for baseline isolation, read-only snapshot comparison,
entity changes, retained valid marks, inbox transitions, storage normalization,
and session reconciliation. Run frontend/native checks and visually exercise the
native app with an isolated sample PR, then verify the real Strat report still
opens. Source files in the reviewed Strat checkout are outside this edit scope.
