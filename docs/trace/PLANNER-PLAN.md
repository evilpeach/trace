# Trace Planner

**Draft proposal · 28 September 2026 · Layout decision adopted 5 October 2026 · Not implemented**

Understand a change before it exists. Planner turns an intention into an inspectable proposal: why it matters, what happens today, what should happen instead, which parts of the system change, and how to implement and verify the result.

## 1. Product decision

Add **Planner** alongside **Reviews** inside each Trace project. Use **New plan** for creation and **Planning** for an activity status. A plan can exist before a branch, pull request, or code diff. Reviews remain the place to evaluate an actual implementation.

The prototype now offers **five layouts**. **A — Workbench** carries forward Trace's project navigation and contextual inspector. **B — Storyboard** puts the proposal into a guided narrative. **C — Blueprint** puts a system map first. **D — Change lens** aligns current and proposed behavior, with big-picture and detailed comparisons. **E — Delivery map** starts from implementation dependencies and reveals each package's before/after behavior, work and exit gate. **Decision adopted on 5 October 2026: retain all five layouts and use D — Change lens by default.** Users select their preferred layout in **Settings → Planner → Overview layout**. Layouts are supported presentations of the same plan, not competing prototypes awaiting a single winner.

The primary promise is: **“Show me why, show me the change, then show me how.”**

The layout preference is local to the user and applies across plans. A new installation, missing preference, or unsupported stored value falls back to D. Settings lists A–E with brief descriptions, marks D as the default, and offers Save, Cancel, and Use default (D). Saving updates the presentation without resetting plan content, selected entities, reading acknowledgments, decisions, acceptance or the active section. Detailed sections are shared; the preference changes Overview. Use the existing application preference store in the native implementation and keep it out of agent-authored plan artifacts. Remove the temporary floating variant bar and global arrow-key cycling.

The HTML demonstration remembers only the layout choice in browser storage. Other demo state remains temporary. A saved preference takes precedence over legacy `?variant=` preview links; without a saved preference, a valid explicit link can preview a layout. Saving removes the legacy query when possible. If browser storage is unavailable, apply the choice for the session and explain that it could not be saved.

## 2. What is missing today?

The current app starts from a PR or branch comparison. Its core sections are Overview, Files, Flows, and Findings. Reports require immutable base and head revisions; their before/after graphs describe those actual snapshots. This works for reviewing existing changes, but does not directly represent a proposal without an implementation.

| Current limitation | Proposed improvement | How we know it works |
| --- | --- | --- |
| Creation requires an existing comparison. | Start with a goal and a repository baseline; no PR required. | A user creates and reads a plan with no implementation branch. |
| Motivation can be scattered across a summary and findings. | Connect each problem to an outcome, behavior change, work package, and acceptance criterion. | Selecting a problem reveals the complete chain. |
| “After” means code at the head commit. | Label future behavior **Proposed** and keep it distinct from source evidence. | No proposed node implies that code exists or tests passed. |
| Review rounds guide reading, not implementation. | Give each work package dependencies, deliverables, validation, and a completion gate. | An implementer can act on one package without inventing its scope. |
| No first-class record links an agreed plan to subsequent reviews. | Freeze an accepted plan revision and explicitly associate later review snapshots. | Each criterion can be checked against actual evidence, including unmet and unknown results. |

This is a source-backed assessment of the current model, not user research or a measured productivity claim.

## 3. Entry points and lifecycle

**Project → Planner → New plan → Describe the goal → Inspect baseline → Read proposal → Resolve decisions → Accept revision → Copy implementation brief → Implement externally → Link a review → Check outcomes.**

New plan uses a compact composer: project, goal, motivation, constraints, and a baseline (current HEAD resolved to an exact commit by default). Optional inputs are an issue/specification, existing plan, or a finding from a review. A working-tree-only idea is allowed as context, but V1 source anchors use committed content; uncommitted changes are explicitly excluded and shown as such.

The first deliverable is an external-agent request, using Trace's existing provider-selection pattern. Show honest states: **Preparing request → Waiting for plan → Validating → Ready**, with explicit invalid, failed, cancelled, and interrupted states. Waiting is not a live analysis progress bar. Manual import is first-class. Importing a valid draft never accepts it automatically.

Plan organization states are **Draft**, **Ready to decide**, **Accepted**, **In implementation**, **Verified**, and **Archived**. “Needs refresh” and “Changes requested” are attention indicators. Acceptance records agreement with a particular revision, not permission to launch an agent or write code. Exporting a brief does not mark work implemented. Starting implementation and recording verification are separate explicit actions.

## 4. Information architecture

| Section | Main question | Content and interaction |
| --- | --- | --- |
| Overview | Why should we do this? | Motivation, current pain, intended outcomes, scope boundary, main before/proposed journey, readiness, unresolved decisions. |
| Before & after | What changes for people and the system? | Paired user flows, architecture views, state transitions, failure paths, node inspector, scenario selector, linked problems and criteria. |
| Scope | What will be touched? | Capabilities and planned file/module operations, existing context, exclusions, dependencies, blast radius, unknowns. |
| Implementation | In what order, and how? | Work packages, dependency graph, ordered roadmap, per-package deliverables, proposed file changes, validation, exit criteria, rollout and rollback. |
| Decisions | What still needs agreement? | Alternatives, recommendation and rationale, tradeoffs, blocking questions, risks, assumptions, user choices and revision history. |
| Validation | What would count as success? | Acceptance matrix, planned checks, evidence status, baseline refresh requirements, handoff, later review links and deviations. |

Keep the project shell stable when switching Reviews/Planner. Remember each workspace's reading position separately. The inspector can collapse to expand the reading canvas. Search can wait until the core reader works; avoid adding a second navigation system solely for planning.

## 5. Overview and detailed views

The overview is an authored explanation, not a dashboard of guessed scores. It shows a concise motivation, three to five problems/outcomes, one high-level journey, scope, and the next decision. Every summary item opens its relevant detailed entity.

Detailed entities form a traceable chain: **Problem → Outcome → Proposed behavior → Work package → Acceptance criterion → Implementation evidence**. Stable IDs let a reader follow this chain across diagrams, text, scope, and subsequent plan revisions.

For example, “A plan currently needs a head commit” leads to “Create a plan before coding,” the New plan flow, the baseline-only artifact work package, and a criterion that imports a plan without a PR or implementation head.

Selecting a graph node shows its role, what changes, why, evidence or assumptions, planned work, and success criteria. Selecting a file opens a current-source anchor and a proposed change description. A proposed path may not exist yet; do not display a verified editor link for it. V1 does not invent executable patches or line-level future diffs.

## 6. Visual vocabulary

| Visual | Use | Required semantics |
| --- | --- | --- |
| Paired user flow | Compare today's and intended experiences. | Explicit actor/trigger/outcome; labeled branches and failure/recovery paths. |
| Architecture map | Explain boundaries and data movement. | Current/proposed view, changed/new/unchanged legend, links to affected modules. |
| Dependency roadmap | Explain implementation order. | A directed acyclic work-package graph; parallel work only where dependencies allow it. |
| Scope chart | Show planned work distribution. | Counts derived from the actual inventory; counted unit and unknown coverage visible. |
| Acceptance matrix | Explain and later verify outcomes. | Planned / not checked / supported / failed / unavailable, with evidence for checked results. |

Default labels are **Current · observed at baseline** and **Proposed · not implemented**. Added, modified, retained, removed, and unknown are separate states; use words and shapes in addition to color. An added feature can have an explicit “Does not exist today” current state. Missing baseline evidence is “Unknown,” not an empty graph that looks like no behavior.

Use fit-to-view and zoom for large native diagrams; make a text outline available. Keep baseline and proposed selections synchronized by stable semantic IDs where possible, but explain added/removed nodes instead of inventing a one-to-one match. A scenario selector exposes happy, invalid-artifact, missing-source, and baseline-changed paths.

Charts describe known inventory or expressly labeled estimates. Do not display invented ROI, risk percentages, completion percentages, or time saved. Effort is optional, qualitative, and includes uncertainty; V1 does not need calendar scheduling.

## 7. Content model and ownership

Introduce a **separate versioned plan contract** and proposed `.trace/<slug>.trace-plan.json` artifact. Preserve the existing `.trace.json` review contract. The proposed suffix deliberately does not match today's `ends_with(".trace.json")` scanner; add explicit plan discovery instead of letting review imports misclassify a plan.

| Object | Key information |
| --- | --- |
| Plan | kind=plan, schemaVersion, planId, title, repository identity, generatedAt, baseline commit, optional parent revision digest, coverage and provenance. |
| Brief | Motivation, intended users, constraints, goals, non-goals, source requests and links. |
| Problem / outcome | Stable ID, explanation, evidence or assumption status, links to outcomes and acceptance criteria. |
| Scenario | Actor, trigger, current graph/status, proposed graph, rationale, affected modules and linked work. |
| Planned change | Operation (add/modify/remove/rename), existing path or proposed target path, current responsibility, proposed responsibility, rationale and work-package IDs. |
| Work package | Stable ID, deliverable, dependencies, detailed steps, files/modules, risks, checks, exit criteria, optional effort range with rationale. |
| Decision / risk | Alternatives, recommendation, tradeoff, blocking scope, mitigation and revisit trigger. |
| Acceptance criterion | Observable condition, validation method, related problems/scenarios/work; checks initially not run. |
| Provenance | Generator, inspected sources, structural/source validation, assumptions, unknown coverage and explicit limitations. |

The native app computes a canonical artifact digest for each immutable revision; planId is stable across revisions. Agents own the authored artifact. Git owns the observed baseline. Trace owns user decisions, notes, acceptance, work tracking, review associations, and history in separate local state. Never let an agent-written “approved” or “done” value become user approval or execution evidence.

Source evidence is anchored to the baseline commit, repository-relative path and line range. Proposed content links to planned changes and criteria; it does not claim future Git anchors. References to URLs/specs carry a source label and retrieval status. Planning can continue with a missing checkout, but unverified source remains explicit and verified editor actions stay unavailable.

Contract validation checks shape, unique IDs, references, safe paths, graph connectivity and branch labels, acyclic dependencies, required rationale, criterion coverage, evidence ranges and baseline identity when Git is available. Validation cannot prove the truth of a proposal or the adequacy of the solution. Acceptable unknowns must be recorded; missing required material prevents “Ready to decide.”

## 8. Acceptance, revision, and staleness

Acceptance requires a structurally valid plan, reviewed required sections, all blocking decisions resolved, and acknowledged assumptions. It records the exact revision digest and baseline. A missing current-source verification is a visible, explicit exception if acceptance is allowed; the conservative V1 default is to require refreshing repository-backed evidence before acceptance.

A new agent revision retains the old accepted revision in history and starts unaccepted. Compare added/updated/removed motivation, scope, flows, tasks and criteria. Retain reading progress only for unchanged entities. A previous decision may be carried forward only if its question, options, recommendation, and relevant evidence have the same fingerprint; otherwise require reconfirmation.

A moved branch does not rewrite a pinned baseline. Show “Repository advanced; impact not checked.” Recheck affected evidence and planned paths, then generate a new revision or record a native unchanged-impact assessment. Do not silently replace acceptance. An implementation change is not necessarily a plan failure; the later review compares agreed intent with the actual change and records explained deviations.

## 9. Delivery plan

All file locations below are **proposed targets**, except where identified as existing integration points. These are implementation slices, not completed work or time estimates.

| Slice | Deliverables | Dependencies | Exit gate |
| --- | --- | --- | --- |
| 1 · Contract & authoring | New `packages/plan-contract/`; schema/types/fixtures/validator; `docs/trace/skills/trace-plan/`; plan evidence semantics and authoring guidance. | None | A valid baseline-only plan passes; dangling IDs, cycles, false future anchors and malformed content fail. Existing review fixtures still pass. |
| 2 · Native import & state | Proposed `src-tauri/src/plans.rs`; immutable plan revisions, explicit scanner dispatch, separate decisions and acceptance, safe baseline/source reads, typed bridge operations. | 1 | Import/reopen works offline; a plan cannot enter the review parser; accepting one revision cannot accept a newer revision; review history remains intact. |
| 3 · Planner workspace | Proposed `components/planner/`; project mode switch; all five overview layouts with D as default and a saved Settings preference; paired flows, scope, implementation, decisions, validation and inspector. Reuse theme, safe text rendering and graph interaction primitives. | 1; 2 for end-to-end | Reader follows a problem through proposed behavior to work and acceptance. Default/reset, saved layout, cancellation and state preservation pass checks. Keyboard and large-graph reading work in light and dark themes. |
| 4 · Creation & handoff | New-plan composer, planning request packaging, existing external-agent provider selection, waiting/import/validation states, revision comparison, acceptance and copyable implementation brief. | 2, 3 | An agent-generated artifact is imported and accepted deliberately; cancel/invalid/retry work; exporting a brief never launches code changes. |
| 5 · Review connection & release | Associate actual review generations with an accepted plan; record criterion evidence and deviations; rollout/rollback and upgrade verification. | 4 | Agreed outcome maps to exact review evidence; missing/failed checks stay visible; existing review flows pass regression checks. |

Build slice 3 against fixtures while slice 2 is developed, after slice 1 stabilizes. Slice 4 waits for both. The first useful milestone is **1–3: import and inspect a plan**. The full V1 includes **4–5: create, agree, hand off, and verify**.

Existing integration points are `apps/trace/src/App.tsx`, `components/Projects.tsx`, `components/NewReview.tsx`, `components/FlowGraph.tsx`, `components/SafeMarkdown.tsx`, `native-types.ts`, `bridge.ts`, and native `projects.rs`, `requests.rs`, `store.rs`, `git.rs`, and `lib.rs`. Extract only shared primitives needed by both workflows; keep review decisions and plan acceptance separate. This is not a request to perform a broad app rewrite.

## 10. Acceptance scenarios

| ID | Observable outcome | Planned validation |
| --- | --- | --- |
| AC-01 | A plan opens with one baseline and no PR/head comparison. | Contract fixture, native import and creation walkthrough. |
| AC-02 | Every displayed future state is labeled proposed; nonexistent files have no verified source link. | Reader/component checks and visual walkthrough. |
| AC-03 | Selecting a problem reaches its flow, tasks and criterion without losing context in every layout. First use defaults to D; Settings remembers A–E without resetting plan state. | Navigation/selection checks; default, save/reopen, cancel, reset and invalid-preference checks; keyboard walkthrough. |
| AC-04 | Tasks appear in valid dependency order; unknown effort does not become an estimate. | Contract cycle fixtures and roadmap checks. |
| AC-05 | New revisions and changed baselines do not silently inherit acceptance. | Native persistence/reconciliation tests. |
| AC-06 | Invalid/missing artifacts, interrupted handoffs and missing Git source remain recoverable. | Native import/request scenarios and manual retry walkthrough. |
| AC-07 | Existing reports, reviewer decisions, checkpoint/resume and agent requests still work. | Current frontend/native/contract suites plus macOS regression walkthrough. |
| AC-08 | A linked review may leave criteria failed or unknown; a missing finding never counts as proof of a fix. | Association/evidence tests and one real end-to-end plan-to-review case. |

No implementation validation has run for this proposal. The HTML prototype only demonstrates layout and in-memory interactions.

## 11. Boundaries, risks and rollout

**V1 includes:** repository-backed plans, manual import, external-agent generation, structured explanations, two-state diagrams, task dependencies, decisions, revision history, explicit acceptance, exportable handoff and review association. **Deferred:** autonomous implementation, issue-tracker sync, team approval roles, multiplayer editing, scheduling, arbitrary diagram scripting, interactive patch application and automatic progress inference.

Key risks are confusing proposed behavior with verified behavior, invalidating accepted intent during refresh, overloading the navigation, and coupling the two contracts. Mitigate with explicit labels, immutable revisions, a small shared shell, independent validation, and clear ownership. The largest technical uncertainty is how much of the current flow inspector can be reused without forcing baseline/head assumptions into planning; prove this with one fixture before generalizing it.

Release behind an explicit Planner preview entry. Use synthetic fixtures first, then plan one real small Trace change through implementation and review. Preserve all review data during additive migrations. Rollback hides Planner and disables plan discovery while retaining imported plans and user state; it must not delete artifacts or downgrade a database destructively.

## 12. Decisions to make after the prototype

1. **Workspace direction — decided 5 October 2026:** keep A–E, use D by default, and let each user choose an overview layout in Settings. Preserve the plan and reading state when changing layout.
2. **Scope of V1:** recommend the complete create → inspect → accept → handoff → link review cycle, with import/read as the first delivery milestone.
3. **Baseline policy:** recommend committed snapshots only in V1; revisit captured working-tree snapshots later.
4. **Terminology:** recommend Planner as the workspace, New plan as the action, and Planning as an activity status.

## 13. Source audit and prototype limits

Inspected checkout: `ef3ea6e666c95631c1a06433f605b0a8a423e690` on 28 September 2026.

- `apps/trace/src/App.tsx`: current workspace modes and Overview/Files/Flows/Findings navigation.
- `packages/report-contract/src/index.ts`: required comparison, base/head evidence, before/after flow model and review rounds.
- `apps/trace/src/components/NewReview.tsx`: comparison-first composer and external-agent launch pattern.
- `apps/trace/src/components/FlowGraph.tsx`: selectable graph nodes, source anchors, zoom and fit controls.
- `apps/trace/src/review-workspace.ts`: review-specific organization, resume and flow selection.
- `apps/trace/src-tauri/src/projects.rs`: review artifact discovery suffix.
- `apps/trace/src-tauri/src/requests.rs`: request preparation, artifact arrival checks and import.
- `docs/trace/REVIEW-CONTINUITY.md` and current READMEs: current review continuity, ownership and source limitations.

The self-contained prototype illustrates **adding Planner to Trace itself**. Current-state observations are based on this audit; proposed tasks, decisions and future flows are design content. The browser does not read Git, call an agent, save native state, accept a real plan or verify code. Plan controls change temporary demo state only; Settings saves the layout preference in this browser when storage is available. The visual scope chart counts the six authored capability groups in the example, not actual files, elapsed work or measured benefit.
