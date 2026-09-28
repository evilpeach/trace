//! External-agent handoff. Trace creates instructions and validates one exact
//! output; it never starts, controls, or claims to sandbox an agent process.
use crate::{
    git,
    store::{Store, MAX_REPORT_BYTES},
    types::*,
    validation,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::os::{
    fd::{AsRawFd, FromRawFd},
    unix::fs::OpenOptionsExt,
};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    process::Command,
    time::Duration,
};
use uuid::Uuid;

const TOOLKIT: &[(&str, &str)] = &[
    (
        "SKILL.md",
        include_str!("../../../../docs/trace/skills/trace-report/SKILL.md"),
    ),
    (
        "references/contract.md",
        include_str!("../../../../docs/trace/skills/trace-report/references/contract.md"),
    ),
    (
        "references/schema.json",
        include_str!("../../../../docs/trace/skills/trace-report/references/schema.json"),
    ),
    (
        "references/example.trace.json",
        include_str!("../../../../docs/trace/skills/trace-report/references/example.trace.json"),
    ),
    (
        "scripts/validate.py",
        include_str!("../../../../docs/trace/skills/trace-report/scripts/validate.py"),
    ),
];
fn err(e: impl std::fmt::Display) -> String {
    format!("REVIEW_REQUEST_ERROR: {e}")
}
fn git_text(root: &Path, args: &[&str]) -> Result<String, String> {
    String::from_utf8(git::git(root, args)?)
        .map(|s| s.trim().to_string())
        .map_err(err)
}
fn commit(root: &Path, value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 1024
        || value.starts_with('-')
        || value.chars().any(char::is_control)
    {
        return Err("INVALID_REF: enter a branch, tag, or commit name".into());
    }
    git_text(root, &["rev-parse", "--verify", "--end-of-options", &format!("{value}^{{commit}}")])
        .map_err(|_| format!("MISSING_COMMIT: {value} is not a local commit. Fetch it in your editor or terminal, then retry; Trace does not fetch."))
}
fn comparison_value(comparison: &ReviewComparison) -> Value {
    json!({"comparison":{"base":comparison.base,"head":comparison.head}})
}
pub(crate) fn same_review_target(a: &ReviewComparison, b: &ReviewComparison) -> bool {
    if a.repository_id != b.repository_id {
        return false;
    }
    match (&a.pr, &b.pr) {
        (Some(a), Some(b)) => a.number == b.number && a.url == b.url,
        (None, None) => a.base.oid == b.base.oid && a.head.oid == b.head.oid,
        _ => false,
    }
}
/// `Store::list` is newest-imported first. Never borrow another PR's lineage,
/// even when commit snapshots, branch names, or PR numbers happen to match.
pub(crate) fn latest_pr_report(
    reports: &[ReportSummary],
    repository: &str,
    number: u64,
    url: &str,
) -> Option<String> {
    reports
        .iter()
        .find(|report| {
            report.project_id == repository
                && report.pr_number == Some(number)
                && report.pr_url.as_deref() == Some(url)
        })
        .map(|report| report.handle.clone())
}
pub(crate) fn pr_url(value: &str, repository: &str) -> Result<(u64, String), String> {
    let url = url::Url::parse(value).map_err(|_| "INVALID_PR: enter a GitHub pull request URL")?;
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || parts.len() != 4
        || parts[2] != "pull"
        || format!("github.com/{}/{}", parts[0], parts[1]) != repository
    {
        return Err(
            "REPOSITORY_MISMATCH: use a GitHub PR URL belonging to the selected project".into(),
        );
    }
    let number = parts[3]
        .parse::<u64>()
        .ok()
        .filter(|n| *n > 0)
        .ok_or("INVALID_PR: invalid pull request number")?;
    Ok((number, format!("https://{repository}/pull/{number}")))
}
fn pr_metadata(root: &Path, repository: &str, url: &str) -> Result<Value, String> {
    let (number, _) = pr_url(url, repository)?;
    let executable = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"].into_iter()
        .find(|path| Path::new(path).is_file())
        .ok_or("GITHUB_CLI_UNAVAILABLE: install and sign in to GitHub CLI, or choose Branch comparison")?;
    let mut command = Command::new(executable);
    command
        .current_dir(root)
        .args([
            "pr",
            "view",
            &number.to_string(),
            "--repo",
            repository,
            "--json",
            "number,url,title,baseRefName,baseRefOid,headRefName,headRefOid",
        ])
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat");
    let bytes =
        git::bounded_command(command, "GITHUB", Duration::from_secs(20)).map_err(|error| {
            format!("{error}. Sign in with GitHub CLI or choose Branch comparison.")
        })?;
    serde_json::from_slice(&bytes).map_err(err)
}

// Every directory/file is opened relative to a checked descriptor. Replacing
// .trace, requests, or the request folder with a symlink cannot redirect reads.
fn root_directory(path: &Path) -> Result<fs::File, String> {
    if path.canonicalize().map_err(err)? != path {
        return Err("UNSAFE_PATH: project or application directory moved".into());
    }
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(err)
}
fn child_directory(parent: &fs::File, name: &str, create: bool) -> Result<fs::File, String> {
    let name = std::ffi::CString::new(name).map_err(err)?;
    if create {
        let result = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
        if result != 0
            && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(err(std::io::Error::last_os_error()));
        }
    }
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(format!("UNSAFE_PATH: {}", std::io::Error::last_os_error()));
    }
    Ok(unsafe { fs::File::from_raw_fd(fd) })
}
fn request_directory(root: &Path, id: &str, create: bool) -> Result<fs::File, String> {
    Uuid::parse_str(id).map_err(|_| "INVALID_REQUEST: invalid request identity")?;
    let root = root_directory(root)?;
    let trace = child_directory(&root, ".trace", create)?;
    let requests = child_directory(&trace, "requests", create)?;
    child_directory(&requests, id, create)
}
fn write_new(parent: &fs::File, name: &str, contents: &[u8]) -> Result<(), String> {
    let name = std::ffi::CString::new(name).map_err(err)?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(err(std::io::Error::last_os_error()));
    }
    let mut file = unsafe { fs::File::from_raw_fd(fd) };
    file.write_all(contents).map_err(err)?;
    file.sync_all().map_err(err)
}
fn output_bytes(directory: &fs::File, name: &str) -> Result<Option<Vec<u8>>, String> {
    let name = std::ffi::CString::new(name).map_err(err)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = std::io::Error::last_os_error();
        return if error.kind() == std::io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(format!("UNSAFE_REPORT: {error}"))
        };
    }
    let file = unsafe { fs::File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(err)?;
    if !metadata.is_file() {
        return Err("UNSAFE_REPORT: expected a regular report file".into());
    }
    if metadata.len() > MAX_REPORT_BYTES as u64 {
        return Err("LIMIT_EXCEEDED: report is larger than 20 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_REPORT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > MAX_REPORT_BYTES {
        return Err("LIMIT_EXCEEDED: report grew beyond 20 MiB".into());
    }
    Ok(Some(bytes))
}

impl Store {
    pub(crate) fn request_checkout(&self, id: &str) -> Result<RepositoryInfo, String> {
        let checkout = self.repository(id)?;
        let root = Path::new(&checkout.display_path);
        if git::repository_root(root)? != root {
            return Err("REPOSITORY_MOVED: reconnect the project checkout".into());
        }
        let remote = git::remote_identity(root);
        if remote
            .as_deref()
            .is_some_and(|remote| remote != checkout.repository_id)
            || (remote.is_none() && !checkout.repository_id.starts_with("local:"))
        {
            return Err(
                "REPOSITORY_MISMATCH: checkout identity changed; reconnect the project".into(),
            );
        }
        Ok(checkout)
    }
    pub fn review_setup(&self, checkout_id: &str) -> Result<ReviewSetup, String> {
        let checkout = self.request_checkout(checkout_id)?;
        let root = Path::new(&checkout.display_path);
        let head = commit(root, "HEAD")?;
        let head_ref =
            git_text(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or(head.clone());
        let previous = self
            .list()?
            .into_iter()
            .find(|item| item.project_id == checkout.repository_id && item.head == head);
        let default_base_ref = previous
            .as_ref()
            .map(|item| self.record(&item.handle))
            .transpose()?
            .map(|r| text(&r.report["comparison"]["base"], "oid").to_string());
        let (default_base_ref, base_source) = if default_base_ref.is_some() {
            (default_base_ref, "previous-report")
        } else {
            let remote = git_text(
                root,
                &[
                    "symbolic-ref",
                    "--quiet",
                    "--short",
                    "refs/remotes/origin/HEAD",
                ],
            )
            .ok();
            let source = if remote.is_some() {
                "remote-default"
            } else {
                "none"
            };
            (remote, source)
        };
        Ok(ReviewSetup {
            checkout_id: checkout_id.into(),
            head_ref,
            default_base_ref,
            base_source: base_source.into(),
        })
    }
    pub fn resolve_review(&self, input: ResolveReviewInput) -> Result<ReviewComparison, String> {
        let checkout = self.request_checkout(&input.checkout_id)?;
        let root = Path::new(&checkout.display_path);
        let (base_ref, head_ref, pr) = match input.kind.as_str() {
            "branch" => (
                input.base_ref.filter(|s| !s.trim().is_empty()).ok_or(
                    "BASE_REQUIRED: choose the intended base, especially for stacked branches",
                )?,
                input.head_ref.unwrap_or_else(|| "HEAD".into()),
                None,
            ),
            "pull-request" => {
                let url = input
                    .pr_url
                    .as_deref()
                    .ok_or("PR_REQUIRED: enter the GitHub pull request URL")?;
                let (number, canonical) = pr_url(url, &checkout.repository_id)?;
                let metadata = pr_metadata(root, &checkout.repository_id, url)?;
                if metadata["number"].as_u64() != Some(number)
                    || text(&metadata, "url") != canonical
                {
                    return Err("PR_MISMATCH: GitHub returned a different pull request".into());
                }
                (
                    text(&metadata, "baseRefOid").to_string(),
                    text(&metadata, "headRefOid").to_string(),
                    Some((
                        ReviewPullRequest {
                            number,
                            url: canonical,
                            title: text(&metadata, "title").into(),
                        },
                        text(&metadata, "baseRefName").to_string(),
                        text(&metadata, "headRefName").to_string(),
                    )),
                )
            }
            _ => return Err("INVALID_COMPARISON: choose branch or pull-request".into()),
        };
        let base_tip = commit(root, &base_ref)?;
        let head = commit(root, &head_ref)?;
        let base = git_text(root, &["merge-base", &base_tip, &head])?;
        let (pr, base_label, head_label) = match pr {
            Some((pr, base, head)) => (Some(pr), base, head),
            None => (None, base_ref, head_ref),
        };
        let previous_report_handle = match (input.previous_report_handle, pr.as_ref()) {
            (Some(handle), _) => Some(handle),
            (None, Some(pr)) => {
                latest_pr_report(&self.list()?, &checkout.repository_id, pr.number, &pr.url)
            }
            (None, None) => None,
        };
        let previous = previous_report_handle
            .as_deref()
            .map(|handle| self.record(handle))
            .transpose()?;
        if let Some(previous) = &previous {
            if text(&previous.report["repository"], "id") != checkout.repository_id {
                return Err(
                    "REPOSITORY_MISMATCH: previous report belongs to a different project".into(),
                );
            }
            match (&pr, previous.report.get("pullRequest")) {
                (Some(pr), Some(old))
                    if old["number"].as_u64() == Some(pr.number) && text(old, "url") == pr.url => {}
                (None, None) => {}
                _ => {
                    return Err(
                        "PR_MISMATCH: refresh the same pull request, or create a separate review"
                            .into(),
                    )
                }
            }
        }
        let token = Uuid::new_v4().to_string();
        let mut comparison = ReviewComparison {
            token: token.clone(),
            checkout_id: checkout.checkout_id,
            repository_id: checkout.repository_id.clone(),
            repository_name: self
                .projects()?
                .into_iter()
                .find(|p| p.id == checkout.repository_id)
                .map(|p| p.name)
                .unwrap_or_else(|| {
                    root.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                }),
            base: ReviewRevision {
                oid: base,
                label: base_label,
            },
            head: ReviewRevision {
                oid: head,
                label: head_label,
            },
            changed_file_count: 0,
            pr,
            report_id: previous
                .as_ref()
                .map(|p| text(&p.report, "reportId").to_string())
                .unwrap_or_else(|| format!("trace-{token}")),
            prior_report_handle: previous_report_handle,
        };
        comparison.changed_file_count = git::inventory(root, &comparison_value(&comparison))?.len();
        self.db
            .execute(
                "INSERT INTO review_comparisons(token,body) VALUES(?1,?2)",
                params![token, serde_json::to_string(&comparison).map_err(err)?],
            )
            .map_err(err)?;
        Ok(comparison)
    }
    pub fn prepare_review(&mut self, input: PrepareReviewInput) -> Result<ReviewRequest, String> {
        if input.focus.len() > 16_000 {
            return Err("LIMIT_EXCEEDED: review focus exceeds 16000 bytes".into());
        }
        let body: Option<String> = self
            .db
            .query_row(
                "SELECT body FROM review_comparisons WHERE token=?1",
                [&input.comparison_token],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let comparison: ReviewComparison =
            serde_json::from_str(&body.ok_or("UNKNOWN_COMPARISON: resolve the comparison again")?)
                .map_err(err)?;
        let pending = self.review_requests()?.into_iter().find(|request| {
            matches!(request.status.as_str(), "waiting" | "needs-attention")
                && same_review_target(&comparison, &request.comparison)
        });
        if let Some(request) = pending {
            // Preparing the same immutable handoff twice is idempotent. Reuse
            // its report identity, prompt, output and any validation feedback;
            // never rewrite files that the user's agent may already be using.
            if request.comparison.checkout_id == comparison.checkout_id
                && request.comparison.base.oid == comparison.base.oid
                && request.comparison.head.oid == comparison.head.oid
                && request.focus.trim() == input.focus.trim()
                && request.comparison.prior_report_handle == comparison.prior_report_handle
            {
                return Ok(request);
            }
            return Err(format!("REVIEW_ALREADY_WAITING: check or cancel the existing request {} for this PR or comparison before preparing another", request.id));
        }
        let checkout = self.request_checkout(&comparison.checkout_id)?;
        if checkout.repository_id != comparison.repository_id {
            return Err("REPOSITORY_MISMATCH: resolve the comparison again".into());
        }
        let root = Path::new(&checkout.display_path);
        commit(root, &comparison.base.oid)?;
        commit(root, &comparison.head.oid)?;
        let id = Uuid::new_v4().to_string();
        let _output_directory = request_directory(root, &id, true)?;
        let app = root_directory(&self.directory.canonicalize().map_err(err)?)?;
        let packages = child_directory(&app, "review-requests", true)?;
        let package = child_directory(&packages, &id, true)?;
        let toolkit = child_directory(&package, "trace-report", true)?;
        for (path, content) in TOOLKIT {
            if let Some((directory, filename)) = path.split_once('/') {
                write_new(
                    &child_directory(&toolkit, directory, true)?,
                    filename,
                    content.as_bytes(),
                )?;
            } else {
                write_new(&toolkit, path, content.as_bytes())?;
            }
        }
        let toolkit_path = self
            .directory
            .canonicalize()
            .map_err(err)?
            .join("review-requests")
            .join(&id)
            .join("trace-report");
        let prior = if let Some(handle) = &comparison.prior_report_handle {
            let previous = self.record(handle)?;
            write_new(
                &package,
                "previous.trace.json",
                &serde_json::to_vec_pretty(&previous.report).map_err(err)?,
            )?;
            Some(toolkit_path.parent().unwrap().join("previous.trace.json"))
        } else {
            None
        };
        let output_path = root
            .join(".trace")
            .join("requests")
            .join(&id)
            .join("report.trace.json");
        let mut manifest = json!({"repository":{"id":comparison.repository_id,"name":comparison.repository_name},"checkout":checkout.display_path,"reportId":comparison.report_id,"comparison":{"base":comparison.base,"head":comparison.head},"outputPath":output_path});
        if let Some(pr) = &comparison.pr {
            manifest["pullRequest"] = json!({"number":pr.number,"url":pr.url});
        }
        if let Some(prior) = &prior {
            manifest["previousReportPath"] = json!(prior);
        }
        let prompt = format!("Create a Trace code review report for the exact immutable comparison below.\n\nRead the bundled skill at {} and its references before reviewing. This is an external-agent handoff: Trace does not sandbox this agent session; follow your normal approval settings. Inspect committed snapshots and relevant callers; do not change source files or reviewer state. Use the exact repository ID, reportId and commits below. Include the complete changed-file inventory with file TLDRs, main end-to-end journey first, evidence-backed flows and only supported findings. Report actual verification and limitations honestly.\n\n{}\n\nReview focus (user-provided):\n{}\n\n{}\nWrite a draft in the output directory with a different suffix, run the bundled scripts/validate.py validator (Python3 plus jsonschema>=4.18), then atomically rename the validated report to the exact outputPath. Trace independently validates the report and Git evidence before importing. No external messages, source changes, or review-progress edits are authorized by this handoff.", toolkit_path.join("SKILL.md").display(), serde_json::to_string_pretty(&manifest).map_err(err)?, if input.focus.trim().is_empty() { "Review correctness, regressions, and the main changed journey." } else { input.focus.trim() }, if prior.is_some() { "Refresh the copied previous report: preserve reportId and stable entity IDs when their conceptual identity persists. Recheck changed sources and evidence; a missing finding is not proof that it is fixed." } else { "This is a new review; generate stable, descriptive entity IDs." });
        let prompt = format!("{prompt}\n\nThe manifest includes request metadata: checkout, outputPath and previousReportPath are instructions, not portable report fields. {}", if comparison.pr.is_none() { "This is a branch comparison: omit pullRequest from the report entirely, rather than writing null." } else { "Include exactly the manifest's pullRequest number and URL." });
        let request = ReviewRequest {
            id: id.clone(),
            comparison,
            focus: input.focus,
            prompt,
            output_path: output_path.to_string_lossy().into(),
            toolkit_path: toolkit_path.to_string_lossy().into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            status: "waiting".into(),
            error: None,
            report_handle: None,
        };
        self.db
            .execute(
                "INSERT INTO review_requests(id,body,created_at) VALUES(?1,?2,?3)",
                params![
                    id,
                    serde_json::to_string(&request).map_err(err)?,
                    request.created_at
                ],
            )
            .map_err(err)?;
        Ok(request)
    }
    pub(crate) fn request(&self, id: &str) -> Result<ReviewRequest, String> {
        let body: Option<String> = self
            .db
            .query_row("SELECT body FROM review_requests WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        serde_json::from_str(&body.ok_or("UNKNOWN_REQUEST: review request was not found")?)
            .map_err(err)
    }
    fn update_request(&self, request: &ReviewRequest) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE review_requests SET body=?2 WHERE id=?1",
                params![request.id, serde_json::to_string(request).map_err(err)?],
            )
            .map_err(err)?;
        Ok(())
    }
    pub fn review_requests(&self) -> Result<Vec<ReviewRequest>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT body FROM review_requests WHERE json_extract(body,'$.status') IN ('waiting','needs-attention') OR id IN (SELECT id FROM review_requests ORDER BY created_at DESC LIMIT 200) ORDER BY created_at DESC")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn cancel_review(&self, id: &str) -> Result<ReviewRequest, String> {
        let mut request = self.request(id)?;
        if request.status != "ready" {
            request.status = "cancelled".into();
            request.error = None;
            self.update_request(&request)?;
        }
        Ok(request)
    }
    pub fn check_review(&mut self, id: &str) -> Result<ReviewRequest, String> {
        let mut request = self.request(id)?;
        if matches!(request.status.as_str(), "ready" | "cancelled") {
            return Ok(request);
        }
        let result = (|| -> Result<Option<String>, String> {
            // Waiting is a filesystem observation. Do not spawn Git for every
            // absent stack output; accept_review_output performs the complete
            // live repository/snapshot validation before any import.
            let checkout = self.repository(&request.comparison.checkout_id)?;
            if checkout.repository_id != request.comparison.repository_id {
                return Err("REPOSITORY_MISMATCH: project identity changed".into());
            }
            let root = Path::new(&checkout.display_path);
            let directory = request_directory(root, id, false)?;
            let Some(bytes) = output_bytes(&directory, "report.trace.json")? else {
                return Ok(None);
            };
            self.accept_review_output(&request, &bytes).map(Some)
        })();
        self.finish_review_check(&mut request, result)?;
        Ok(request)
    }
    pub fn import_review_path(&mut self, id: &str, path: &Path) -> Result<ReviewRequest, String> {
        let mut request = self.request(id)?;
        if matches!(request.status.as_str(), "ready" | "cancelled") {
            return Ok(request);
        }
        let result = (|| -> Result<Option<String>, String> {
            if !path.is_absolute() {
                return Err("INVALID_PATH: enter an absolute report path".into());
            }
            let parent = path
                .parent()
                .ok_or("INVALID_PATH")?
                .canonicalize()
                .map_err(err)?;
            let directory = root_directory(&parent)?;
            let name = path
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or("UNSUPPORTED_PATH: report filename must be UTF-8")?;
            let bytes = output_bytes(&directory, name)?
                .ok_or("MISSING_REPORT: selected report does not exist")?;
            self.accept_review_output(&request, &bytes).map(Some)
        })();
        self.finish_review_check(&mut request, result)?;
        Ok(request)
    }
    fn accept_review_output(
        &mut self,
        request: &ReviewRequest,
        bytes: &[u8],
    ) -> Result<String, String> {
        let checkout = self.request_checkout(&request.comparison.checkout_id)?;
        if checkout.repository_id != request.comparison.repository_id {
            return Err("REPOSITORY_MISMATCH: project identity changed".into());
        }
        let root = Path::new(&checkout.display_path);
        let report: Value =
            serde_json::from_slice(bytes).map_err(|e| format!("INVALID_REPORT: {e}"))?;
        validation::validate(&report)?;
        let expected = &request.comparison;
        if text(&report["repository"], "id") != expected.repository_id
            || text(&report, "reportId") != expected.report_id
            || text(&report["comparison"]["base"], "oid") != expected.base.oid
            || text(&report["comparison"]["head"], "oid") != expected.head.oid
        {
            return Err("REPORT_MISMATCH: repository, reportId, or exact base/head commits do not match this request".into());
        }
        match (&expected.pr, report.get("pullRequest")) {
            (Some(pr), Some(value))
                if value["number"].as_u64() == Some(pr.number) && text(value, "url") == pr.url => {}
            (None, None) => {}
            _ => return Err("PR_MISMATCH: report pull request does not match this request".into()),
        }
        if report["coverage"]["inventory"] != "complete" {
            return Err(
                "INCOMPLETE_INVENTORY: include every changed file before completing this request"
                    .into(),
            );
        }
        git::verify(root, &report)?;
        let loaded = self.import_value_mode(report, false, Some(&checkout))?;
        // Duplicate manual imports may not yet have a checkout mapping.
        // Attaching this already verified identity does not activate it or
        // mutate human decisions, checkpoint, or review revision.
        if loaded.repository.is_none() {
            let identity = git::code_identity(root, &loaded.report)?;
            self.db
                .execute(
                    "UPDATE reports SET checkout_id=?2,code_identity=?3 WHERE handle=?1",
                    params![loaded.handle, checkout.checkout_id, identity.to_string()],
                )
                .map_err(err)?;
        }
        Ok(loaded.handle)
    }
    fn finish_review_check(
        &self,
        request: &mut ReviewRequest,
        result: Result<Option<String>, String>,
    ) -> Result<(), String> {
        match result {
            Ok(Some(handle)) => {
                request.status = "ready".into();
                request.report_handle = Some(handle);
                request.error = None;
            }
            Ok(None) => {
                request.status = "waiting".into();
                request.error = None;
            }
            Err(error) => {
                request.status = "needs-attention".into();
                request.error = Some(error);
            }
        }
        self.update_request(request)
    }
}
