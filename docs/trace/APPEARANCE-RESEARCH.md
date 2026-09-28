# Trace appearance research

Research date: 24 September 2026. These recommendations are design judgments for
Trace's Mac review workflow, not a claim that one typeface is universally best.

## Recommendation

Use Linear's information hierarchy and T3 Code's neutral surface treatment.
Keep macOS system typography for UI and review prose; consider bundling JetBrains
Mono for source diffs. Use compact navigation, readable prose, and distinct
monospaced source without making every technical label monospaced.

- UI: native system sans (`-apple-system`, `BlinkMacSystemFont`, `system-ui`).
  This preserves the Mac feel and uses the installed platform font.
- Code: propose JetBrains Mono at 13px/20px, with ligatures disabled in diffs so
  operators retain their individual shapes. Keep native monospace as fallback.
- Alternative: Inter Variable for the UI if an identical appearance across
  platforms becomes a goal. It is a strong candidate, not a required replacement
  for the current native font.
- Starting type scale: navigation 13px; metadata 12px; review prose 14–15px;
  TLDR 16–18px; report title 24px. These are proposed Trace sizes, not copied
  measurements of Linear or T3. Validate at the actual Mac window size.
- Keep the review summary compact enough to reveal the file/flow entry points
  without a large opening paragraph dominating the screen.

## Verified reference facts

### Linear

Linear's 2024 redesign article documents Inter Display for headings and Inter for
other text. It discusses reducing chroma and deriving themes from base color,
accent and contrast. Its March 2026 refresh describes quieter sidebars, reduced
icon noise, softer separation, and less saturated, warmer gray default palettes.
These product-design articles are more relevant to Trace than the marketing page.

- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/now/behind-the-latest-design-refresh

Inference for Trace: the information hierarchy is a useful model for a workspace
that must show navigation, review guidance and source simultaneously. Exact current
authenticated-app font rendering was not inspected.

### T3 Code and T3 Chat

Current official T3 Code source uses system sans and system monospace stacks.
Its default dark palette defines a `#0a0a0a` canvas, `#111111` surfaces, black sidebar,
`#f5f5f5` foreground and `#346bf1` accent. Its named T3 Chat preset instead has
pink/purple-tinted surfaces. These are T3 Code source facts, not proof of the live
T3 Chat site's exact font or palette. Direct access to that site encountered a
Vercel security checkpoint, so its live typography was not verified.

- https://github.com/pingdotgg/t3code/blob/main/apps/web/src/index.css#L144-L148
- https://github.com/pingdotgg/t3code/blob/main/packages/shared/src/themePalettes.ts#L131-L377

The `main` links can change. Claims above reflect the source inspected on the
research date; older claims about a bundled DM Sans default do not match that source.

### Typeface sources

Inter provides text/display optical sizes and features including tabular numbers
and character disambiguation. JetBrains Mono explicitly distinguishes `1`, `l`,
`I`, `0` and `O` and offers optional programming ligatures. That supports considering
it for detailed code inspection; its publisher's description is not a comparative
usability study proving superiority over native monospace.

- https://rsms.me/inter/
- https://www.jetbrains.com/lp/mono/
- https://developer.apple.com/fonts/

## Color direction

Use neutral RGB values for persistent surfaces and ordinary text. Reserve green
for additions/success, red for removals/errors, amber for findings and the existing
copper accent for selected navigation and branding. Do not tint all surfaces with
the brand hue.

The initial neutral correction already applied to Trace's dark palette is:

| Role | Value |
| --- | --- |
| Sidebar | `#0c0c0c` |
| Main canvas | `#111111` |
| Raised panel | `#222222` |
| Selected surface | `#303030` |
| Primary text | `#ededed` |
| Secondary text | `#cccccc` |
| Muted text | `#aaaaaa` |
| Border | `#333333` |

These are Trace values, not asserted exact Linear tokens. Light/Dark/System remain
available. The Light palette remains as previously implemented; neutralizing its
sage cast would be part of a broader visual refinement.

## Implementation status

The green cast in Dark mode has been removed from surfaces, ordinary text, buttons,
borders, graph connections and scrollbars. The release Mac build passes and the
real Strat overview was visually checked in the rebuilt app. Color semantics for
diffs and review statuses remain. No font files were installed or bundled, and the
proposed type scale has not been applied.


## Implementation follow-up

The project-workspace update applies a proportional interface scale with a 15 px
base, independent 13 px code text, readable small labels, and persisted size controls.
The native system font stacks remain in use; JetBrains Mono has not been bundled.
