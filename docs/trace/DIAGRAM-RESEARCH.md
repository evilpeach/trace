# Trace diagram interaction research

Researched 24 September 2026 against official documentation and source repositories.

## Recommendation

Use **React Flow (`@xyflow/react`) with Dagre (`@dagrejs/dagre`)**. Trace diagrams are structured review evidence: nodes must remain selectable, branches and joins must remain explicit, and reviewers need to move between an overview and readable detail.

| Option                         | What it supplies                                                                                                                             | Trace tradeoff                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Flow                     | Interactive React nodes and edges; drag panning, scroll/pinch zoom, viewport controls, keyboard focus and automatic panning to focused nodes | Best fit for evidence-driven graphs. Layout is a separate concern.                                                                                                                        |
| react-zoom-pan-pinch           | Zoom, pan and pinch for an existing HTML/SVG subtree; transform controls                                                                     | Good for a mostly static illustration. Trace would still maintain graph routing, keyboard node navigation, focus visibility and graph layout itself.                                      |
| Existing manual HTML/SVG graph | Small implementation, full rendering control                                                                                                 | Current fixed card heights, truncated branch conditions and wide scrolling canvas caused the screenshot's navigation/readability problems. Custom interaction would add more maintenance. |

These are fit judgments for Trace, not benchmark claims. Official references: [React Flow viewport controls](https://reactflow.dev/learn/concepts/the-viewport), [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [React Flow Controls](https://reactflow.dev/api-reference/components/controls), and [react-zoom-pan-pinch README](https://github.com/BetterTyped/react-zoom-pan-pinch).

## Layout choice

React Flow does not supply an automatic layout engine. Its [layout guide](https://reactflow.dev/learn/layouting/layouting) presents Dagre as a relatively simple directed-graph layout and ELK as a more configurable alternative. Trace currently needs small, immutable, left-to-right behavior graphs rather than a general diagram editor. Dagre is sufficient for this scope and keeps the integration synchronous and straightforward.

[Dagre's documentation](https://github.com/dagrejs/dagre/wiki) describes node dimensions as layout inputs and edge bend points as outputs. Trace uses the actual measured card sizes, reserves room for complete wrapped transition labels, and renders those routed points. The graph remains immutable: readers select evidence, not edit the report. ELK remains a possible later choice if nested groups, complex ports or stricter edge-routing requirements are introduced.

## Implemented behavior

- Pointer drag pans; wheel/trackpad pinch zooms.
- Visible minus, plus, percentage/reset-to-100%, and Fit controls.
- Fresh before/after and story graphs initially fit their steps to the viewport.
- Cards display complete labels; transition conditions wrap instead of being truncated.
- Layout uses measured card sizes, so long descriptions and UI font-size changes do not overlap adjacent cards.
- Nodes remain keyboard-focusable and selectable; focusing a node pans it into view. The diagram region also supports arrow keys, `+`, `-`, `0`, and `F`.
- The existing complete text transcript and transition-evidence links remain available beneath the canvas.
- Each diagram has its own provider and unique DOM/ARIA marker scope, including the main-journey overview.
- Colors inherit Trace's light/dark palette; graph typography inherits the app's UI font size where possible.

Installed versions for this implementation: `@xyflow/react` 12.11.6 and `@dagrejs/dagre` 3.1.1. Both packages are MIT licensed. React Flow attribution remains visible.

## Verification

Four layout regression tests cover branch/join order, measured tall-card separation, cycle/self-loop/parallel-edge preservation, disconnected nodes, finite edge geometry, and full long-label retention. TypeScript checks pass. Native visual/interaction verification is tracked with the encompassing app implementation.
