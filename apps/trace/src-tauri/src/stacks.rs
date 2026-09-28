//! Stack membership comes from live PR base/head branch links, never branch
//! naming conventions, commit overlap, or reports that happen to share a base.
use crate::{
    git,
    requests::{latest_pr_report, pr_url},
    store::Store,
    types::*,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::Path,
    process::Command,
    time::Duration,
};

const MAX_OPEN_PRS: usize = 200;
const MAX_STACK_PRS: usize = 20;
const FIELDS: &str = "number,url,title,baseRefName,headRefName,isCrossRepository,state";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StackPullRequest {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStack {
    pub seed_number: u64,
    pub pull_requests: Vec<StackPullRequest>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Metadata {
    pr: StackPullRequest,
    fork: bool,
}

fn github(root: &Path, repository: &str, args: &[&str]) -> Result<Value, String> {
    let executable = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .ok_or("GITHUB_CLI_UNAVAILABLE: install and sign in to GitHub CLI to discover PR stacks")?;
    let mut command = Command::new(executable);
    command
        .current_dir(root)
        .args(args)
        .args(["--repo", repository, "--json", FIELDS])
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat");
    let bytes = git::bounded_command(command, "GITHUB", Duration::from_secs(20))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("INVALID_GITHUB_RESPONSE: {e}"))
}
fn metadata(value: &Value, repository: &str) -> Result<Metadata, String> {
    let (number, url) = pr_url(text(value, "url"), repository)?;
    if value["number"].as_u64() != Some(number) || text(value, "state") != "OPEN" {
        return Err(
            "STACK_UNAVAILABLE: stack discovery requires matching open pull requests".into(),
        );
    }
    let base = text(value, "baseRefName");
    let head = text(value, "headRefName");
    if [base, head]
        .iter()
        .any(|name| name.is_empty() || name.len() > 1024 || name.chars().any(char::is_control))
    {
        return Err("STACK_UNAVAILABLE: GitHub did not provide usable branch identities".into());
    }
    Ok(Metadata {
        pr: StackPullRequest {
            number,
            url,
            title: text(value, "title").into(),
            base_ref_name: base.into(),
            head_ref_name: head.into(),
        },
        fork: value["isCrossRepository"]
            .as_bool()
            .ok_or("STACK_UNAVAILABLE: GitHub did not identify the head repository")?,
    })
}

fn discover_graph(
    repository: &str,
    seed: &Value,
    open: &[Value],
    truncated: bool,
) -> Result<ReviewStack, String> {
    let seed = metadata(seed, repository)?;
    if seed.fork {
        return Err("FORK_STACK_UNSUPPORTED: a fork's branch names do not identify branches in this repository; review this PR individually".into());
    }
    let seed_number = seed.pr.number;
    let mut all = BTreeMap::new();
    all.insert(seed_number, seed);
    for value in open {
        let candidate = metadata(value, repository)?;
        if let Some(previous) = all.insert(candidate.pr.number, candidate.clone()) {
            if previous != candidate {
                return Err(
                    "STACK_CHANGED: pull request metadata changed during discovery; retry".into(),
                );
            }
        }
    }
    let mut parents: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    let mut children: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for child in all.values().filter(|item| !item.fork) {
        for parent in all.values().filter(|item| !item.fork) {
            if child.pr.base_ref_name == parent.pr.head_ref_name {
                parents
                    .entry(child.pr.number)
                    .or_default()
                    .push(parent.pr.number);
                children
                    .entry(parent.pr.number)
                    .or_default()
                    .push(child.pr.number);
            }
        }
    }
    let mut component = BTreeSet::new();
    let mut queue = VecDeque::from([seed_number]);
    while let Some(number) = queue.pop_front() {
        if !component.insert(number) {
            continue;
        }
        queue.extend(parents.get(&number).into_iter().flatten());
        queue.extend(children.get(&number).into_iter().flatten());
    }
    if component.len() > MAX_STACK_PRS {
        return Err("STACK_LIMIT: this connected stack has more than 20 PRs; narrow it before preparing reviews".into());
    }
    if component
        .iter()
        .any(|id| parents.get(id).is_some_and(|parents| parents.len() > 1))
    {
        return Err("AMBIGUOUS_STACK: more than one open PR owns a parent branch; resolve that ambiguity before reviewing this stack".into());
    }
    let mut indegree: BTreeMap<_, _> = component
        .iter()
        .map(|id| (*id, parents.get(id).map(Vec::len).unwrap_or(0)))
        .collect();
    let mut ready: BTreeSet<_> = indegree
        .iter()
        .filter_map(|(id, degree)| (*degree == 0).then_some(*id))
        .collect();
    let mut ordered = Vec::new();
    while let Some(number) = ready.pop_first() {
        ordered.push(all[&number].pr.clone());
        for child in children.get(&number).into_iter().flatten() {
            let remaining = indegree.get_mut(child).unwrap();
            *remaining -= 1;
            if *remaining == 0 {
                ready.insert(*child);
            }
        }
    }
    if ordered.len() != component.len() {
        return Err("CYCLIC_STACK: PR branch links form a cycle; correct the PR bases before reviewing this stack".into());
    }
    let mut warnings = Vec::new();
    if truncated {
        warnings.push("Only the first 200 open PRs were inspected. This stack may be incomplete; narrow the repository's open PR inventory before relying on completeness.".into());
    }
    if component
        .iter()
        .any(|id| children.get(id).is_some_and(|items| items.len() > 1))
    {
        warnings.push("This stack branches into multiple child PRs. All connected same-repository PRs are included.".into());
    }
    if all.values().any(|item| {
        item.fork
            && component
                .iter()
                .any(|id| all[id].pr.head_ref_name == item.pr.base_ref_name)
    }) {
        warnings.push("Fork PRs based on this stack were excluded because cross-repository stack discovery is unsupported.".into());
    }
    Ok(ReviewStack {
        seed_number,
        pull_requests: ordered,
        warnings,
    })
}

fn prior_for_pr(
    previous: Option<(&str, &Value)>,
    repository: &str,
    number: u64,
    url: &str,
    reports: &[ReportSummary],
) -> Option<String> {
    previous
        .filter(|(_, report)| {
            text(&report["repository"], "id") == repository
                && report["pullRequest"]["number"].as_u64() == Some(number)
                && text(&report["pullRequest"], "url") == url
        })
        .map(|(handle, _)| handle.to_string())
        .or_else(|| latest_pr_report(reports, repository, number, url))
}

impl Store {
    pub fn discover_review_stack(
        &self,
        checkout_id: &str,
        url: &str,
    ) -> Result<ReviewStack, String> {
        let checkout = self.request_checkout(checkout_id)?;
        let (number, _) = pr_url(url, &checkout.repository_id)?;
        let root = Path::new(&checkout.display_path);
        let seed = github(
            root,
            &checkout.repository_id,
            &["pr", "view", &number.to_string()],
        )?;
        if seed["number"].as_u64() != Some(number) {
            return Err("PR_MISMATCH: GitHub returned a different seed pull request".into());
        }
        let open = github(
            root,
            &checkout.repository_id,
            &[
                "pr",
                "list",
                "--state",
                "open",
                "--limit",
                &(MAX_OPEN_PRS + 1).to_string(),
            ],
        )?;
        let open = open
            .as_array()
            .ok_or("INVALID_GITHUB_RESPONSE: expected a PR list")?;
        discover_graph(
            &checkout.repository_id,
            &seed,
            &open[..open.len().min(MAX_OPEN_PRS)],
            open.len() > MAX_OPEN_PRS,
        )
    }
    pub fn resolve_review_stack(
        &self,
        checkout_id: &str,
        urls: Vec<String>,
        previous_report_handle: Option<String>,
    ) -> Result<Vec<ReviewComparison>, String> {
        if urls.is_empty() || urls.len() > MAX_STACK_PRS {
            return Err("STACK_LIMIT: select between 1 and 20 pull requests".into());
        }
        let checkout = self.request_checkout(checkout_id)?;
        let previous = previous_report_handle
            .as_deref()
            .map(|id| self.record(id))
            .transpose()?;
        if previous
            .as_ref()
            .is_some_and(|r| text(&r.report["repository"], "id") != checkout.repository_id)
        {
            return Err("REPOSITORY_MISMATCH: previous report belongs to another project".into());
        }
        let mut selected = Vec::new();
        let mut seen = BTreeSet::new();
        for url in urls {
            let (number, url) = pr_url(&url, &checkout.repository_id)?;
            if !seen.insert(number) {
                return Err("DUPLICATE_PR: select each pull request only once".into());
            }
            selected.push((number, url));
        }
        let reports = self.list()?;
        // Resolve every live exact comparison before returning any preparation
        // tokens to the UI. Resolution never starts an agent or prepares output.
        selected
            .into_iter()
            .map(|(number, url)| {
                self.resolve_review(ResolveReviewInput {
                    checkout_id: checkout_id.into(),
                    kind: "pull-request".into(),
                    base_ref: None,
                    head_ref: None,
                    previous_report_handle: prior_for_pr(
                        previous.as_ref().map(|r| (r.handle.as_str(), &r.report)),
                        &checkout.repository_id,
                        number,
                        &url,
                        &reports,
                    ),
                    pr_url: Some(url),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::requests::same_review_target;
    use serde_json::json;
    const REPO: &str = "github.com/example/project";
    fn pr(number: u64, base: &str, head: &str) -> Value {
        json!({"number":number,"url":format!("https://{REPO}/pull/{number}"),"title":format!("PR {number}"),"baseRefName":base,"headRefName":head,"isCrossRepository":false,"state":"OPEN"})
    }
    fn numbers(stack: ReviewStack) -> Vec<u64> {
        stack
            .pull_requests
            .into_iter()
            .map(|pr| pr.number)
            .collect()
    }
    #[test]
    fn selecting_middle_or_top_finds_ancestors_descendants_in_base_order() {
        let rows = vec![
            pr(30, "b", "c"),
            pr(20, "a", "b"),
            pr(10, "main", "a"),
            pr(40, "main", "unrelated"),
        ];
        for seed in [&rows[0], &rows[1], &rows[2]] {
            assert_eq!(
                numbers(discover_graph(REPO, seed, &rows, false).unwrap()),
                vec![10, 20, 30]
            );
        }
    }
    #[test]
    fn common_base_alone_is_not_a_stack_but_branching_descendants_are() {
        let seed = pr(10, "main", "a");
        assert_eq!(
            numbers(
                discover_graph(
                    REPO,
                    &seed,
                    &[seed.clone(), pr(11, "main", "unrelated")],
                    false
                )
                .unwrap()
            ),
            vec![10]
        );
        let result = discover_graph(
            REPO,
            &seed,
            &[seed.clone(), pr(11, "a", "b"), pr(12, "a", "c")],
            false,
        )
        .unwrap();
        assert_eq!(result.pull_requests.len(), 3);
        assert!(result.warnings[0].contains("branches"));
    }
    #[test]
    fn fork_heads_do_not_impersonate_repository_branches() {
        let seed = pr(10, "main", "a");
        let mut fork = pr(11, "a", "b");
        fork["isCrossRepository"] = json!(true);
        let result = discover_graph(
            REPO,
            &seed,
            &[seed.clone(), fork.clone(), pr(12, "b", "c")],
            false,
        )
        .unwrap();
        assert_eq!(result.pull_requests.len(), 1);
        assert!(result.warnings[0].contains("Fork"));
        assert!(discover_graph(REPO, &fork, &[], false)
            .unwrap_err()
            .contains("FORK_STACK"));
    }
    #[test]
    fn ambiguous_parent_and_connected_cycles_are_rejected() {
        let seed = pr(20, "a", "b");
        assert!(discover_graph(
            REPO,
            &seed,
            &[pr(10, "main", "a"), pr(11, "other", "a")],
            false
        )
        .unwrap_err()
        .contains("AMBIGUOUS_STACK"));
        assert!(discover_graph(REPO, &seed, &[pr(10, "b", "a")], false)
            .unwrap_err()
            .contains("CYCLIC_STACK"));
        assert_eq!(
            numbers(
                discover_graph(
                    REPO,
                    &pr(1, "main", "clean"),
                    &[seed, pr(10, "b", "a")],
                    false
                )
                .unwrap()
            ),
            vec![1]
        );
    }
    #[test]
    fn truncation_is_explicit_and_cross_project_metadata_is_rejected() {
        let seed = pr(1, "main", "a");
        assert!(discover_graph(REPO, &seed, &[], true).unwrap().warnings[0].contains("incomplete"));
        let mut other = pr(2, "a", "b");
        other["url"] = json!("https://github.com/another/project/pull/2");
        assert!(discover_graph(REPO, &seed, &[other], false)
            .unwrap_err()
            .contains("REPOSITORY_MISMATCH"));
        let mut updated = seed.clone();
        updated["headRefName"] = json!("different");
        assert!(discover_graph(REPO, &seed, &[updated], false)
            .unwrap_err()
            .contains("STACK_CHANGED"));
    }
    #[test]
    fn discovery_rejects_closed_seeds_and_oversized_connected_stacks() {
        let mut closed = pr(1, "main", "a");
        closed["state"] = json!("MERGED");
        assert!(discover_graph(REPO, &closed, &[], false)
            .unwrap_err()
            .contains("open pull requests"));
        let rows: Vec<_> = (1..=21)
            .map(|number| {
                pr(
                    number,
                    &format!("branch-{}", number - 1),
                    &format!("branch-{number}"),
                )
            })
            .collect();
        assert!(discover_graph(REPO, &rows[10], &rows, false)
            .unwrap_err()
            .contains("STACK_LIMIT"));
    }
    #[test]
    fn previous_report_only_attaches_to_matching_pr_and_project() {
        let report = json!({"repository":{"id":REPO},"pullRequest":{"number":20,"url":format!("https://{REPO}/pull/20")}});
        assert_eq!(
            prior_for_pr(
                Some(("saved", &report)),
                REPO,
                20,
                &format!("https://{REPO}/pull/20"),
                &[]
            ),
            Some("saved".into())
        );
        assert!(prior_for_pr(
            Some(("saved", &report)),
            REPO,
            21,
            &format!("https://{REPO}/pull/21"),
            &[]
        )
        .is_none());
        assert!(prior_for_pr(
            Some(("saved", &report)),
            "github.com/other/project",
            20,
            &format!("https://{REPO}/pull/20"),
            &[]
        )
        .is_none());
    }
    #[test]
    fn unfinished_target_guard_allows_other_prs_but_not_duplicate_targets() {
        let base = ReviewComparison {
            token: "t".into(),
            checkout_id: "checkout".into(),
            repository_id: REPO.into(),
            repository_name: "project".into(),
            base: ReviewRevision {
                oid: "a".repeat(40),
                label: "main".into(),
            },
            head: ReviewRevision {
                oid: "b".repeat(40),
                label: "feature".into(),
            },
            changed_file_count: 1,
            pr: None,
            report_id: "review".into(),
            prior_report_handle: None,
        };
        let mut other = base.clone();
        assert!(same_review_target(&base, &other));
        other.head.oid = "c".repeat(40);
        assert!(!same_review_target(&base, &other));
        let mut first = base;
        first.pr = Some(ReviewPullRequest {
            number: 1,
            url: format!("https://{REPO}/pull/1"),
            title: "First".into(),
        });
        other = first.clone();
        other.head.oid = "d".repeat(40);
        assert!(same_review_target(&first, &other));
        other.pr = Some(ReviewPullRequest {
            number: 2,
            url: format!("https://{REPO}/pull/2"),
            title: "Second".into(),
        });
        assert!(!same_review_target(&first, &other));
        other = first.clone();
        other.repository_id = "github.com/other/project".into();
        assert!(!same_review_target(&first, &other));
    }
    #[test]
    fn sibling_prs_restore_their_own_latest_lineage_and_explicit_seed_wins() {
        let summary = |handle: &str, number: u64, repository: &str, url: String| ReportSummary {
            handle: handle.into(),
            project_id: repository.into(),
            report_id: format!("lineage-{number}"),
            pr_number: Some(number),
            pr_url: Some(url),
            title: String::new(),
            repository_name: String::new(),
            generated_at: String::new(),
            head: String::new(),
        };
        let first_url = format!("https://{REPO}/pull/20");
        let second_url = format!("https://{REPO}/pull/21");
        let reports = vec![
            summary(
                "wrong-project",
                20,
                "github.com/another/project",
                first_url.clone(),
            ),
            summary(
                "wrong-url",
                20,
                REPO,
                "https://github.com/another/project/pull/20".into(),
            ),
            summary("latest-sibling", 21, REPO, second_url.clone()),
            summary("latest-seed", 20, REPO, first_url.clone()),
            summary("older-sibling", 21, REPO, second_url.clone()),
        ];
        let seed = json!({"repository":{"id":REPO},"pullRequest":{"number":20,"url":first_url}});
        assert_eq!(
            prior_for_pr(None, REPO, 20, &first_url, &reports),
            Some("latest-seed".into())
        );
        assert_eq!(
            prior_for_pr(
                Some(("explicit-seed", &seed)),
                REPO,
                20,
                &first_url,
                &reports
            ),
            Some("explicit-seed".into())
        );
        assert_eq!(
            prior_for_pr(
                Some(("explicit-seed", &seed)),
                REPO,
                21,
                &second_url,
                &reports
            ),
            Some("latest-sibling".into())
        );
        assert_eq!(
            prior_for_pr(None, REPO, 22, &format!("https://{REPO}/pull/22"), &reports),
            None
        );
    }
    #[test]
    fn prepared_prs_reuse_exact_handoffs_and_reject_conflicting_duplicates() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        for args in [
            vec!["init", "-q"],
            vec![
                "-c",
                "user.name=Trace test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-qm",
                "initial",
            ],
            vec![
                "remote",
                "add",
                "origin",
                "https://github.com/example/project.git",
            ],
        ] {
            let output = Command::new("/usr/bin/git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let head = String::from_utf8(git::git(&root, &["rev-parse", "HEAD"]).unwrap())
            .unwrap()
            .trim()
            .to_string();
        let mut store = Store::new(temp.path().join("state")).unwrap();
        let checkout = store.choose(&root).unwrap();
        let comparison = ReviewComparison {
            token: "pr-one".into(),
            checkout_id: checkout.checkout_id,
            repository_id: REPO.into(),
            repository_name: "project".into(),
            base: ReviewRevision {
                oid: head.clone(),
                label: "main".into(),
            },
            head: ReviewRevision {
                oid: head,
                label: "feature".into(),
            },
            changed_file_count: 0,
            pr: Some(ReviewPullRequest {
                number: 1,
                url: format!("https://{REPO}/pull/1"),
                title: "First".into(),
            }),
            report_id: "first".into(),
            prior_report_handle: None,
        };
        let mut second = comparison.clone();
        second.token = "pr-two".into();
        second.report_id = "second".into();
        second.pr = Some(ReviewPullRequest {
            number: 2,
            url: format!("https://{REPO}/pull/2"),
            title: "Second".into(),
        });
        // These are the trusted native comparison records normally produced by
        // live GitHub resolution; the pending-request guard needs no network.
        for value in [&comparison, &second] {
            store
                .db
                .execute(
                    "INSERT INTO review_comparisons(token,body) VALUES(?1,?2)",
                    rusqlite::params![value.token, serde_json::to_string(value).unwrap()],
                )
                .unwrap();
        }
        let first = store
            .prepare_review(PrepareReviewInput {
                comparison_token: comparison.token.clone(),
                focus: String::new(),
            })
            .unwrap();
        let second = store
            .prepare_review(PrepareReviewInput {
                comparison_token: second.token,
                focus: String::new(),
            })
            .unwrap();
        assert_ne!(first.output_path, second.output_path);
        assert_eq!(store.review_requests().unwrap().len(), 2);
        let mut resolved_again = comparison.clone();
        resolved_again.token = "new-resolution-token".into();
        resolved_again.report_id = "would-be-new-report".into();
        store
            .db
            .execute(
                "INSERT INTO review_comparisons(token,body) VALUES(?1,?2)",
                rusqlite::params![
                    resolved_again.token,
                    serde_json::to_string(&resolved_again).unwrap()
                ],
            )
            .unwrap();
        let reused = store
            .prepare_review(PrepareReviewInput {
                comparison_token: resolved_again.token.clone(),
                focus: "  \n".into(),
            })
            .unwrap();
        assert_eq!(reused.id, first.id);
        assert_eq!(reused.prompt, first.prompt);
        assert_eq!(reused.output_path, first.output_path);
        assert_eq!(reused.comparison.report_id, first.comparison.report_id);
        assert_eq!(reused.created_at, first.created_at);
        assert_eq!(
            std::fs::read_dir(root.join(".trace/requests"))
                .unwrap()
                .count(),
            2
        );
        assert!(store
            .prepare_review(PrepareReviewInput {
                comparison_token: comparison.token.clone(),
                focus: "Changed review focus".into()
            })
            .unwrap_err()
            .contains("REVIEW_ALREADY_WAITING"));
        for field in ["head", "base", "prior", "checkout"] {
            let mut conflicting = comparison.clone();
            conflicting.token = format!("conflicting-{field}");
            match field {
                "head" => conflicting.head.oid = "d".repeat(40),
                "base" => conflicting.base.oid = "e".repeat(40),
                "prior" => conflicting.prior_report_handle = Some("another-prior-report".into()),
                _ => conflicting.checkout_id = "another-checkout".into(),
            }
            store
                .db
                .execute(
                    "INSERT INTO review_comparisons(token,body) VALUES(?1,?2)",
                    rusqlite::params![
                        conflicting.token,
                        serde_json::to_string(&conflicting).unwrap()
                    ],
                )
                .unwrap();
            assert!(store
                .prepare_review(PrepareReviewInput {
                    comparison_token: conflicting.token,
                    focus: String::new()
                })
                .unwrap_err()
                .contains("REVIEW_ALREADY_WAITING"));
        }
        assert_eq!(store.review_requests().unwrap().len(), 2);
    }
    #[test]
    fn absent_request_output_waits_without_git_but_present_output_still_verifies_git() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("checkout");
        std::fs::create_dir(&root).unwrap();
        for args in [
            vec!["init", "-q"],
            vec![
                "-c",
                "user.name=Trace test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-qm",
                "initial",
            ],
        ] {
            assert!(Command::new("/usr/bin/git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap()
                .status
                .success());
        }
        let mut store = Store::new(temp.path().join("state")).unwrap();
        let checkout = store.choose(&root).unwrap();
        let comparison = store
            .resolve_review(ResolveReviewInput {
                checkout_id: checkout.checkout_id,
                kind: "branch".into(),
                base_ref: Some("HEAD".into()),
                head_ref: Some("HEAD".into()),
                pr_url: None,
                previous_report_handle: None,
            })
            .unwrap();
        let request = store
            .prepare_review(PrepareReviewInput {
                comparison_token: comparison.token.clone(),
                focus: String::new(),
            })
            .unwrap();
        std::fs::rename(root.join(".git"), root.join("unavailable-git")).unwrap();
        assert_eq!(store.check_review(&request.id).unwrap().status, "waiting");
        let mut report: Value = serde_json::from_str(crate::store::EXAMPLE).unwrap();
        report["reportId"] = json!(comparison.report_id);
        report["repository"] =
            json!({"id":comparison.repository_id,"name":comparison.repository_name});
        report["comparison"] = json!({"base":comparison.base,"head":comparison.head});
        report["provenance"]["mode"] = json!("agent");
        for key in [
            "files",
            "contextFiles",
            "rounds",
            "flows",
            "findings",
            "evidence",
            "domainPrimer",
            "valueDerivations",
        ] {
            report[key] = json!([]);
        }
        report.as_object_mut().unwrap().remove("mainJourney");
        crate::validation::validate(&report).unwrap();
        std::fs::write(&request.output_path, serde_json::to_vec(&report).unwrap()).unwrap();
        let blocked = store.check_review(&request.id).unwrap();
        assert_eq!(blocked.status, "needs-attention");
        assert!(blocked.error.unwrap().contains("GIT_ERROR"));
        assert!(store.list().unwrap().is_empty());
        std::fs::rename(root.join("unavailable-git"), root.join(".git")).unwrap();
        assert_eq!(store.check_review(&request.id).unwrap().status, "ready");
        assert_eq!(store.list().unwrap().len(), 1);
    }
}
