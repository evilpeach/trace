# Trace: creating the first review

Throwaway design exploration, 24 September 2026. This is separate from the
production Tauri app. It uses a fictional Orbit PR #341 comparison against stacked
PR #338; no agent executes, no repository is read by the page, and no reports or
application preferences are written. The request text is explicitly a demo and
does not export the real report toolkit.

## Open

From the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory docs/trace/prototypes
```

Open `http://127.0.0.1:4178/trace-onboarding-prototype.html?variant=B`.
The HTML is self-contained and can also be opened directly. Clipboard availability
depends on the browser; a select-and-copy fallback is provided.

## The question

Which structure makes it easiest to understand how a report is created, choose
the right changes, and follow the result without learning the JSON/skill setup?

| Variant | Structure | Strength | Tradeoff |
| --- | --- | --- | --- |
| A: Guided setup | Project, comparison, generation in three steps | Explicit sequence and contextual instruction | Repeated Continue/Back actions; context spread across steps |
| B: Quick composer | Single compact form with visible comparison and optional details | Short common path; scope and action together | Needs good defaults and a small setup step when context is missing |
| C: Project workspace | Project checklist beside a creation panel | Clear project ownership and a home for activity | More competing information before the first report |

**Recommended direction: B for creation, C's project activity after submission.**
Use contextual setup when a project or agent is missing. Do not force every user
through a separate tour. Keep the stacked base visible; a one-click action is only
useful if it reviews the correct changes. This is an informed design judgment,
not a result from a user study. The user selected B on 27 September 2026.
The production implementation uses this direction with persistent review activity
and a real external-agent handoff; the simulated runner stays in this prototype.

## Try it

- Switch variants in the floating bar, or use Left/Right outside input controls.
  The URL records the variant; each variant keeps independent in-memory state.
- Choose Light, Dark, or System in the top bar. Reset affects the current variant.
- Change PR/current-branch selection and the comparison base. The bundled report
  is only available for the stacked comparison; a main comparison is unresolved.
- Preview an in-app run, advance stages, cancel, or simulate a failure and retry.
- Choose your existing agent, inspect its prepared request, simulate report
  arrival, and finish validation. External activity never claims analysis progress.
- Start a new draft while waiting, then return through the sidebar. The activity
  remains available; a second concurrent run for this project is not started.
- Open the saved example's Overview, Files, Flows, and Findings previews.

## Verification

JavaScript syntax checked with Node. Browser walkthrough covered all three
layouts, light/dark appearance, the guided steps, simulated in-app completion,
external request instructions, invalid-report retry, external validation-only
progress, and activity recovery after starting another draft. No production test
suite or native build is needed for this standalone HTML exploration.

The chosen composer is implemented in the app. This design reference is excluded
from the native bundle and does not describe every current interaction.
