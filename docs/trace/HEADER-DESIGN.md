# Compact review header

Accepted 28 September 2026: **A — Compact toolbar**, selected from five HTML
directions and implemented in the native app.

The previous header separated the date, title, branch, four actions, tabs, and
checkpoint banner into several tall blocks. The selected design uses two rows:

- Identity: PR badge, title, one-line branch comparison, Review actions, Mark done.
- Navigation: Overview, Files, User journeys, Findings, checkpoint status, progress, Details.

The PR badge supplies the number once. A matching leading PR prefix is removed
only from the displayed title; authored report titles remain unchanged. Long
titles and branches truncate with their full values available on hover and in
Details. PR comparisons retain base ← head direction.

Review actions contains Prepare updated report, Save/Update checkpoint, Report
details, and Change/Connect repository. Synthetic examples expose Reports instead
of native repository actions. Existing native and busy-state restrictions remain.
The menu supports keyboard navigation, Escape, outside dismissal, and focus
restoration when an action opens a dialog.

Details contains full branches and commit IDs, scope, generation date, repository,
local checkout, and personal review progress. The compact checkpoint control
distinguishes loading, absent, saved, changed, unavailable, and retry states. Its
comparison dialog retains entity navigation and the saved-baseline report link.
Saving a checkpoint does not mark files reviewed.

At narrower widths, status labels shorten while full descriptions remain
accessible. The header stays outside the scrolling review content. Focus diff
continues to hide it together with the file explorer.

Implementation: `apps/trace/src/components/ReviewHeader.tsx`,
`review-header.css`, and `ReviewChanges.tsx`, integrated by `App.tsx`.
The chosen design was rewritten as application components. The temporary HTML
variants were archived outside the source checkout after selection.

Validation:

- Type checks and all 160 existing tests pass; local macOS app build succeeds.
- Rebuilt native app inspected using the existing PR #331 report, with no changes
  to reviewer marks or its saved checkpoint.
- Keyboard menu navigation, Details, and checkpoint comparison verified in-app.
- Browser check at 1000px width, expanded sidebar, and 18px interface text:
  760px available header width, no row overflow, approximately 117px header height.
- React Doctor completed. It reported maintainability/style warnings, including
  complexity in the new header and a shared navigation export; no functional
  blocker was identified by source review or UI verification.
