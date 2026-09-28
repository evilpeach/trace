use crate::{
    git,
    store::{Store, EXAMPLE},
    types::*,
    validation,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;

fn command(root: &Path, args: &[&str]) -> String {
    let output = Command::new("/usr/bin/git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Trace test")
        .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
        .env("GIT_COMMITTER_NAME", "Trace test")
        .env("GIT_COMMITTER_EMAIL", "test@example.invalid")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

struct Fixture {
    _temp: TempDir,
    root: PathBuf,
    state: PathBuf,
    report: Value,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo # with spaces");
        let state = temp.path().join("state");
        fs::create_dir_all(root.join("src")).unwrap();
        command(&root, &["init", "-q"]);
        let mut report: Value = serde_json::from_str(EXAMPLE).unwrap();
        report["repository"]["id"] = json!("local:trace-integration-test");
        report["provenance"]["mode"] = json!("agent");
        let sources: Value =
            serde_json::from_str(include_str!("../../resources/example-sources.json")).unwrap();
        for side in ["base", "head"] {
            for f in items(&report, "files")
                .iter()
                .chain(items(&report, "contextFiles"))
            {
                fs::write(
                    root.join(text(f, "path")),
                    sources[text(f, "id")][side].as_str().unwrap(),
                )
                .unwrap();
            }
            command(&root, &["add", "."]);
            command(&root, &["commit", "-qm", side]);
            report["comparison"][side]["oid"] = json!(command(&root, &["rev-parse", "HEAD"]));
        }
        validation::validate(&report).unwrap();
        git::verify(&root, &report).unwrap();
        Self {
            _temp: temp,
            root,
            state,
            report,
        }
    }
    fn store(&self) -> (Store, LoadedReport) {
        let mut store = Store::new(self.state.clone()).unwrap();
        let report = store.import_value(self.report.clone()).unwrap();
        let repo = store.choose(&self.root).unwrap();
        let report = store.attach(&report.handle, &repo.checkout_id).unwrap();
        (store, report)
    }
    fn comparison(&self, store: &Store, loaded: &LoadedReport) -> ReviewComparison {
        store
            .resolve_review(ResolveReviewInput {
                checkout_id: loaded.repository.as_ref().unwrap().checkout_id.clone(),
                kind: "branch".into(),
                base_ref: Some(text(&self.report["comparison"]["base"], "oid").into()),
                head_ref: Some("HEAD".into()),
                pr_url: None,
                previous_report_handle: Some(loaded.handle.clone()),
            })
            .unwrap()
    }
    fn request(&self, store: &mut Store, loaded: &LoadedReport) -> ReviewRequest {
        let comparison = self.comparison(store, loaded);
        store
            .prepare_review(PrepareReviewInput {
                comparison_token: comparison.token,
                focus: "Account switching".into(),
            })
            .unwrap()
    }
}

#[test]
fn review_request_setup_resolves_merge_base_and_preserves_refresh_identity() {
    let fixture = Fixture::new();
    let (store, loaded) = fixture.store();
    let checkout = &loaded.repository.as_ref().unwrap().checkout_id;
    let setup = store.review_setup(checkout).unwrap();
    assert_eq!(setup.base_source, "previous-report");
    assert_eq!(
        setup.default_base_ref.as_deref(),
        fixture.report["comparison"]["base"]["oid"].as_str()
    );
    let comparison = fixture.comparison(&store, &loaded);
    assert_eq!(comparison.changed_file_count, 2);
    assert_eq!(comparison.report_id, text(&fixture.report, "reportId"));
    assert_eq!(
        comparison.prior_report_handle.as_deref(),
        Some(loaded.handle.as_str())
    );
    let old_head = text(&fixture.report["comparison"]["head"], "oid");
    command(
        &fixture.root,
        &[
            "checkout",
            "--detach",
            text(&fixture.report["comparison"]["base"], "oid"),
        ],
    );
    fs::write(fixture.root.join("unrelated.txt"), "advanced base\n").unwrap();
    command(&fixture.root, &["add", "."]);
    command(&fixture.root, &["commit", "-qm", "advanced base"]);
    let advanced_base = command(&fixture.root, &["rev-parse", "HEAD"]);
    command(&fixture.root, &["checkout", "--detach", old_head]);
    let resolved = store
        .resolve_review(ResolveReviewInput {
            checkout_id: checkout.clone(),
            kind: "branch".into(),
            base_ref: Some(advanced_base),
            head_ref: Some(old_head.into()),
            pr_url: None,
            previous_report_handle: None,
        })
        .unwrap();
    assert_eq!(
        resolved.base.oid,
        text(&fixture.report["comparison"]["base"], "oid")
    );
    assert_eq!(resolved.head.oid, old_head);
    assert_eq!(resolved.changed_file_count, 2);
}

#[test]
fn review_requests_persist_export_toolkit_and_import_without_activating() {
    let fixture = Fixture::new();
    let (mut store, loaded) = fixture.store();
    let reviewed = store
        .decide(
            &loaded.handle,
            "file",
            "file-session",
            Some("reviewed"),
            loaded.state.revision,
            None,
        )
        .unwrap();
    let request = fixture.request(&mut store, &loaded);
    assert_eq!(request.status, "waiting");
    for file in [
        "SKILL.md",
        "references/contract.md",
        "references/schema.json",
        "references/example.trace.json",
        "scripts/validate.py",
    ] {
        assert!(
            fs::metadata(Path::new(&request.toolkit_path).join(file))
                .unwrap()
                .len()
                > 100
        );
    }
    let previous: Value = serde_json::from_slice(
        &fs::read(
            Path::new(&request.toolkit_path)
                .parent()
                .unwrap()
                .join("previous.trace.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(previous, fixture.report);
    assert!(request.prompt.contains(&request.output_path));
    assert!(request.prompt.contains("Account switching"));
    assert!(request.prompt.contains("omit pullRequest"));
    assert!(request.prompt.contains("mainJourney.flowId"));
    assert!(request.prompt.contains("mainJourney.why"));
    assert!(request.prompt.contains("Do not use array order"));
    assert!(request.prompt.contains("omit mainJourney"));
    assert!(!request.prompt.contains("\"pullRequest\": null"));
    assert_eq!(store.check_review(&request.id).unwrap().status, "waiting");
    let comparison = fixture.comparison(&store, &loaded);
    assert!(store
        .prepare_review(PrepareReviewInput {
            comparison_token: comparison.token,
            focus: String::new()
        })
        .unwrap_err()
        .contains("REVIEW_ALREADY_WAITING"));
    drop(store);
    let mut store = Store::new(fixture.state.clone()).unwrap();
    assert_eq!(store.review_requests().unwrap()[0].id, request.id);
    fs::write(&request.output_path, b"{\"partial\":").unwrap();
    assert_eq!(
        store.check_review(&request.id).unwrap().status,
        "needs-attention"
    );
    assert_eq!(store.list().unwrap().len(), 1);
    let mut updated = fixture.report.clone();
    updated["files"][1]["analysis"]["tldr"] = json!("Refreshed checkout explanation.");
    fs::write(&request.output_path, serde_json::to_vec(&updated).unwrap()).unwrap();
    let complete = store.check_review(&request.id).unwrap();
    assert_eq!(complete.status, "ready");
    assert!(complete.report_handle.is_some());
    assert_eq!(store.list().unwrap().len(), 2);
    // The old report still owns the unchanged human revision and decisions.
    let state = store
        .decide(
            &loaded.handle,
            "file",
            "file-checkout",
            Some("reviewed"),
            reviewed.revision,
            None,
        )
        .unwrap();
    assert_eq!(state.files["file-session"].decision, "reviewed");
    drop(store);
    let store = Store::new(fixture.state.clone()).unwrap();
    assert_eq!(store.review_requests().unwrap()[0].status, "ready");
}

#[test]
fn review_requests_reject_mismatched_identity_inventory_and_git_evidence() {
    let fixture = Fixture::new();
    let (mut store, loaded) = fixture.store();
    let request = fixture.request(&mut store, &loaded);
    for pointer in [
        "/reportId",
        "/repository/id",
        "/comparison/base/oid",
        "/comparison/head/oid",
    ] {
        let mut report = fixture.report.clone();
        *report.pointer_mut(pointer).unwrap() = if pointer.ends_with("/oid") {
            json!("a".repeat(40))
        } else {
            json!("different-review")
        };
        fs::write(&request.output_path, serde_json::to_vec(&report).unwrap()).unwrap();
        let result = store.check_review(&request.id).unwrap();
        assert_eq!(result.status, "needs-attention");
        assert!(result.error.unwrap().contains("REPORT_MISMATCH"));
        assert_eq!(store.list().unwrap().len(), 1);
    }
    let mut report = fixture.report.clone();
    report["pullRequest"] = json!({"number":1,"url":"https://github.com/example/orbit/pull/1"});
    fs::write(&request.output_path, serde_json::to_vec(&report).unwrap()).unwrap();
    assert!(store
        .check_review(&request.id)
        .unwrap()
        .error
        .unwrap()
        .contains("PR_MISMATCH"));
    let mut report = fixture.report.clone();
    report["coverage"]["inventory"] = json!("partial");
    report["summary"]["outcome"] = json!("incomplete");
    fs::write(&request.output_path, serde_json::to_vec(&report).unwrap()).unwrap();
    assert!(store
        .check_review(&request.id)
        .unwrap()
        .error
        .unwrap()
        .contains("INCOMPLETE_INVENTORY"));
    let mut report = fixture.report.clone();
    report["evidence"][0]["endLine"] = json!(999999);
    fs::write(&request.output_path, serde_json::to_vec(&report).unwrap()).unwrap();
    assert!(store
        .check_review(&request.id)
        .unwrap()
        .error
        .unwrap()
        .contains("EVIDENCE_RANGE"));
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn cancelled_requests_ignore_late_output_and_ordinary_discovery() {
    let fixture = Fixture::new();
    let (mut store, loaded) = fixture.store();
    let request = fixture.request(&mut store, &loaded);
    store.cancel_review(&request.id).unwrap();
    fs::write(
        &request.output_path,
        serde_json::to_vec(&fixture.report).unwrap(),
    )
    .unwrap();
    assert_eq!(store.check_review(&request.id).unwrap().status, "cancelled");
    assert_eq!(
        store
            .import_review_path(&request.id, Path::new(&request.output_path))
            .unwrap()
            .status,
        "cancelled"
    );
    assert_eq!(store.discover().unwrap().imported, 0);
    assert_eq!(store.list().unwrap().len(), 1);
    drop(store);
    let mut store = Store::new(fixture.state.clone()).unwrap();
    assert_eq!(store.check_review(&request.id).unwrap().status, "cancelled");
    assert_ne!(fixture.request(&mut store, &loaded).id, request.id);
}

#[test]
fn request_output_rejects_symlinks_fifos_oversize_and_replaced_directories() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let (mut store, loaded) = fixture.store();
    let request = fixture.request(&mut store, &loaded);
    let target = fixture.root.join("outside.trace.json");
    fs::write(&target, serde_json::to_vec(&fixture.report).unwrap()).unwrap();
    symlink(&target, &request.output_path).unwrap();
    assert_eq!(
        store.check_review(&request.id).unwrap().status,
        "needs-attention"
    );
    fs::remove_file(&request.output_path).unwrap();
    assert!(Command::new("/usr/bin/mkfifo")
        .arg(&request.output_path)
        .status()
        .unwrap()
        .success());
    assert!(store
        .check_review(&request.id)
        .unwrap()
        .error
        .unwrap()
        .contains("regular report file"));
    fs::remove_file(&request.output_path).unwrap();
    fs::File::create(&request.output_path)
        .unwrap()
        .set_len((crate::store::MAX_REPORT_BYTES + 1) as u64)
        .unwrap();
    assert!(store
        .check_review(&request.id)
        .unwrap()
        .error
        .unwrap()
        .contains("LIMIT_EXCEEDED"));
    fs::write(
        &request.output_path,
        serde_json::to_vec(&fixture.report).unwrap(),
    )
    .unwrap();
    let directory = Path::new(&request.output_path).parent().unwrap();
    let moved = fixture.root.join("moved-output");
    fs::rename(directory, &moved).unwrap();
    symlink(&moved, directory).unwrap();
    assert!(store
        .check_review(&request.id)
        .unwrap()
        .error
        .unwrap()
        .contains("UNSAFE_PATH"));
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn manual_request_import_is_correlated_and_validates_before_ready() {
    let fixture = Fixture::new();
    let (mut store, loaded) = fixture.store();
    let request = fixture.request(&mut store, &loaded);
    let alternate = fixture.root.join("manually-selected.json");
    let mut wrong = fixture.report.clone();
    wrong["reportId"] = json!("wrong-request");
    fs::write(&alternate, serde_json::to_vec(&wrong).unwrap()).unwrap();
    assert_eq!(
        store
            .import_review_path(&request.id, &alternate)
            .unwrap()
            .status,
        "needs-attention"
    );
    assert_eq!(store.list().unwrap().len(), 1);
    let mut valid = fixture.report.clone();
    valid["title"] = json!("Manually completed report");
    fs::write(&alternate, serde_json::to_vec(&valid).unwrap()).unwrap();
    let ready = store.import_review_path(&request.id, &alternate).unwrap();
    assert_eq!(ready.status, "ready");
    assert!(ready.report_handle.is_some());
    assert!(!Path::new(&request.output_path).exists());
    assert_eq!(store.check_review(&request.id).unwrap().status, "ready");
}

#[test]
fn review_preflight_requires_known_tokens_explicit_base_and_matching_project() {
    let fixture = Fixture::new();
    let (mut store, loaded) = fixture.store();
    assert!(store
        .prepare_review(PrepareReviewInput {
            comparison_token: "untrusted-frontend-token".into(),
            focus: String::new()
        })
        .unwrap_err()
        .contains("UNKNOWN_COMPARISON"));
    let checkout = loaded.repository.unwrap().checkout_id;
    assert!(store
        .resolve_review(ResolveReviewInput {
            checkout_id: checkout.clone(),
            kind: "branch".into(),
            base_ref: None,
            head_ref: None,
            pr_url: None,
            previous_report_handle: None
        })
        .unwrap_err()
        .contains("BASE_REQUIRED"));
    assert!(store
        .resolve_review(ResolveReviewInput {
            checkout_id: checkout.clone(),
            kind: "branch".into(),
            base_ref: Some("--help".into()),
            head_ref: None,
            pr_url: None,
            previous_report_handle: None
        })
        .unwrap_err()
        .contains("INVALID_REF"));
    assert!(store
        .resolve_review(ResolveReviewInput {
            checkout_id: checkout,
            kind: "pull-request".into(),
            base_ref: None,
            head_ref: None,
            pr_url: Some("https://github.com/other/project/pull/1".into()),
            previous_report_handle: None
        })
        .unwrap_err()
        .contains("REPOSITORY_MISMATCH"));
    assert!(!fixture.root.join(".trace").exists());
}

#[test]
fn report_paths_reject_relative_and_non_regular_objects() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    assert!(store
        .import_path(Path::new("relative.trace.json"))
        .unwrap_err()
        .contains("absolute local path"));
    assert!(store
        .import_path(temp.path())
        .unwrap_err()
        .contains("regular report file"));
    assert!(store
        .import_path(Path::new("/dev/null"))
        .unwrap_err()
        .contains("regular report file"));
    let fifo = temp.path().join("report-fifo.trace.json");
    assert!(Command::new("/usr/bin/mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    // This returns without opening the FIFO or waiting for a writer.
    assert!(store
        .import_path(&fifo)
        .unwrap_err()
        .contains("regular report file"));
}

#[test]
fn report_path_import_preserves_schema_size_and_duplicate_checks() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    let path = temp.path().join("report with spaces.trace.json");
    fs::write(&path, EXAMPLE).unwrap();
    let first = store.import_path(&path).unwrap();
    let second = store.import_path(&path).unwrap();
    assert_eq!(first.handle, second.handle);
    fs::write(&path, "{}").unwrap();
    assert!(store.import_path(&path).is_err());
    fs::File::create(&path)
        .unwrap()
        .set_len((crate::store::MAX_REPORT_BYTES + 1) as u64)
        .unwrap();
    assert!(store
        .import_path(&path)
        .unwrap_err()
        .contains("LIMIT_EXCEEDED"));
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn repository_paths_require_absolute_directories_and_resolve_git_root() {
    let fixture = Fixture::new();
    let mut store = Store::new(fixture.state.clone()).unwrap();
    assert!(store
        .choose(Path::new("relative-repo"))
        .unwrap_err()
        .contains("absolute local path"));
    assert!(store
        .choose(&fixture.root.join("src/session.ts"))
        .unwrap_err()
        .contains("repository directory"));
    let repository = store.choose(&fixture.root.join("src")).unwrap();
    assert_eq!(
        PathBuf::from(repository.display_path),
        fixture.root.canonicalize().unwrap()
    );
}

#[test]
fn reads_committed_diff_even_after_checkout_is_edited() {
    let fixture = Fixture::new();
    let (store, report) = fixture.store();
    let original = store.diff(&report.handle, "file-session").unwrap();
    assert_eq!(original.base.kind, "text");
    assert!(original.patch.contains("accountId"));
    assert!(original.additions.unwrap() > 0);
    fs::write(
        fixture.root.join("src/session.ts"),
        "malicious unrelated local content\n",
    )
    .unwrap();
    assert_eq!(
        store
            .diff(&report.handle, "file-session")
            .unwrap()
            .head
            .text,
        original.head.text
    );
    assert!(store
        .source(&report.handle, "ev-session-head")
        .unwrap_err()
        .contains("differs"));
}

#[test]
fn context_files_and_safe_source_urls() {
    let fixture = Fixture::new();
    let (store, report) = fixture.store();
    let context = store.diff(&report.handle, "file-api").unwrap();
    assert_eq!(context.base.text, context.head.text);
    assert_eq!(context.additions, Some(0));
    let (url, path, line) = store.source(&report.handle, "ev-api-head").unwrap();
    assert!(url.starts_with("vscode://file/"));
    assert!(url.contains("%23"));
    assert!(url.contains("%20"));
    assert_eq!(line, 20);
    assert!(path.ends_with("src/api.ts"));
    assert!(store
        .source(&report.handle, "ev-start-base")
        .unwrap_err()
        .contains("differs"));
}

#[test]
fn source_does_not_follow_a_symlink_outside_checkout() {
    let fixture = Fixture::new();
    let (store, report) = fixture.store();
    let path = fixture.root.join("src/session.ts");
    let external = fixture.root.parent().unwrap().join("external.ts");
    fs::copy(&path, &external).unwrap();
    fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(&external, &path).unwrap();
    assert!(store
        .source(&report.handle, "ev-session-head")
        .unwrap_err()
        .contains("symlink"));
}

#[test]
fn validates_actual_inventory_and_evidence() {
    let fixture = Fixture::new();
    let mut report = fixture.report.clone();
    report["files"][0]["status"] = json!("added");
    assert!(git::verify(&fixture.root, &report)
        .unwrap_err()
        .contains("INVENTORY_MISMATCH"));
    let mut report = fixture.report.clone();
    report["evidence"][0]["endLine"] = json!(10000);
    assert!(git::verify(&fixture.root, &report)
        .unwrap_err()
        .contains("EVIDENCE_RANGE"));
    let mut report = fixture.report.clone();
    report["comparison"]["head"]["oid"] = json!("0".repeat(40));
    assert!(git::verify(&fixture.root, &report).is_err());
}

#[test]
fn state_survives_restart_conflicts_and_guidance_changes() {
    let fixture = Fixture::new();
    let (mut store, report) = fixture.store();
    let reviewed = store
        .decide(
            &report.handle,
            "file",
            "file-session",
            Some("reviewed"),
            report.state.revision,
            Some("Checked account propagation"),
        )
        .unwrap();
    assert!(store
        .decide(
            &report.handle,
            "file",
            "file-checkout",
            Some("reviewed"),
            report.state.revision,
            None
        )
        .unwrap_err()
        .contains("STATE_CONFLICT"));
    let checkpoint = store.checkpoint(&report.handle, reviewed.revision).unwrap();
    assert!(checkpoint.checkpoint.is_some());
    drop(store);
    let mut store = Store::new(fixture.state.clone()).unwrap();
    let reopened = store.open(&report.handle).unwrap();
    assert!(!reopened.state.files["file-session"].stale);
    assert_eq!(
        reopened.state.files["file-session"].note.as_deref(),
        Some("Checked account propagation")
    );
    let mut updated = fixture.report.clone();
    updated["files"][0]["analysis"]["tldr"] = json!("Clarify the account identity boundary.");
    let next = store.import_value(updated).unwrap();
    assert!(next.repository.is_some());
    assert!(next.state.files["file-session"].stale);
    assert!(next.state.checkpoint.is_some());
    assert!(store
        .decide(
            &report.handle,
            "file",
            "file-session",
            None,
            next.state.revision,
            None
        )
        .unwrap_err()
        .contains("STALE_GENERATION"));
}

#[test]
fn legacy_journey_fingerprint_is_preserved() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    let mut report: Value = serde_json::from_str(EXAMPLE).unwrap();
    report.as_object_mut().unwrap().remove("mainJourney");
    let loaded = store.import_value(report).unwrap();
    let state = store
        .decide(
            &loaded.handle,
            "flow",
            "flow-checkout",
            Some("reviewed"),
            loaded.state.revision,
            None,
        )
        .unwrap();
    // Historical unverified example fingerprint, before mainJourney existed.
    assert_eq!(
        state.flows["flow-checkout"].fingerprint,
        "af069a1ee900ed496a65d39140da8cfcc67902d85e9c8a1cdf24d5d1e0ba9a17"
    );
}

#[test]
fn main_journey_changes_invalidate_only_affected_guidance() {
    let designation = |flow: &str, why: &str| json!({"flowId":flow,"why":why});
    let original = designation("flow-checkout", "Connects account selection to checkout.");
    for (name, before, after, affected) in [
        ("added", None, Some(original.clone()), vec!["flow-checkout"]),
        (
            "rationale",
            Some(original.clone()),
            Some(designation(
                "flow-checkout",
                "Covers the central account-switching journey.",
            )),
            vec!["flow-checkout"],
        ),
        (
            "removed",
            Some(original.clone()),
            None,
            vec!["flow-checkout"],
        ),
        (
            "reassigned",
            Some(original.clone()),
            Some(designation(
                "flow-secondary",
                "This journey covers the principal changed behavior.",
            )),
            vec!["flow-checkout", "flow-secondary"],
        ),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::new(temp.path().join("state")).unwrap();
        let mut report: Value = serde_json::from_str(EXAMPLE).unwrap();
        report.as_object_mut().unwrap().remove("mainJourney");
        for id in ["flow-secondary", "flow-unrelated"] {
            let mut flow = report["flows"][0].clone();
            flow["id"] = id.into();
            report["flows"].as_array_mut().unwrap().push(flow);
        }
        if let Some(before) = before {
            report["mainJourney"] = before;
        }
        let first = store.import_value(report.clone()).unwrap();
        let mut state = first.state;
        for (kind, id, decision) in [
            ("file", "file-session", "reviewed"),
            ("flow", "flow-checkout", "reviewed"),
            ("flow", "flow-secondary", "reviewed"),
            ("flow", "flow-unrelated", "reviewed"),
            ("finding", "finding-account-race", "confirmed"),
        ] {
            state = store
                .decide(
                    &first.handle,
                    kind,
                    id,
                    Some(decision),
                    state.revision,
                    Some("Human review note"),
                )
                .unwrap();
        }
        let saved = store.checkpoint(&first.handle, state.revision).unwrap();
        report.as_object_mut().unwrap().remove("mainJourney");
        if let Some(after) = after {
            report["mainJourney"] = after;
        }
        let next = store.import_value(report).unwrap();
        for id in ["flow-checkout", "flow-secondary", "flow-unrelated"] {
            assert_eq!(
                next.state.flows[id].stale,
                affected.contains(&id),
                "{name}: {id}"
            );
            assert_eq!(
                next.state.flows[id].fingerprint,
                saved.flows[id].fingerprint
            );
            assert_eq!(
                next.state.flows[id].note.as_deref(),
                Some("Human review note")
            );
        }
        assert!(!next.state.files["file-session"].stale, "{name}");
        assert!(next.state.findings["finding-account-race"].stale, "{name}");
        assert_eq!(next.state.checkpoint.as_ref().unwrap().digest, first.digest);
        let changes = store.review_changes(&next.handle).unwrap();
        assert_eq!(
            changes
                .flows
                .changed
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            affected,
            "{name}"
        );
        assert_eq!(changes.flows.unchanged, 3 - affected.len(), "{name}");
        assert!(changes.files.changed.is_empty(), "{name}");
        assert_eq!(changes.findings.changed[0].id, "finding-account-race");
        assert_eq!(
            store.open(&next.handle).unwrap().state.revision,
            next.state.revision
        );
    }
}

#[test]
fn regenerated_head_keeps_unchanged_file_reviewed() {
    let fixture = Fixture::new();
    let (mut store, report) = fixture.store();
    let state = store
        .decide(
            &report.handle,
            "file",
            "file-session",
            Some("reviewed"),
            report.state.revision,
            None,
        )
        .unwrap();
    let state = store
        .decide(
            &report.handle,
            "file",
            "file-checkout",
            Some("reviewed"),
            state.revision,
            None,
        )
        .unwrap();
    store.checkpoint(&report.handle, state.revision).unwrap();
    let path = fixture.root.join("src/startCheckout.ts");
    let content = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        format!("{content}// Later change in another file.\n"),
    )
    .unwrap();
    command(&fixture.root, &["add", "."]);
    command(&fixture.root, &["commit", "-qm", "third"]);
    let mut updated = fixture.report.clone();
    updated["comparison"]["head"]["oid"] = json!(command(&fixture.root, &["rev-parse", "HEAD"]));
    let next = store.import_value(updated).unwrap();
    assert!(next.repository.is_some());
    assert!(!next.state.files["file-session"].stale);
    assert!(next.state.files["file-checkout"].stale);
    let changes = store.review_changes(&next.handle).unwrap();
    assert_eq!(changes.status, "compared");
    assert_eq!(changes.baseline.unwrap().handle, report.handle);
    assert_eq!(changes.files.unchanged, 1);
    assert_eq!(changes.files.changed[0].id, "file-checkout");
    assert_eq!(changes.flows.changed[0].id, "flow-checkout");
    assert_eq!(changes.findings.changed[0].id, "finding-account-race");
    assert_eq!(changes.unchanged_reviewed_file_count, 1);
}

#[test]
fn checkpoint_comparison_uses_saved_snapshot_without_activating_it() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    let original: Value = serde_json::from_str(EXAMPLE).unwrap();
    let first = store.import_value(original.clone()).unwrap();
    assert_eq!(
        store.review_changes(&first.handle).unwrap().status,
        "no-checkpoint"
    );
    let saved = store
        .checkpoint(&first.handle, first.state.revision)
        .unwrap();
    assert_eq!(
        store.review_changes(&first.handle).unwrap().status,
        "current"
    );

    let mut second = original.clone();
    second["files"][0]["analysis"]["tldr"] = json!("A revised explanation.");
    second["flows"][0]["tldr"] = json!("A revised journey.");
    let second = store.import_value(second).unwrap();
    let mut third = original;
    third["title"] = json!("Metadata updated only");
    let third = store.import_value(third).unwrap();

    // Even after a newer snapshot is active, compare the requested generation
    // to the checkpoint, not to the latest report or the preceding import.
    let changed = store.review_changes(&second.handle).unwrap();
    assert_eq!(changed.files.changed[0].id, "file-session");
    assert_eq!(changed.flows.changed[0].id, "flow-checkout");
    assert_eq!(changed.baseline.as_ref().unwrap().digest, first.digest);
    assert_eq!(
        changed.baseline.as_ref().unwrap().saved_at,
        saved.checkpoint.unwrap().saved_at
    );
    let third_changes = store.review_changes(&third.handle).unwrap();
    assert_eq!(third_changes.files.unchanged, 2);
    assert!(third_changes.files.changed.is_empty());
    assert_eq!(
        store.review_changes(&first.handle).unwrap().status,
        "current"
    );
    // Read-only comparison did not change the active handle or its revision.
    store
        .decide(
            &third.handle,
            "file",
            "file-session",
            Some("reviewed"),
            third.state.revision,
            None,
        )
        .unwrap();
}

#[test]
fn checkpoint_comparison_reports_added_and_removed_entities() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    let first = store
        .import_value(serde_json::from_str(EXAMPLE).unwrap())
        .unwrap();
    store
        .checkpoint(&first.handle, first.state.revision)
        .unwrap();
    let changed = EXAMPLE
        .replace("file-session", "file-session-new")
        .replace("flow-checkout", "flow-checkout-new")
        .replace("finding-account-race", "finding-account-race-new");
    let next = store
        .import_value(serde_json::from_str(&changed).unwrap())
        .unwrap();
    let changes = store.review_changes(&next.handle).unwrap();
    assert_eq!(changes.files.added[0].id, "file-session-new");
    assert_eq!(changes.files.removed[0].id, "file-session");
    assert_eq!(changes.flows.added[0].id, "flow-checkout-new");
    assert_eq!(changes.flows.removed[0].id, "flow-checkout");
    assert_eq!(changes.findings.added[0].id, "finding-account-race-new");
    assert_eq!(changes.findings.removed[0].id, "finding-account-race");
}

#[test]
fn checkpoint_comparison_isolates_projects_and_report_lineages() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    let original: Value = serde_json::from_str(EXAMPLE).unwrap();
    let first = store.import_value(original.clone()).unwrap();
    let checkpoint = store
        .checkpoint(&first.handle, first.state.revision)
        .unwrap()
        .checkpoint
        .unwrap();
    for (key, value) in [
        ("repository", "local:another-project"),
        ("reportId", "another-report"),
    ] {
        let mut other = original.clone();
        if key == "repository" {
            other["repository"]["id"] = json!(value);
        } else {
            other[key] = json!(value);
        }
        let other = store.import_value(other).unwrap();
        assert_eq!(
            store.review_changes(&other.handle).unwrap().status,
            "no-checkpoint"
        );
        // A mismatched checkpoint digest must not cross the lineage boundary.
        store
            .db
            .execute(
                "UPDATE reviews SET checkpoint=?3 WHERE repo_id=?1 AND report_id=?2",
                rusqlite::params![
                    text(&other.report["repository"], "id"),
                    text(&other.report, "reportId"),
                    serde_json::to_string(&checkpoint).unwrap()
                ],
            )
            .unwrap();
        assert_eq!(
            store.review_changes(&other.handle).unwrap().status,
            "unavailable"
        );
    }
}

#[test]
fn unverified_new_commits_never_preserve_review_marks_as_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().join("state")).unwrap();
    let mut report: Value = serde_json::from_str(EXAMPLE).unwrap();
    let first = store.import_value(report.clone()).unwrap();
    let reviewed = store
        .decide(
            &first.handle,
            "file",
            "file-session",
            Some("reviewed"),
            first.state.revision,
            None,
        )
        .unwrap();
    store.checkpoint(&first.handle, reviewed.revision).unwrap();
    report["comparison"]["head"]["oid"] = json!("c".repeat(40));
    let next = store.import_value(report).unwrap();
    assert!(next.state.files["file-session"].stale);
    let changes = store.review_changes(&next.handle).unwrap();
    assert_eq!(changes.files.changed.len(), 2);
    assert_eq!(changes.unchanged_reviewed_file_count, 0);
}

#[test]
fn duplicate_import_is_idempotent_and_orphan_file_recovers() {
    let temp = tempfile::tempdir().unwrap();
    let mut store = Store::new(temp.path().to_path_buf()).unwrap();
    let report: Value = serde_json::from_str(EXAMPLE).unwrap();
    let hash = crate::store::digest(&report);
    fs::write(
        temp.path()
            .join("reports")
            .join(format!("{hash}.trace.json")),
        [],
    )
    .unwrap();
    let first = store.import_value(report.clone()).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(
            &fs::read(
                temp.path()
                    .join("reports")
                    .join(format!("{hash}.trace.json"))
            )
            .unwrap()
        )
        .unwrap(),
        report
    );
    let second = store.import_value(report).unwrap();
    assert_eq!(first.handle, second.handle);
    assert_eq!(store.list().unwrap().len(), 1);
    let demo = store.diff(&first.handle, "file-api").unwrap();
    assert!(demo.head.reason.unwrap().contains("Synthetic"));
}

#[test]
fn metadata_sides_cover_add_delete_rename_binary_large_and_symlink() {
    let fixture = Fixture::new();
    let old = command(&fixture.root, &["rev-parse", "HEAD"]);
    fs::rename(
        fixture.root.join("src/session.ts"),
        fixture.root.join("src/renamed #%.ts"),
    )
    .unwrap();
    fs::remove_file(fixture.root.join("src/startCheckout.ts")).unwrap();
    fs::write(
        fixture.root.join("added.ts"),
        "export const added = true;\n",
    )
    .unwrap();
    fs::write(fixture.root.join("binary.bin"), [0, 1, 2, 3]).unwrap();
    fs::write(
        fixture.root.join("large.txt"),
        vec![b'x'; git::MAX_TEXT + 1],
    )
    .unwrap();
    std::os::unix::fs::symlink("added.ts", fixture.root.join("link.ts")).unwrap();
    command(&fixture.root, &["add", "-A"]);
    command(&fixture.root, &["commit", "-qm", "metadata"]);
    let head = command(&fixture.root, &["rev-parse", "HEAD"]);
    let report = json!({"comparison":{"base":{"oid":old},"head":{"oid":head}},"files":[
        {"id":"add","path":"added.ts","status":"added"},
        {"id":"del","path":"src/startCheckout.ts","status":"deleted"},
        {"id":"rename","path":"src/renamed #%.ts","previousPath":"src/session.ts","status":"renamed"},
        {"id":"bin","path":"binary.bin","status":"added"},
        {"id":"large","path":"large.txt","status":"added"},
        {"id":"link","path":"link.ts","status":"added"}
    ]});
    assert_eq!(
        git::read_diff(&fixture.root, &report, "add")
            .unwrap()
            .base
            .kind,
        "absent"
    );
    assert_eq!(
        git::read_diff(&fixture.root, &report, "del")
            .unwrap()
            .head
            .kind,
        "absent"
    );
    let rename = git::read_diff(&fixture.root, &report, "rename").unwrap();
    assert_eq!(rename.base.text, rename.head.text);
    assert_ne!(rename.base.path, rename.head.path);
    assert_eq!(
        git::read_diff(&fixture.root, &report, "bin")
            .unwrap()
            .head
            .kind,
        "binary"
    );
    assert_eq!(
        git::read_diff(&fixture.root, &report, "large")
            .unwrap()
            .head
            .kind,
        "large"
    );
    assert_eq!(
        git::read_diff(&fixture.root, &report, "link")
            .unwrap()
            .head
            .kind,
        "symlink"
    );
}

#[test]
fn source_uri_encodes_literal_percent_and_reserved_characters_once() {
    let uri = git::source_uri(Path::new("/tmp/a%20b #?:ไทย.ts"), 12).unwrap();
    assert_eq!(
        uri,
        "vscode://file/tmp/a%2520b%20%23%3F%3A%E0%B9%84%E0%B8%97%E0%B8%A2.ts:12"
    );
    assert_ne!(
        git::source_uri(Path::new("/tmp/a%20b.ts"), 1).unwrap(),
        git::source_uri(Path::new("/tmp/a b.ts"), 1).unwrap()
    );
    assert_eq!(
        git::source_uri(Path::new("/tmp/a%2Fb.ts"), 1).unwrap(),
        "vscode://file/tmp/a%252Fb.ts:1"
    );
}

#[test]
fn missing_promisor_blob_never_launches_configured_network_helper() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let parent = fixture.root.parent().unwrap();
    let bare = parent.join("remote.git");
    let clone = parent.join("partial");
    command(
        parent,
        &[
            "clone",
            "--bare",
            "-q",
            fixture.root.to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    );
    command(&bare, &["config", "uploadpack.allowFilter", "true"]);
    let remote = url::Url::from_directory_path(&bare).unwrap().to_string();
    command(
        parent,
        &[
            "-c",
            "protocol.file.allow=always",
            "clone",
            "-q",
            "--filter=blob:none",
            "--no-checkout",
            &remote,
            clone.to_str().unwrap(),
        ],
    );
    let helper = parent.join("ssh-helper");
    let marker = parent.join("ssh-helper.called");
    fs::write(
        &helper,
        "#!/bin/sh\nprintf called > \"${0}.called\"\nexit 1\n",
    )
    .unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    command(
        &clone,
        &[
            "config",
            "remote.origin.url",
            "ssh://example.invalid/repository",
        ],
    );
    command(
        &clone,
        &["config", "core.sshCommand", helper.to_str().unwrap()],
    );
    let oid = command(&fixture.root, &["rev-parse", "HEAD:src/session.ts"]);
    assert!(git::git(&clone, &["cat-file", "-s", &oid]).is_err());
    assert!(
        !marker.exists(),
        "Reading a missing snapshot launched a repository-controlled SSH helper"
    );
}

#[test]
fn projects_group_report_snapshots_and_restore_old_library() {
    let fixture = Fixture::new();
    let (mut store, report) = fixture.store();
    let mut second = fixture.report.clone();
    second["reportId"] = json!("local:another-pr");
    second["title"] = json!("Another PR in the same project");
    second["pullRequest"] = json!({"number":42,"url":"https://github.com/example/repo/pull/42"});
    let second = store.import_value(second).unwrap();
    let project = &store.projects().unwrap()[0];
    assert_eq!(project.id, "local:trace-integration-test");
    assert_eq!(project.report_count, 2);
    assert_eq!(project.repositories.len(), 1);
    assert_eq!(store.list().unwrap()[0].pr_number, Some(42));
    assert_ne!(report.handle, second.handle);
    drop(store);
    // Recreate the shape of the existing v1 user database to exercise migration.
    let db = rusqlite::Connection::open(fixture.state.join("trace.sqlite3")).unwrap();
    db.execute_batch("DROP TABLE projects; DROP TABLE discovery_sources; PRAGMA user_version=1;")
        .unwrap();
    drop(db);
    let store = Store::new(fixture.state.clone()).unwrap();
    assert_eq!(store.projects().unwrap().len(), 1);
    assert_eq!(store.projects().unwrap()[0].report_count, 2);
    assert_eq!(store.projects().unwrap()[0].repositories.len(), 1);
}

#[test]
fn detection_preserves_active_review_deduplicates_and_discovers_new_versions() {
    let fixture = Fixture::new();
    let (mut store, original) = fixture.store();
    let state = store
        .decide(
            &original.handle,
            "file",
            "file-session",
            Some("reviewed"),
            original.state.revision,
            None,
        )
        .unwrap();
    let folder = fixture.root.join(".trace");
    fs::create_dir(&folder).unwrap();
    let mut next = fixture.report.clone();
    next["title"] = json!("Updated review narrative");
    fs::write(folder.join("review.trace.json"), next.to_string()).unwrap();
    let detected = store.discover().unwrap();
    assert_eq!(detected.imported, 1);
    assert!(detected.issues.is_empty(), "{:?}", detected.issues);
    assert_eq!(store.list().unwrap().len(), 2);
    // Merely discovering a generation must not invalidate a review in progress.
    let current = store.open(&original.handle).unwrap();
    assert_eq!(current.state.revision, state.revision);
    assert!(!current.state.files["file-session"].stale);
    let updated = store
        .list()
        .unwrap()
        .into_iter()
        .find(|r| r.handle != original.handle)
        .unwrap();
    assert_eq!(
        updated.report_id,
        original.report["reportId"].as_str().unwrap()
    );
    assert_eq!(
        updated.project_id,
        original.report["repository"]["id"].as_str().unwrap()
    );
    let duplicate = store.discover().unwrap();
    assert_eq!(duplicate.imported, 0);
    assert_eq!(duplicate.skipped, 1);
    assert_eq!(
        store.open(&original.handle).unwrap().state.revision,
        state.revision
    );
    drop(store);
    let mut store = Store::new(fixture.state.clone()).unwrap();
    assert_eq!(store.discover().unwrap().skipped, 1);
    // Changing only JSON formatting is also deduplicated by semantic digest.
    fs::write(
        folder.join("review.trace.json"),
        serde_json::to_string_pretty(&next).unwrap(),
    )
    .unwrap();
    assert_eq!(store.discover().unwrap().skipped, 1);
    assert_eq!(store.list().unwrap().len(), 2);
    let loaded = store.open(&updated.handle).unwrap();
    assert!(loaded.repository.is_some());
    assert!(!loaded.state.files["file-session"].stale);
}

#[test]
fn project_registration_can_discover_first_local_report_without_prior_import() {
    let fixture = Fixture::new();
    let mut store = Store::new(fixture.state.clone()).unwrap();
    let project = store.add_project(&fixture.root).unwrap();
    assert_eq!(project.report_count, 0);
    fs::create_dir(fixture.root.join(".trace")).unwrap();
    fs::write(
        fixture.root.join(".trace/first.trace.json"),
        fixture.report.to_string(),
    )
    .unwrap();
    assert_eq!(store.discover().unwrap().imported, 1);
    let projects = store.projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, "local:trace-integration-test");
    assert_eq!(projects[0].report_count, 1);
    assert_eq!(projects[0].repositories.len(), 1);
    let loaded = store.open(&store.list().unwrap()[0].handle).unwrap();
    assert!(loaded.repository.is_some());
    assert!(store.diff(&loaded.handle, "file-session").is_ok());
}

#[test]
fn detection_rejects_symlinks_special_files_invalid_json_and_other_projects() {
    let fixture = Fixture::new();
    let (mut store, _) = fixture.store();
    let external = fixture.root.parent().unwrap().join("external-reports");
    fs::create_dir(&external).unwrap();
    fs::write(
        external.join("outside.trace.json"),
        fixture.report.to_string(),
    )
    .unwrap();
    let folder = fixture.root.join(".trace");
    std::os::unix::fs::symlink(&external, &folder).unwrap();
    let rejected = store.discover().unwrap();
    assert_eq!(rejected.imported, 0);
    assert!(rejected.issues[0].message.contains("symbolic link"));
    fs::remove_file(&folder).unwrap();
    fs::create_dir(&folder).unwrap();
    std::os::unix::fs::symlink(
        external.join("outside.trace.json"),
        folder.join("linked.trace.json"),
    )
    .unwrap();
    fs::create_dir(folder.join("directory.trace.json")).unwrap();
    fs::write(folder.join("invalid.trace.json"), "{}").unwrap();
    let mut wrong = fixture.report.clone();
    wrong["repository"]["id"] = json!("github.com/another/repository");
    fs::write(folder.join("other.trace.json"), wrong.to_string()).unwrap();
    let fifo = folder.join("fifo.trace.json");
    assert!(Command::new("/usr/bin/mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    fs::create_dir(folder.join("nested")).unwrap();
    fs::write(
        folder.join("nested/hidden.trace.json"),
        fixture.report.to_string(),
    )
    .unwrap();
    fs::write(folder.join("ignored.json"), fixture.report.to_string()).unwrap();
    let rejected = store.discover().unwrap();
    assert_eq!(rejected.imported, 0);
    assert_eq!(rejected.scanned, 5);
    assert_eq!(rejected.issues.len(), 5);
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn detection_caps_batch_and_file_size() {
    let fixture = Fixture::new();
    let (mut store, _) = fixture.store();
    let folder = fixture.root.join(".trace");
    fs::create_dir(&folder).unwrap();
    let large = folder.join("large.trace.json");
    fs::File::create(&large)
        .unwrap()
        .set_len((crate::store::MAX_REPORT_BYTES + 1) as u64)
        .unwrap();
    assert!(store.discover().unwrap().issues[0]
        .message
        .contains("LIMIT_EXCEEDED"));
    fs::remove_file(large).unwrap();
    for i in 0..260 {
        fs::write(
            folder.join(format!("{i}.trace.json")),
            fixture.report.to_string(),
        )
        .unwrap();
    }
    let result = store.discover().unwrap();
    assert_eq!(result.scanned, 256);
    assert_eq!(result.skipped, 256);
    assert_eq!(result.imported, 0);
    assert!(result.issues[0].message.contains("DISCOVERY_LIMIT"));
}

#[test]
fn file_links_use_verified_local_content_and_immutable_safe_github_paths() {
    let fixture = Fixture::new();
    let (store, report) = fixture.store();
    let (url, _, line) = store
        .file_source(&report.handle, "file-session", "vscode", None)
        .unwrap();
    assert!(url.starts_with("vscode://file/"));
    assert_eq!(line, 1);
    assert!(store
        .file_source(&report.handle, "not-in-report", "vscode", None)
        .is_err());
    assert!(store
        .file_source(&report.handle, "file-session", "shell", None)
        .is_err());
    fs::write(fixture.root.join("src/session.ts"), "changed locally").unwrap();
    assert!(store
        .file_source(&report.handle, "file-session", "vscode", None)
        .unwrap_err()
        .contains("differs"));
    let mut report = fixture.report.clone();
    report["repository"] = json!({"id":"github.com/example/repo","name":"repo","webUrl":"https://github.com/example/repo"});
    report["files"][0]["path"] = json!("src/a%20b #.ts");
    let (url, _, _) = git::github_file_url(&report, "file-session", None).unwrap();
    assert!(url.contains("/blob/"));
    assert!(url.contains(report["comparison"]["head"]["oid"].as_str().unwrap()));
    assert!(url.ends_with("/src/a%2520b%20%23.ts#L1"), "{url}");
    report["files"][0]["status"] = json!("deleted");
    let (url, _, _) = git::github_file_url(&report, "file-session", None).unwrap();
    assert!(url.contains(report["comparison"]["base"]["oid"].as_str().unwrap()));
    assert!(git::github_file_url(&report, "file-session", Some("head")).is_err());
    report["repository"]["webUrl"] = json!("https://evil.example/example/repo");
    assert!(git::github_file_url(&report, "file-session", None).is_err());
}
