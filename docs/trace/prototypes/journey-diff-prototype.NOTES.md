# Journey and diff: five layout explorations

29 September 2026. Standalone HTML design reference. A selected for implementation.

Question: how can a reviewer read a complete code diff without losing their place
in the user journey? The current app puts code in a panel that starts at 44% of
available width and limits the scroll area to `clamp(290px, 43vh, 560px)`.

The five layouts reuse Trace's neutral dark/light palette, review navigation,
journey steps, revision selection, evidence anchors, and review mark. They are
kept in the existing prototypes directory because this request is for standalone
HTML alternatives, rather than changes to the native application.

## Open

Open `journey-diff-prototype.html` directly, or run from the repository root:

```sh
python3 -m http.server 49383 --bind 127.0.0.1 --directory docs/trace/prototypes
```

Then open `http://127.0.0.1:49383/journey-diff-prototype.html?variant=A`.
The single HTML contains all CSS, JavaScript, sample data, and the existing Trace
favicon. It makes no external requests. A local preview server was left running
for this handoff; direct file opening remains available if the server stops.

## Compare

| Key | Layout | Advantage | Tradeoff |
| --- | --- | --- | --- |
| A | Focus modes | Full-width diagram or diff, with selection and code scroll retained between modes | Switching is needed to see the full graph again |
| B | Journey rail | Most of the width goes to code; step navigation stays beside it | The rail simplifies the graph; open the map to see the complete branching structure |
| C | Top & bottom | Full-width code and a linked graph stay visible together | Uses vertical space; smaller windows benefit from expanding the workspace |
| D | Code overlay | A diagram-first workspace opens a large code reader when needed | The overlay temporarily obscures the diagram |
| E | Guided story | Explanations and source excerpts read in journey order, with whole-file expansion | Repeated files and longer scrolling are less efficient for a deep file review |

Initial recommendation: A addresses the reported readability problem most
directly. B is the alternative to try when constant access to other steps matters.
This is a design judgment, not user-study evidence. The user selected A on 29 September 2026.

## Try it

- Use the bottom switcher, Left/Right keys, or `?variant=A|B|C|D|E`.
- Select steps and source-evidence files. The entry step has an explicit no-code state.
- Switch Before/After to change the authored behavior and highlighted evidence
  side; the code still compares base against head in either case.
- Switch between unified and split diffs, or whole-file and step-only scope.
  Split lines wrap to keep equal column widths; unified mode has a wrap toggle.
- Use the target icon to return to the evidence. Scroll the whole sample file.
- Expand the workspace with the top-right corner icon to hide surrounding chrome.
- A: switch Diagram / Code diff without losing the selected evidence file.
- B: collapse the journey rail or open the full map.
- C: adjust map height with the slider; choose a node to update its code.
- D: expand code, change steps in the overlay, and press Escape to return.
- E: expand an excerpt to its whole file or show the complete map above the story.
- Switch dark/light theme and toggle the preview-only journey review mark.

## Scope and fidelity

The screenshot supplies the TP/SL scenario. Source text is an authored illustrative
fixture, not a fetched diff for those commits. The sample has three complete small
files and generated before/after diff rows. File paths, revision labels, and counts
in the app frame establish comparable context; they do not claim a live report.
Actual sample row counts are shown in each code footer. No pagination is needed
for these small files. Large-file performance is not evaluated here.

No native Git access, persisted review state, external links, or application
settings are changed. State lives in memory; only the variant is kept in the URL.
The prototype is outside the production app bundle.

## Verification

- JavaScript syntax checked with `node --check`.
- All five layouts opened and inspected in the Codex browser at 1280 × 720.
- Verified diagram/code selection continuity, evidence-file changes, empty entry
  evidence, Before/After labels, unified/split rendering, equal split column widths,
  light appearance, rail collapse, whole-file story expansion, workspace expansion,
  code-overlay opening and Escape dismissal, and the map-height slider.
- At 960 × 800, verified code visibility, no horizontal page overflow, and the
  variant switcher's visibility. The viewport override was reset afterward.
- Browser reported no console warnings or errors during the walkthrough.
- Production source, native behavior, and large report performance were not tested
  or changed for this standalone design exploration.

## Decision

Selected: **A — Focus modes**, 29 September 2026. Implemented in the native app's
React frontend (`ReportViews.tsx`, `FlowCodePanel.tsx`, and `flow-code-panel.css`).
The production implementation retains real source loading, pagination, revision
boundaries, source links, and review state; it does not ship this illustrative
fixture or the variant switcher. This HTML remains a historical design reference.

Implementation verification: the existing frontend tests pass, type checking and
the production frontend build pass, and browser checks cover mode/evidence/zoom
retention and revision changes. A temporary 720-line source fixture verified that
evidence at lines 620–625 opens on the correct page and that manually choosing
rows 251–500 and then switching modes preserves both that page and its scroll.
The native executable was not rebuilt or installed for this frontend change.
