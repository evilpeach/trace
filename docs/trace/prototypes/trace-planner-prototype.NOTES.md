# Trace Planner: design exploration

28 September 2026. Throwaway, self-contained HTML. No app source changes.

## Question

How can Trace explain a planned change from its motivation and overall behavior
down to individual tasks and criteria, before an implementation or PR exists?

The sample proposal is adding Planner to Trace. The current-state description is
grounded in the checkout at `ef3ea6e666c95631c1a06433f605b0a8a423e690`; proposed
modules, decisions and work are illustrative design content.

## Open

From the repository root:

```sh
python3 -m http.server 49382 --bind 127.0.0.1 --directory docs/trace
```

- Product plan: `http://127.0.0.1:49382/planner-plan.html`
- UI: `http://127.0.0.1:49382/prototypes/trace-planner-prototype.html`

Both HTML files also open directly from disk without dependencies or network
access. Relative links work when the documentation folder stays together.
Clipboard support varies by browser; the fallback selects the visible brief.

## Five layouts

| Variant | Structure | Tradeoff |
| --- | --- | --- |
| A · Workbench | Existing project shell, six sections, connected detail inspector. | Familiar and precise; more navigation than a single narrative. |
| B · Storyboard | A continuous why → behavior → delivery → agreement story. | Strong first read; longer scrolling and less direct comparison. |
| C · Blueprint | Architecture canvas first, then scope/tasks/criteria drilldowns. | Strong system orientation; needs the narrative to explain motivation. |
| D · Change lens | Select an experience, compare current/proposed side by side, switch between a journey and an aligned detail matrix. | Immediate change comprehension; wide comparisons need horizontal space and have less architectural context. |
| E · Delivery map | Select a work package in a dependency route; inspect its behavior change, deliverables and exit gate in place. | Strong implementation guidance; can draw attention to tasks before the product reasoning. |

**User decision, 5 October 2026: keep all five layouts; D is the default.**
Users change the overview in **Settings → Planner → Overview layout**. The
choice persists in this browser when storage is available. All layouts share
the same plan and detailed sections. Layout changes preserve plan state and
the current section. The floating switcher and arrow-key cycling are removed.

A saved preference takes precedence over legacy `?variant=` links. With no
saved preference, explicit valid links still preview their layout; an ordinary
open defaults to D. Save removes the legacy query when possible. Cancel changes
nothing, and Use default selects D pending Save. Plan decisions remain in memory.

## Try

- Open Settings, select any of A–E, and Save layout. Reload to confirm the saved
  selection. Cancel discards a pending choice; Use default (D) selects D for saving.
- In D, choose Start a plan, Understand impact, or Verify the outcome. Switch
  Big picture / Detailed view and follow the related work or acceptance criterion.
- In E, select packages from the dependency route or outline; Previous/Next
  changes the detail in place without marking anything complete.
- Open Before & after; compare current and proposed flows, select recovery
  scenarios, switch to architecture, and select a node to populate the inspector.
- Select a problem, follow its work package, and jump to a highlighted criterion.
- Filter scope by new/extended capability groups; expand implementation packages.
- Resolve both recommended decisions and check the three reading acknowledgments.
  Accept the demo revision, then open the handoff. This never launches an agent.
- Choose an alternative decision to see why the sample requires revision.
- In Validation, simulate a baseline change; handoff becomes unavailable until
  reassessed. Preview a new revision to reset agreement in the demo.
- New plan previews a custom heading/brief; sample proposal content remains labeled.
- Switch to Reviews for a contextual coexistence preview. It loads no real review.
- Light/dark controls change only this page; reload resets temporary plan state
  while retaining the saved layout preference.

## Original A–C verification (28 September)

- JavaScript syntax checked with Node.
- Browser walkthrough covered A/B/C, all six sections, scope filtering, expanded
  implementation packages, flow-node inspector and the invalid-artifact branch.
- Acceptance was blocked before reading/decisions; an alternative decision required
  revision; the recommended choices enabled acceptance and the handoff preview.
- A simulated baseline change disabled handoff copying; a new revision cleared
  acceptance, decisions and reading acknowledgments.
- Composer preview updated its title. Light and dark appearances were inspected.
- HTML product plan, section anchors and relative navigation were inspected.
- Browser diagnostics showed no JavaScript errors or warnings during the walkthrough.

These checks validate the desktop browser demonstration, not native behavior,
responsive device support, contract correctness, source-truth verification, or
implementation feasibility. Native source reads, agent requests, artifact import,
generation progress, persistent history and real review association are specified
in the plan but not implemented by this page. Diagram zoom is deferred to the
native implementation; this mockup fits diagrams and allows horizontal scrolling.

Port 4186 was intercepted by a cached service worker from a different local project.
The preview moved to 49382; the earlier server created for this task was stopped.
No unrelated server or browser storage was changed.

## D–E addition (29 September)

D and E extend the existing prototype; the other detailed sections and in-memory
acceptance behavior are shared. Five-way URL selection and arrow cycling replace
the original three-way switch. JavaScript syntax and local document links were
checked after the update. The new layouts have not been visually checked in a
browser: the browser automation policy rejected the existing `file://` preview.
No application source or persistent review state was changed.

## Settings decision (5 October 2026)

The default is D and all layouts are retained in a Settings radio chooser with
thumbnail diagrams, descriptions, Save, Cancel and Use default (D). Only the
layout preference is written to a namespaced browser-storage key; plan data,
notes, decisions and acceptance are not persisted by this prototype.

JavaScript syntax and an isolated execution check covered default D, all five
renderers, save/reload, cancel, reset, invalid stored values, legacy query
precedence, unavailable storage, and preservation of active section, selected
entity, reading acknowledgments and decisions. These are script checks, not a
browser visual walkthrough or native application implementation.

## Keep or remove

Keep `../PLANNER-PLAN.md` and its HTML edition in sync when revising the proposal.
The user chose to keep all five layouts with D as default. Reimplement them with
shared production components and the app preference store; do not promote this
prototype's DOM renderer or demo plan state into the app.
