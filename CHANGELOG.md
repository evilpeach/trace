# Changelog

## Trace 0.1.0 — 2026-09-28

- Introduce a standalone macOS app built with Tauri, React, TypeScript, and Rust,
  with source navigation through GitHub and VS Code links.
- Add projects, PR/report histories, automatic report detection, a review inbox,
  and resumable reading positions.
- Guide review creation from a PR or branch comparison, discover connected PR
  stacks, and prepare one report per selected PR. Hand off to Codex or Claude in
  Terminal with model and effort selection, or copy a request for another session.
- Bundle the portable report skill, schema, synthetic example, and validator.
  Validate report identity, comparison commits, file inventory, and source evidence.
- Show per-file TLDRs, dependency rounds, split/unified committed diffs, findings,
  and the PR’s main end-to-end journey. Add zoomable before/after diagrams with an
  inline code inspector.
- Persist reviewer decisions separately from reports. Compare snapshots against
  saved checkpoints and distinguish changed code from changed review guidance.
- Add Light/Dark/System appearance, semantic colors, independent text sizes,
  configurable shortcuts, sticky file context, Focus diff, and a collapsible
  workspace sidebar.
- Provide development, build, and test commands. Keep local reports and generated
  artifacts out of source control.

This is a local macOS development build. Release signing, notarization, universal
builds, and automatic updates are not configured. Agent handoff uses an external
Terminal session; Trace does not supervise or cancel that process.
