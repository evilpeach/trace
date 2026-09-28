# Trace design system — proposal

Draft · 28 September 2026 · Based on checkout `5e21ea4` and the proposed Planner workflow. This is a design direction, not an implemented component library. **Folded Blueprint (variant 04)** is the selected app identity; its application is documented in the [branding guide](branding/README.md).

## Direction: a calm workspace for understanding change

Trace should feel precise, readable, and trustworthy over a long review session. Its recognizable quality should come from how well it connects an explanation to a diagram, source evidence, and a decision.

Use neutral surfaces, blue actions and selection, the blue/violet Folded Blueprint identity, and a consistent visual language for evidence. Reviews and Planner share the same shell and components. Their different claims are always labeled: Reviews describe existing snapshots; Planner can describe a proposed future.

The first design question is not which gray to use. It is whether a reader can immediately tell **what exists, what is proposed, what is supported, and what they have personally decided**.

## 1. Carry forward the useful parts

| Existing foundation | Recommendation |
| --- | --- |
| Neutral light/dark surfaces and blue/violet semantic tokens in `apps/trace/src/styles.css` | Keep these as the starting palette. Rename ambiguous roles gradually, without a visual rewrite. |
| 15 px UI and 13 px code defaults; separate size preferences in `apps/trace/src/preferences.ts` | Preserve independent scaling and honor the user's settings everywhere. |
| Accepted two-row compact header in `docs/trace/HEADER-DESIGN.md` | Keep identity/actions on row one and sections/context on row two. Extend the pattern to plans. |
| Collapsible 270 px sidebar in `apps/trace/src/workspace.css` | Keep project context stable between Planner and Reviews. |
| Node selection, source inspection, and a text transcript in `components/FlowGraph.tsx` | Standardize this interaction across all diagrams. |
| Immutable report snapshots and separate human decisions | Make these ownership boundaries visible in component labels and state models. |

`APPEARANCE-RESEARCH.md` describes an earlier copper selection accent; the current source uses blue. The selected Folded Blueprint identity follows the blue/violet direction. The earlier copper treatment remains historical exploration, rather than a second active brand accent.

## 2. Principles that settle design choices

1. **Explain, then expose evidence.** Start with the change and its effect; open exact source on demand.
2. **One place, multiple scales.** Move from project to change to flow to source without losing the selection or reading position.
3. **State the basis of a claim.** Observed, proposed, inferred, missing, and stale are meaningful states.
4. **Reserve emphasis for the next decision.** One strong action per local context; ordinary navigation remains quiet.
5. **Keep technical reading spacious.** Compact navigation and metadata; generous prose, diagrams, and code.
6. **Retain the user's work.** Reading, reviewing, accepting, executing, and verifying are distinct actions.

## 3. Color by role

These are proposed starting tokens, largely inherited from the app. Exact values can change without changing the role names.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `surface.canvas` | `#ffffff` | `#111111` | Main reading surface |
| `surface.navigation` | `#f7f7f8` | `#0c0c0c` | Project navigation |
| `surface.inset` | `#f5f6f8` | `#161616` | Diagram canvas, code context |
| `surface.raised` | `#ffffff` | `#222222` | Menus, dialogs, floating inspector |
| `text.primary` | `#232630` | `#ededed` | Body and essential labels |
| `text.secondary` | `#596273` | `#aaaaaa` | Supporting context and metadata |
| `border.subtle` | `#dfe2e8` | `#333333` | Nonessential separators |
| `border.control` | `#7d8798` | `#858b98` | Boundaries that are needed to identify a control |
| `action.text` | `#2459c9` | `#94b5ff` | Links and selected text |
| `action.fill` | `#315cd6` | `#4267d5` | Primary buttons with white text |
| `selection.surface` | `#e8efff` | `#1b294a` | Selected row or node |
| `brand.blue` | `#315cd6` | `#94b5ff` | Blue identity details alongside the full-color Folded Blueprint artwork |
| `proposal.text` | `#7142be` | `#c2a6ff` | Explicitly proposed behavior |
| `proposal.surface` | `#f1eafd` | `#2b2142` | Subtle proposed-state fill |
| `success.text` | `#18734c` | `#71d4a2` | A check with a recorded passing result |
| `attention.text` | `#925200` | `#f2c36c` | Needs refresh, unresolved decision, actionable uncertainty |
| `danger.text` | `#ba3548` | `#ff9cac` | Failed check, destructive action, blocking error |

Use the selected Folded Blueprint artwork for the app icon and small identity placements. Its blue/violet dimensional treatment belongs in the icon; controls and diagrams remain flat. Keep the porcelain tile in both appearances rather than recoloring the icon for dark mode. Do not infer the semantic status of content from the logo's colors.

Do not give Planner a violet application theme and Reviews a blue theme. Violet means **proposed** in either workspace. Observed evidence inside a plan remains neutral. A proposed fix inside a review is also violet.

Keep separate token names for diff additions and successful checks even when both use green. The label, icon, and context carry the distinction. Violet in the identity artwork is decorative; violet on a content label means proposed behavior.

## 4. Typography, spacing, and density

Use the existing macOS system sans stack for navigation and prose; use the existing system monospace stack for source, paths, line numbers, and revisions. A bundled code font can be evaluated later with actual diffs; it is not a prerequisite.

| Type role | Default size / line height | Use |
| --- | --- | --- |
| Workspace title | 18 / 25 px, semibold | Compact review/plan header |
| Section title | 16 / 23 px, semibold | Meaningful content divisions |
| Reading text | 15 / 24 px, regular | Explanations and plans |
| Navigation / controls | 13–14 / 20 px | Tabs, buttons, rows |
| Metadata | 12 / 18 px | Secondary provenance and timestamps |
| Code | 13 / 20 px | Diffs and source, separately adjustable |

Scale UI roles relative to the interface preference; do not hard-code tiny metadata that ignores larger-text settings. Keep prose around 60–85 characters per line where the workspace permits. Reserve monospace for technical content rather than whole paragraphs.

Use a 4 px spacing rhythm: 4, 8, 12, 16, 24, 32. Allow 2 px optical adjustments. Default controls are at least 32 px high; common navigation rows 36 px; comfortable rows 40 px. Density changes row spacing, never the user's reading or code font sizes. Avoid fixed heights for wrapped or enlarged text.

Radii: 4 px small labels, 6 px controls, 8 px bounded groups, 12 px dialogs. Use dividers and whitespace for ordinary sections. Reserve elevation for surfaces that float above other content.

## 5. Shared workspace anatomy

**Project sidebar → compact identity header → section navigation → main content → optional inspector.**

- Sidebar: preserve the current 270 px default; allow collapse and a future resize range of roughly 240–300 px.
- Header: preserve the accepted two-row arrangement. Move long revisions, dates, and repository paths into Details.
- Main content: allow source and diagrams to use available width. Keep narrative text within a reading measure.
- Inspector: approximately 320–360 px when there is room; switch to a drawer when the content region would become cramped.
- Make adaptation depend on available content width, including the sidebar, inspector, and chosen text size. At a 1000 px app window, collapse the inspector before squeezing the source. Offer unified diff when two readable source columns no longer fit.
- Focus diff hides surrounding chrome while preserving a clear way back and the previous workspace state.

Reviews keep Overview / Files / User journeys / Findings. Planner uses Overview / Before & after / Scope / Implementation / Decisions / Validation as proposed in its draft. Do not force a plan into a review-only tab structure.

## 6. Component layers

| Layer | Components | Required behaviors |
| --- | --- | --- |
| Foundations | Color, type, spacing, radii, focus, motion, density | Light/dark/system, independent UI/code scale, reduced motion |
| Basic controls | Button, icon button, link, field, checkbox, segmented choice, tabs, menu, dialog | Default, hover, focus, pressed, disabled, busy; clear accessible name |
| Workspace structure | Sidebar, compact header, section bar, split view, inspector, empty state | Collapse, resize where supported, long names, keyboard movement, preserved context |
| Trace language | Evidence reference, basis label, entity row, change summary, finding, flow node, source/diff pane, checkpoint, work package, acceptance criterion | Domain-specific states and precise links |

Build a small set of deeper components rather than a universal component with dozens of unrelated flags. For example, an evidence reference owns label formatting, verification availability, missing-source behavior, and navigation. A generic badge should not decide whether an evidence claim is true.

Prioritize the components that appear in both workflows: **EvidenceReference, BasisLabel, EntityRow, FlowNode, Inspector, and ChangeSummary**. Basic buttons alone will not make Trace consistent.

## 7. Separate state dimensions

| Dimension | Examples | Presentation |
| --- | --- | --- |
| Claim basis | Observed, proposed, inferred, unknown | Explicit basis label; proposed receives violet and a dashed boundary |
| Source availability | Available, unavailable, mismatch | Source reference with availability; disable only the unavailable navigation action |
| Change operation | Added, modified, removed, retained | Text or symbol; diff colors confined to change representations |
| Author assessment | Supported, needs verification, refuted | Assessment label with reasoning; never a user's review decision |
| User decision | Reviewed, confirmed, fixed, disputed, accepted revision | Neutral labeled check/decision; independent of machine checks |
| Validation | Passed, failed, not run, unavailable | Named check plus explicit recorded result |
| Freshness | Current, changed since checkpoint, needs refresh | Attention cue linked to a comparison or refresh explanation |
| Job state | Preparing request, waiting for artifact, validating, ready, failed | Honest state text; percentages only when measurable |

Show the most relevant state in the row and move secondary dimensions into the inspector. Avoid long badge strings. Use “Reviewed” for a human mark, “Passed” for a recorded check, and “Accepted revision” for a user's agreement to a plan. “Confirmed” on a finding means a confirmed defect, so it should not become a green success badge.

An evidence anchor does not establish correctness by itself. Prefer “3 source anchors” to an unexplained “Verified” badge. State structural validation, source matching, executed tests, and human agreement separately.

## 8. Diagram grammar

- **Observed:** solid neutral node, explicit Current/Observed label, source anchors when available.
- **Proposed:** dashed violet node, Proposed label, planned change/criterion references instead of invented source lines.
- **Inferred:** neutral node, Inferred label, explanation of the inference and supporting anchors.
- **Unknown/unavailable:** explicit text and missing evidence details; never an empty diagram that appears to prove absence.
- **Selected:** action-colored focus/selection treatment plus the inspector. Selection does not erase the node's basis label or proposed dashed border.
- **Decision:** a decision label/icon and named outgoing conditions. Labels such as valid, expired, retry, or cancel explain branches without relying on color.
- Edges stay neutral unless the edge itself is the subject of a meaningful status; no animated decorative traffic.
- Before/proposed views use corresponding semantic positions when possible. Identify added or removed nodes rather than fabricating matches.
- Charts show units, inventory definitions, and unknown coverage. No invented confidence percentages or completion scores.
- Every diagram has a text transcript and keyboard-accessible node inspection. Fit, zoom, and pan are navigation tools, not substitutes for legible node content.

## 9. Interaction and writing

Use verbs for actions: Inspect source, Mark reviewed, Save checkpoint, Accept revision, Copy implementation brief. Preserve selection and reading position when opening evidence or changing sections.

Use inline errors beside the operation that failed, with an actionable retry when supported. Use banners for workspace-wide stale or unavailable evidence. Use toasts for transient acknowledgments. Do not make a disabled button's tooltip the only explanation of a blocked action.

Empty states must identify their cause: No verified findings; Findings not assessed; No behavioral changes; Flows not assessed; Source unavailable; Waiting for plan. “No findings” is not a merge approval.

Motion: approximately 100 ms hover/pressed feedback, 160 ms local transitions, 220 ms drawers. These are initial design values. Honor reduced motion. Avoid shifting code lines during selection or animating long diagrams just for decoration.

## 10. Accessibility and acceptance checks

Target at least 4.5:1 for normal text and 3:1 for qualifying large text. Required control/state indicators and meaningful graphic parts need at least 3:1 against adjacent colors; decorative separators do not all need the same contrast. These thresholds follow [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Check actual foreground/background pairs, including selected rows, proposed nodes, syntax colors, focus rings, and disabled explanations. A palette swatch review alone is insufficient. Use icon/shape/text alongside color. Retain visible keyboard focus, dialog focus restoration, and text transcripts.

Acceptance scenarios for implementation:

1. Review a long title and branch name at 1000 px window width, expanded sidebar, and 18 px interface text; actions remain usable.
2. Switch Reviews/Planner and light/dark appearance; component roles and color meanings remain consistent.
3. Select a proposed node; its basis remains clear while the inspector updates.
4. Review a supported finding with an unrun test; assessment and check result cannot be confused.
5. Save a checkpoint; file review decisions remain independent.
6. Open a stale plan baseline; acceptance and implementation state do not silently advance.
7. Use keyboard-only navigation through sections, diagrams, menus, and dialogs; read the same flow as a transcript.
8. Inspect a large diff with enlarged code text and reduced motion; source context remains stable.

## 11. Adoption order

1. Use the selected Folded Blueprint identity; agree on the remaining visual direction and state vocabulary independently.
2. Consolidate tokens and document their roles. Retain compatibility aliases while moving from names such as `sage`, `paper`, and `accent-secondary` to semantic names.
3. Standardize controls and the accepted shell, starting with shared states and focus behavior.
4. Build evidence references, basis labels, entity rows, flow nodes, and inspector behavior in the existing review workspace.
5. Use those components for Planner as its contract and workflow are implemented.
6. Add a small component gallery covering light/dark, long text, larger type, missing evidence, stale data, and busy/error states. Keep it part of future UI review.

The interactive study accompanying this proposal explores the shared visual language with illustrative content. It does not implement Planner, native source navigation, review storage, or a production design-system package.

## Preview validation performed

- Inspected the shared shell in dark mode and the copper alternative in light mode with 18 px interface/code settings.
- Checked mode switching, overview/findings/implementation views, current/proposed comparison, node inspection, criterion/source expansion, the simulated review mark, and unresolved-plan decision display.
- Confirmed keyboard activation retains focus on the selected node.
- Checked 1024 px layout with enlarged text and narrow conversation-preview reflow at 360/320 px; the 320 px viewport had no fragment horizontal overflow. This narrow preview accommodation does not add mobile support to the native app's scope.
- Browser console reported no errors in the inspected study.
- Calculated 12 representative contrast pairs: tested text/button pairs ranged from 5.08:1 to 16.13:1; proposed-state text pairs were 5.56:1 (light) and 7.29:1 (dark); tested required control boundaries were 3.35:1 and 4.65:1. These samples pass the corresponding targets, but are not a full accessibility audit or proof of native-app compliance.

The study includes host design controls for action palette, appearance, density, interface size, and code size. Their bindings are provided in the study; host-side control delivery was not exercised in the standalone browser preview.
