use crate::types::{items, text, DiffSide, FileDiff};
use serde_json::Value;
use sha2::Digest;
use similar::{ChangeTag, TextDiff};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_OUTPUT: usize = 16 * 1024 * 1024;
pub const MAX_TEXT: usize = 2 * 1024 * 1024;
const MAX_LINES: usize = 50_000;

fn wait_for_child(child: &mut Child, timeout: Duration) -> std::io::Result<Option<ExitStatus>> {
    // Native hosts may install their own SIGCHLD handler after startup. Poll
    // this child directly instead of relying on process-global notifications:
    // a missed notification must not turn an exited Git process into a timeout.
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
            return Ok(None);
        };
        thread::sleep(remaining.min(Duration::from_millis(5)));
    }
}

/// Fixed system executable, argument arrays, a closed environment override set,
/// bounded output and a timeout. No hooks, textconv, external diff or shell.
pub fn git(repo: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = Command::new("/usr/bin/git");
    command
        .args([
            "--no-replace-objects",
            "--literal-pathspecs",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.pager=cat",
            "-C",
        ])
        .arg(repo)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0");
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_LAZY_FETCH", "1");
    bounded_command(command, "GIT", Duration::from_secs(15))
        .map_err(|reason| git_failure_context(reason, args))
}

fn git_failure_context(reason: String, args: &[&str]) -> String {
    if !reason.starts_with("GIT_TIMEOUT:") {
        return reason;
    }
    let operation = args.first().copied().unwrap_or("operation");
    let hint = if cfg!(target_os = "macos") {
        " Check for a macOS folder-access prompt for Trace, then retry."
    } else {
        ""
    };
    format!("{reason} while running git {operation}.{hint}")
}

pub(crate) fn bounded_command(
    mut command: Command,
    kind: &str,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("{kind}_UNAVAILABLE: {e}"))?;
    let stdout = child.stdout.take().ok_or("Git stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Git stderr unavailable")?;
    let output = thread::spawn(move || {
        let mut b = Vec::new();
        stdout
            .take((MAX_OUTPUT + 1) as u64)
            .read_to_end(&mut b)
            .map(|_| b)
    });
    let errors = thread::spawn(move || {
        let mut b = Vec::new();
        stderr.take(8193).read_to_end(&mut b).map(|_| b)
    });
    let status = match wait_for_child(&mut child, timeout).map_err(|e| e.to_string())? {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = output.join();
            let _ = errors.join();
            return Err(format!(
                "{kind}_TIMEOUT: operation exceeded {} seconds",
                timeout.as_secs()
            ));
        }
    };
    let bytes = output
        .join()
        .map_err(|_| "Git reader failed")?
        .map_err(|e| e.to_string())?;
    let err = errors
        .join()
        .map_err(|_| "Git error reader failed")?
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_OUTPUT {
        return Err("LIMIT_EXCEEDED: Git output exceeds 16 MiB".into());
    }
    if !status.success() {
        return Err(format!(
            "{kind}_ERROR: {}",
            String::from_utf8_lossy(&err).trim()
        ));
    }
    Ok(bytes)
}

fn utf8(bytes: Vec<u8>) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|_| "UNSUPPORTED_PATH: Git output is not UTF-8".into())
}

pub fn repository_root(path: &Path) -> Result<PathBuf, String> {
    let picked = path.canonicalize().map_err(|e| e.to_string())?;
    let root = utf8(git(&picked, &["rev-parse", "--show-toplevel"])?)?;
    Path::new(root.trim_end_matches('\n'))
        .canonicalize()
        .map_err(|e| e.to_string())
}

pub fn remote_identity(root: &Path) -> Option<String> {
    let remote = utf8(git(root, &["config", "--get", "remote.origin.url"]).ok()?).ok()?;
    let s = remote.trim().trim_end_matches('/').trim_end_matches(".git");
    if let Ok(u) = url::Url::parse(s) {
        if matches!(u.scheme(), "http" | "https" | "ssh" | "git") {
            return Some(format!(
                "{}{}",
                u.host_str()?.to_ascii_lowercase(),
                u.path()
            ));
        }
    }
    let (host, path) = s.split_once(':')?;
    if host.contains('/') || path.starts_with('/') {
        return None;
    }
    let host = host.rsplit('@').next()?;
    if !host.contains('.') {
        return None;
    }
    Some(format!("{}/{}", host.to_ascii_lowercase(), path))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub mode: String,
    pub oid: String,
}

pub fn entry(root: &Path, revision: &str, path: &str) -> Result<Option<Entry>, String> {
    let data = git(root, &["ls-tree", "-z", revision, "--", path])?;
    if data.is_empty() {
        return Ok(None);
    }
    let row = data.split(|b| *b == 0).next().unwrap_or(&[]);
    let at = row
        .iter()
        .position(|b| *b == b'\t')
        .ok_or("Invalid Git tree entry")?;
    if &row[at + 1..] != path.as_bytes() {
        return Err("Git tree path mismatch".into());
    }
    let header = std::str::from_utf8(&row[..at]).map_err(|e| e.to_string())?;
    let bits: Vec<_> = header.split_whitespace().collect();
    if bits.len() != 3 {
        return Err("Invalid Git tree header".into());
    }
    Ok(Some(Entry {
        mode: bits[0].into(),
        oid: bits[2].into(),
    }))
}

fn revision<'a>(r: &'a Value, side: &str) -> &'a str {
    r["comparison"][side]["oid"].as_str().unwrap_or("")
}
pub fn side_path<'a>(f: &'a Value, side: &str) -> &'a str {
    if side == "base" {
        f["previousPath"].as_str().unwrap_or(text(f, "path"))
    } else {
        text(f, "path")
    }
}
pub fn file<'a>(r: &'a Value, id: &str) -> Option<&'a Value> {
    items(r, "files")
        .iter()
        .chain(items(r, "contextFiles"))
        .find(|f| text(f, "id") == id)
}

pub fn inventory(
    root: &Path,
    r: &Value,
) -> Result<BTreeMap<String, (String, Option<String>)>, String> {
    let raw = git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--raw",
            "-z",
            "--no-abbrev",
            "--find-renames=50%",
            "--find-copies=50%",
            revision(r, "base"),
            revision(r, "head"),
            "--",
        ],
    )?;
    let pieces: Vec<_> = raw.split(|b| *b == 0).collect();
    let mut i = 0;
    let mut result = BTreeMap::new();
    while i < pieces.len() && !pieces[i].is_empty() {
        let header = std::str::from_utf8(pieces[i]).map_err(|e| e.to_string())?;
        let code = header
            .split_whitespace()
            .nth(4)
            .and_then(|s| s.chars().next())
            .ok_or("Invalid Git raw diff")?;
        let status = match code {
            'A' => "added",
            'M' => "modified",
            'D' => "deleted",
            'R' => "renamed",
            'C' => "copied",
            'T' => "type-changed",
            _ => return Err("Unsupported Git status".into()),
        };
        let first = String::from_utf8(pieces.get(i + 1).ok_or("Missing Git path")?.to_vec())
            .map_err(|_| "Non-UTF8 Git path unsupported")?;
        i += 2;
        let (path, previous) = if matches!(code, 'R' | 'C') {
            let next = String::from_utf8(pieces.get(i).ok_or("Missing rename path")?.to_vec())
                .map_err(|_| "Non-UTF8 Git path unsupported")?;
            i += 1;
            (next, Some(first))
        } else {
            (first, None)
        };
        result.insert(path, (status.into(), previous));
    }
    Ok(result)
}

pub fn verify(root: &Path, r: &Value) -> Result<(), String> {
    if r["provenance"]["mode"] == "synthetic-example" {
        return Err(
            "SYNTHETIC_REPORT: example snapshots cannot be attached to a real checkout".into(),
        );
    }
    for side in ["base", "head"] {
        if git(root, &["cat-file", "-t", revision(r, side)])? != b"commit\n" {
            return Err("INVALID_COMPARISON: object is not a commit".into());
        }
    }
    let actual = inventory(root, r)?;
    for f in items(r, "files") {
        let expected = (
            text(f, "status").to_string(),
            f["previousPath"].as_str().map(str::to_string),
        );
        if actual.get(text(f, "path")) != Some(&expected) {
            return Err(format!("INVENTORY_MISMATCH: {}", text(f, "path")));
        }
    }
    if r["coverage"]["inventory"] == "complete" && actual.len() != items(r, "files").len() {
        return Err("INVENTORY_MISMATCH: complete report omits changed files".into());
    }
    for f in items(r, "contextFiles") {
        let a = entry(root, revision(r, "base"), text(f, "path"))?;
        let b = entry(root, revision(r, "head"), text(f, "path"))?;
        if a.is_none() || a != b {
            return Err(format!(
                "CONTEXT_MISMATCH: {} is not unchanged",
                text(f, "path")
            ));
        }
    }
    let mut cache = BTreeMap::new();
    for e in items(r, "evidence") {
        let f = file(r, text(e, "fileId")).ok_or("Unknown evidence file")?;
        let side = text(e, "side");
        let key = (side.to_string(), text(f, "id").to_string());
        if !cache.contains_key(&key) {
            cache.insert(key.clone(), read_side(root, r, f, side)?);
        }
        let s = &cache[&key];
        if s.kind != "text" {
            return Err(format!(
                "EVIDENCE_UNAVAILABLE: {} is not previewable regular text ({})",
                text(e, "id"),
                s.kind
            ));
        }
        let source = s.text.as_deref().unwrap_or("");
        let lines = source.lines().count() as u64;
        if crate::validation::source_integer(&e["endLine"]).unwrap_or(u64::MAX) > lines {
            return Err(format!(
                "EVIDENCE_RANGE: {} exceeds {lines} lines",
                text(e, "id")
            ));
        }
    }
    Ok(())
}

pub fn read_side(root: &Path, r: &Value, f: &Value, side: &str) -> Result<DiffSide, String> {
    let path = side_path(f, side);
    let oid = revision(r, side);
    let mut result = DiffSide {
        path: path.into(),
        oid: oid.into(),
        blob_oid: None,
        text: None,
        kind: "absent".into(),
        reason: None,
    };
    if (side == "base" && f["status"] == "added") || (side == "head" && f["status"] == "deleted") {
        return Ok(result);
    }
    let ent = entry(root, oid, path)?
        .ok_or_else(|| format!("MISSING_OBJECT: {path} does not exist at {oid}"))?;
    result.blob_oid = Some(ent.oid.clone());
    if ent.mode == "160000" {
        result.kind = "submodule".into();
        result.reason = Some("Git submodule commit; no text preview".into());
        return Ok(result);
    }
    if ent.mode == "120000" {
        result.kind = "symlink".into();
        result.reason = Some("Symbolic link; not followed".into());
        return Ok(result);
    }
    if !matches!(ent.mode.as_str(), "100644" | "100755") {
        result.kind = "unavailable".into();
        result.reason = Some(format!("Unsupported Git mode {}", ent.mode));
        return Ok(result);
    }
    let size = utf8(git(root, &["cat-file", "-s", &ent.oid])?)?
        .trim()
        .parse::<usize>()
        .map_err(|e| e.to_string())?;
    if size > MAX_TEXT {
        result.kind = "large".into();
        result.reason = Some(format!("{size} bytes; preview limit is {MAX_TEXT} bytes"));
        return Ok(result);
    }
    let bytes = git(root, &["cat-file", "blob", &ent.oid])?;
    if bytes.contains(&0) {
        result.kind = "binary".into();
        result.reason = Some("Binary content; no text preview".into());
        return Ok(result);
    }
    match String::from_utf8(bytes) {
        Ok(s) if s.lines().count() <= MAX_LINES => {
            result.kind = "text".into();
            result.text = Some(s);
        }
        Ok(_) => {
            result.kind = "large".into();
            result.reason = Some(format!("More than {MAX_LINES} lines; no inline preview"));
        }
        Err(_) => {
            result.kind = "unavailable".into();
            result.reason = Some("Non-UTF-8 encoding; no lossy code preview".into());
        }
    }
    Ok(result)
}

pub fn read_diff(root: &Path, r: &Value, id: &str) -> Result<FileDiff, String> {
    let f = file(r, id).ok_or("UNKNOWN_FILE: file is not in this report")?;
    let base = read_side(root, r, f, "base")?;
    let head = read_side(root, r, f, "head")?;
    Ok(build_diff(id, base, head))
}

pub fn build_diff(id: &str, base: DiffSide, head: DiffSide) -> FileDiff {
    let (patch, additions, deletions) = if [&base, &head]
        .iter()
        .all(|s| matches!(s.kind.as_str(), "text" | "absent"))
    {
        let before = base.text.as_deref().unwrap_or("");
        let after = head.text.as_deref().unwrap_or("");
        let diff = TextDiff::configure()
            .timeout(Duration::from_secs(2))
            .diff_lines(before, after);
        let mut add = 0;
        let mut del = 0;
        for c in diff.iter_all_changes() {
            match c.tag() {
                ChangeTag::Insert => add += 1,
                ChangeTag::Delete => del += 1,
                _ => (),
            }
        }
        let patch = diff
            .unified_diff()
            .context_radius(3)
            .header(&format!("a/{}", base.path), &format!("b/{}", head.path))
            .to_string();
        (patch, Some(add), Some(del))
    } else {
        (String::new(), None, None)
    };
    FileDiff {
        file_id: id.into(),
        base,
        head,
        patch,
        additions,
        deletions,
    }
}

/// Return a validated local URI; opening it is a separate narrow native action.
pub fn source_url(
    root: &Path,
    r: &Value,
    evidence_id: &str,
) -> Result<(String, PathBuf, u64), String> {
    let e = items(r, "evidence")
        .iter()
        .find(|e| text(e, "id") == evidence_id)
        .ok_or("UNKNOWN_EVIDENCE")?;
    let f = file(r, text(e, "fileId")).ok_or("UNKNOWN_FILE")?;
    let line = crate::validation::source_integer(&e["startLine"]).ok_or("Invalid source line")?;
    let end = crate::validation::source_integer(&e["endLine"]).ok_or("Invalid evidence range")?;
    local_file_url(root, r, f, text(e, "side"), line, Some(end))
}

pub fn file_source_url(
    root: &Path,
    r: &Value,
    file_id: &str,
    requested_side: Option<&str>,
) -> Result<(String, PathBuf, u64), String> {
    let f = file(r, file_id).ok_or("UNKNOWN_FILE: file is not in this report")?;
    let side = file_source_side(f, requested_side)?;
    local_file_url(root, r, f, side, 1, None)
}

fn file_source_side<'a>(f: &Value, requested_side: Option<&'a str>) -> Result<&'a str, String> {
    let side = requested_side.unwrap_or(if f["status"] == "deleted" {
        "base"
    } else {
        "head"
    });
    if !matches!(side, "base" | "head") {
        return Err("INVALID_SIDE: choose base or head".into());
    }
    if (side == "base" && f["status"] == "added") || (side == "head" && f["status"] == "deleted") {
        return Err("MISSING_SOURCE: file does not exist on this side of the comparison".into());
    }
    Ok(side)
}

/// Construct a fixed HTTPS GitHub blob URL from validated inventory and identity.
/// Report Markdown and arbitrary external URLs cannot be forwarded to the opener.
pub fn github_file_url(
    r: &Value,
    file_id: &str,
    requested_side: Option<&str>,
) -> Result<(String, PathBuf, u64), String> {
    let f = file(r, file_id).ok_or("UNKNOWN_FILE: file is not in this report")?;
    let side = file_source_side(f, requested_side)?;
    let identity = text(&r["repository"], "id");
    let repository = identity
        .strip_prefix("github.com/")
        .ok_or("GITHUB_UNAVAILABLE: report does not identify a GitHub repository")?;
    let parts: Vec<_> = repository.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|p| {
            p.is_empty()
                || matches!(*p, "." | "..")
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        })
    {
        return Err("GITHUB_UNAVAILABLE: repository identity is invalid".into());
    }
    if let Some(web) = r["repository"]["webUrl"].as_str() {
        let url =
            url::Url::parse(web).map_err(|_| "GITHUB_UNAVAILABLE: repository URL is invalid")?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path().trim_end_matches('/') != format!("/{repository}")
        {
            return Err("GITHUB_UNAVAILABLE: repository URL disagrees with its identity".into());
        }
    }
    let path = side_path(f, side);
    let mut url = url::Url::parse("https://github.com").map_err(|e| e.to_string())?;
    {
        let mut segments = url.path_segments_mut().map_err(|_| "GITHUB_UNAVAILABLE")?;
        segments.extend(parts).push("blob").push(revision(r, side));
        segments.extend(path.split('/'));
    }
    url.set_fragment(Some("L1"));
    Ok((url.into(), PathBuf::from(path), 1))
}

fn local_file_url(
    root: &Path,
    r: &Value,
    f: &Value,
    side: &str,
    line: u64,
    evidence_end: Option<u64>,
) -> Result<(String, PathBuf, u64), String> {
    let source = read_side(root, r, f, side)?;
    if source.kind != "text" {
        return Err("Source evidence is not a regular text file".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(&source.path);
    if fs::symlink_metadata(&path)
        .map_err(|_| "Local file is missing; inspect the committed snapshot in Trace")?
        .file_type()
        .is_symlink()
    {
        return Err("Local file is a symlink; inspect the committed snapshot in Trace".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err("Local source is outside the registered repository".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(&canonical)
        .map_err(|e| e.to_string())?
        .take((MAX_TEXT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_TEXT {
        return Err("Local source exceeds the comparison limit".into());
    }
    let mut object = format!("blob {}\0", bytes.len()).into_bytes();
    object.extend(bytes);
    let expected = source.blob_oid.as_deref().unwrap_or("");
    let actual = if expected.len() == 64 {
        format!("{:x}", sha2::Sha256::digest(&object))
    } else {
        format!("{:x}", sha1::Sha1::digest(&object))
    };
    if actual != expected {
        return Err("Local file differs from the reviewed snapshot. Open its exact committed diff in Trace.".into());
    }
    if line == 0
        || evidence_end.is_some_and(|end| {
            end < line || end > source.text.as_deref().unwrap_or("").lines().count() as u64
        })
    {
        return Err("EVIDENCE_RANGE: source anchor exceeds snapshot lines".into());
    }
    Ok((source_uri(&canonical, line)?, canonical, line))
}

pub fn source_uri(path: &Path, line: u64) -> Result<String, String> {
    use std::fmt::Write;
    if !path.is_absolute() || line == 0 {
        return Err("Invalid local source location".into());
    }
    let raw = path.to_str().ok_or("Unsupported non-UTF-8 local path")?;
    let mut uri = String::from("vscode://file");
    // Encode literal bytes once. URL::set_path preserves existing percent
    // sequences, which would confuse a%20b.ts with a b.ts.
    for byte in raw.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            uri.push(byte as char);
        } else {
            write!(&mut uri, "%{byte:02X}").map_err(|e| e.to_string())?;
        }
    }
    write!(&mut uri, ":{line}").map_err(|e| e.to_string())?;
    Ok(uri)
}

pub fn code_identity(root: &Path, r: &Value) -> Result<Value, String> {
    let mut all = BTreeMap::new();
    for f in items(r, "files").iter().chain(items(r, "contextFiles")) {
        let mut sides = BTreeMap::new();
        for side in ["base", "head"] {
            let item = entry(root, revision(r, side), side_path(f, side))?;
            sides.insert(side,serde_json::json!({"path":side_path(f,side),"mode":item.as_ref().map(|e|&e.mode),"blob":item.as_ref().map(|e|&e.oid)}));
        }
        all.insert(
            text(f, "id"),
            serde_json::json!({"status":f["status"],"sides":sides}),
        );
    }
    Ok(serde_json::json!(all))
}

#[cfg(test)]
mod process_wait_tests {
    use super::*;
    use std::time::Instant;

    extern "C" fn host_signal_handler(_: libc::c_int) {}

    #[test]
    fn git_timeout_names_the_operation_without_rewriting_other_failures() {
        let timeout = "GIT_TIMEOUT: operation exceeded 15 seconds";
        let message = git_failure_context(timeout.into(), &["rev-parse", "--show-toplevel"]);
        assert!(message.starts_with(timeout));
        assert!(message.contains("while running git rev-parse."));
        assert_eq!(
            message.contains("macOS folder-access prompt"),
            cfg!(target_os = "macos")
        );
        for other in [
            "GIT_ERROR: invalid revision",
            "GIT_UNAVAILABLE: denied",
            "LIMIT_EXCEEDED: output",
        ] {
            assert_eq!(git_failure_context(other.into(), &["cat-file"]), other);
        }
    }

    #[test]
    fn completion_does_not_depend_on_sigchld_delivery() {
        const MARKER: &str = "TRACE_WAIT_SIGNAL_TEST_CHILD";
        if std::env::var_os(MARKER).is_none() {
            // Signal disposition is process-global: isolate the simulated host
            // handler from all other concurrently running native tests.
            let result = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "git::process_wait_tests::completion_does_not_depend_on_sigchld_delivery",
                    "--nocapture",
                ])
                .env(MARKER, "1")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            return;
        }
        let limit = Duration::from_millis(300);
        let mut warm = Command::new("/bin/sleep").arg("0.02").spawn().unwrap();
        assert!(wait_for_child(&mut warm, limit).unwrap().unwrap().success());
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = host_signal_handler as usize;
            libc::sigemptyset(&mut action.sa_mask);
            assert_eq!(
                libc::sigaction(libc::SIGCHLD, &action, std::ptr::null_mut()),
                0
            );
        }
        let mut child = Command::new("/bin/sleep").arg("0.03").spawn().unwrap();
        let started = Instant::now();
        let result = wait_for_child(&mut child, limit).unwrap();
        let actual = child.try_wait().unwrap();
        assert!(
            result.is_some_and(|status| status.success()),
            "completion was missed after {:?}; direct child status: {actual:?}",
            started.elapsed()
        );
    }

    #[test]
    fn live_child_still_observes_the_timeout() {
        let mut child = Command::new("/bin/sleep").arg("1").spawn().unwrap();
        let started = Instant::now();
        let result = wait_for_child(&mut child, Duration::from_millis(25)).unwrap();
        // Reap even when an assertion fails below.
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(result.is_none());
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
