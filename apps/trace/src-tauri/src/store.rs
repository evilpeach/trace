use crate::{git, types::*, validation};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_REPORT_BYTES: usize = 20 * 1024 * 1024;
pub const EXAMPLE: &str =
    include_str!("../../../../docs/trace/skills/trace-report/references/example.trace.json");
pub struct Store {
    pub(crate) db: Connection,
    pub(crate) directory: PathBuf,
}

fn err(e: impl std::fmt::Display) -> String {
    format!("STORAGE_ERROR: {e}")
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Both picker and explicitly entered paths must name an existing local object.
/// Canonicalization resolves symlinks without interpreting URLs or shell syntax.
fn selected_local_path(path: &Path, directory: bool) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("INVALID_PATH: enter an absolute local path".into());
    }
    let path = path
        .canonicalize()
        .map_err(|e| format!("PATH_ERROR: {e}"))?;
    let metadata = fs::metadata(&path).map_err(|e| format!("PATH_ERROR: {e}"))?;
    if directory && !metadata.is_dir() {
        return Err("INVALID_SELECTION: select a repository directory".into());
    }
    if !directory && !metadata.is_file() {
        return Err("INVALID_SELECTION: select a regular report file".into());
    }
    Ok(path)
}

pub(crate) fn digest(v: &Value) -> String {
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(object) => {
                let sorted: BTreeMap<_, _> = object.iter().collect();
                let mut result = serde_json::Map::new();
                for (key, value) in sorted {
                    result.insert(key.clone(), canonical(value));
                }
                Value::Object(result)
            }
            Value::Array(array) => Value::Array(array.iter().map(canonical).collect()),
            _ => value.clone(),
        }
    }
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical(v)).expect("JSON value serializes"))
    )
}

pub(crate) struct Record {
    pub(crate) handle: String,
    pub(crate) digest: String,
    pub(crate) report: Value,
    pub(crate) checkout_id: Option<String>,
}

impl Store {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(directory.join("reports")).map_err(err)?;
        let db = Connection::open(directory.join("trace.sqlite3")).map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if version > 3 {
            return Err(
                "UNSUPPORTED_STATE_VERSION: this database belongs to a newer Trace version".into(),
            );
        }
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
          BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS checkouts (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, root TEXT NOT NULL UNIQUE);
          CREATE TABLE IF NOT EXISTS reports (handle TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, repo_id TEXT NOT NULL, report_id TEXT NOT NULL, body TEXT NOT NULL, imported_at TEXT NOT NULL, checkout_id TEXT REFERENCES checkouts(id), code_identity TEXT);
          CREATE TABLE IF NOT EXISTS reviews (repo_id TEXT NOT NULL, report_id TEXT NOT NULL, active_handle TEXT NOT NULL REFERENCES reports(handle), revision INTEGER NOT NULL DEFAULT 0, checkpoint TEXT, PRIMARY KEY(repo_id,report_id));
          CREATE TABLE IF NOT EXISTS decisions (repo_id TEXT NOT NULL, report_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(repo_id,report_id,kind,entity_id));
          CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, repo_id TEXT NOT NULL, report_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, previous_body TEXT NOT NULL, changed_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS projects (repository_id TEXT PRIMARY KEY, name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS discovery_sources (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, handle TEXT NOT NULL REFERENCES reports(handle));
          CREATE TABLE IF NOT EXISTS review_comparisons (token TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS review_requests (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL);
          PRAGMA user_version=3;
          COMMIT;").map_err(err)?;
        let store = Self { db, directory };
        store.migrate_projects()?;
        Ok(store)
    }

    pub fn import_path(&mut self, path: &Path) -> Result<LoadedReport, String> {
        let path = selected_local_path(path, false)?;
        let mut options = fs::OpenOptions::new();
        options.read(true);
        // A file may be replaced after validation. Nonblocking open prevents a
        // swapped-in FIFO from hanging; inspect the opened object before reading.
        #[cfg(unix)]
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
        let file = options
            .open(&path)
            .map_err(|e| format!("IMPORT_ERROR: {e}"))?;
        if !file.metadata().map_err(err)?.is_file() {
            return Err("INVALID_SELECTION: select a regular report file".into());
        }
        let mut content = Vec::new();
        file.take((MAX_REPORT_BYTES + 1) as u64)
            .read_to_end(&mut content)
            .map_err(err)?;
        if content.len() > MAX_REPORT_BYTES {
            return Err("LIMIT_EXCEEDED: report is larger than 20 MiB".into());
        }
        let report: Value =
            serde_json::from_slice(&content).map_err(|e| format!("INVALID_REPORT: {e}"))?;
        self.import_value(report)
    }

    pub fn import_value(&mut self, report: Value) -> Result<LoadedReport, String> {
        self.import_value_mode(report, true, None)
    }

    pub(crate) fn import_value_mode(
        &mut self,
        report: Value,
        activate: bool,
        preferred: Option<&RepositoryInfo>,
    ) -> Result<LoadedReport, String> {
        validation::validate(&report)?;
        let hash = digest(&report);
        let existing: Option<String> = self
            .db
            .query_row("SELECT handle FROM reports WHERE digest=?1", [&hash], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if let Some(handle) = existing {
            return if activate {
                self.open(&handle)
            } else {
                self.loaded(&handle)
            };
        }
        let handle = Uuid::new_v4().to_string();
        let serialized = serde_json::to_string(&report).map_err(err)?;
        let path = self
            .directory
            .join("reports")
            .join(format!("{hash}.trace.json"));
        let staging = self
            .directory
            .join("reports")
            .join(format!(".{}.tmp", Uuid::new_v4()));
        let publish = (|| -> Result<(), String> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staging)
                .map_err(err)?;
            file.write_all(serialized.as_bytes()).map_err(err)?;
            file.sync_all().map_err(err)?;
            // No DB row exists for this digest. An old final file can only be an
            // orphan from a crashed pre-transaction import, so replace atomically.
            fs::rename(&staging, &path).map_err(err)?;
            Ok(())
        })();
        if publish.is_err() {
            let _ = fs::remove_file(&staging);
        }
        publish?;
        let repo = text(&report["repository"], "id");
        let review = text(&report, "reportId");
        let inherited:Option<String>=self.db.query_row("SELECT reports.checkout_id FROM reviews JOIN reports ON reports.handle=reviews.active_handle WHERE reviews.repo_id=?1 AND reviews.report_id=?2",params![repo,review],|r|r.get(0)).optional().map_err(err)?.flatten();
        let inherited = preferred.map(|p| p.checkout_id.clone()).or(inherited);
        let mapping = inherited.and_then(|id| {
            let checkout = self.repository(&id).ok()?;
            let root = Path::new(&checkout.display_path);
            if git::repository_root(root).ok()?.to_str() != Some(checkout.display_path.as_str()) {
                return None;
            }
            if let Some(remote) = git::remote_identity(root) {
                if remote != repo {
                    return None;
                }
            } else if !repo.starts_with("local:") {
                return None;
            }
            git::verify(root, &report).ok()?;
            Some((id, git::code_identity(root, &report).ok()?.to_string()))
        });
        let tx = self.db.transaction().map_err(err)?;
        tx.execute("INSERT INTO reports(handle,digest,repo_id,report_id,body,imported_at,checkout_id,code_identity) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![handle,hash,repo,review,serialized,now(),mapping.as_ref().map(|m|&m.0),mapping.as_ref().map(|m|&m.1)]).map_err(err)?;
        if activate {
            tx.execute("INSERT INTO reviews(repo_id,report_id,active_handle,revision) VALUES(?1,?2,?3,0) ON CONFLICT(repo_id,report_id) DO UPDATE SET active_handle=excluded.active_handle,revision=reviews.revision+1",params![repo,review,handle]).map_err(err)?;
        } else {
            // Detection adds immutable snapshots without replacing the one being reviewed.
            tx.execute("INSERT INTO reviews(repo_id,report_id,active_handle,revision) VALUES(?1,?2,?3,0) ON CONFLICT(repo_id,report_id) DO NOTHING",params![repo,review,handle]).map_err(err)?;
        }
        if let Some((id, _)) = &mapping {
            tx.execute(
                "UPDATE checkouts SET repository_id=?2 WHERE id=?1",
                params![id, repo],
            )
            .map_err(err)?;
            tx.execute("DELETE FROM projects WHERE repository_id NOT IN (SELECT repository_id FROM checkouts) AND repository_id NOT IN (SELECT repo_id FROM reports)", []).map_err(err)?;
        }
        tx.execute("INSERT INTO projects(repository_id,name) VALUES(?1,?2) ON CONFLICT(repository_id) DO UPDATE SET name=excluded.name", params![repo, text(&report["repository"], "name")]).map_err(err)?;
        tx.commit().map_err(err)?;
        self.loaded(&handle)
    }

    pub(crate) fn record(&self, handle: &str) -> Result<Record, String> {
        let row: Option<(String, String, Option<String>)> = self
            .db
            .query_row(
                "SELECT digest,body,checkout_id FROM reports WHERE handle=?1",
                [handle],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(err)?;
        let (hash, body, checkout_id) =
            row.ok_or("UNKNOWN_REPORT: select or import a report first")?;
        let report: Value =
            serde_json::from_str(&body).map_err(|_| "CORRUPT_STATE: report JSON is invalid")?;
        if digest(&report) != hash {
            return Err("CORRUPT_STATE: report digest mismatch".into());
        }
        Ok(Record {
            handle: handle.into(),
            digest: hash,
            report,
            checkout_id,
        })
    }

    pub fn list(&self) -> Result<Vec<ReportSummary>, String> {
        let mut stmt = self
            .db
            .prepare("SELECT handle,body FROM reports ORDER BY imported_at DESC")
            .map_err(err)?;
        let mut result = Vec::new();
        for row in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
        {
            let (handle, body) = row.map_err(err)?;
            let r: Value = serde_json::from_str(&body).map_err(err)?;
            result.push(ReportSummary {
                project_id: text(&r["repository"], "id").into(),
                report_id: text(&r, "reportId").into(),
                pr_number: r["pullRequest"]["number"].as_u64(),
                pr_url: r["pullRequest"]["url"].as_str().map(str::to_string),
                handle,
                title: text(&r, "title").into(),
                repository_name: text(&r["repository"], "name").into(),
                generated_at: text(&r, "generatedAt").into(),
                head: text(&r["comparison"]["head"], "oid").into(),
            });
        }
        Ok(result)
    }

    pub fn open(&mut self, handle: &str) -> Result<LoadedReport, String> {
        let record = self.record(handle)?;
        validation::validate(&record.report)?;
        let repo = text(&record.report["repository"], "id");
        let review = text(&record.report, "reportId");
        self.db.execute("UPDATE reviews SET active_handle=?3,revision=revision+1 WHERE repo_id=?1 AND report_id=?2 AND active_handle<>?3",params![repo,review,handle]).map_err(err)?;
        self.loaded(handle)
    }

    pub(crate) fn repository(&self, id: &str) -> Result<RepositoryInfo, String> {
        self.db
            .query_row(
                "SELECT repository_id,root FROM checkouts WHERE id=?1",
                [id],
                |r| {
                    Ok(RepositoryInfo {
                        checkout_id: id.into(),
                        repository_id: r.get(0)?,
                        display_path: r.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(err)?
            .ok_or("UNKNOWN_CHECKOUT: choose a repository first".into())
    }

    pub fn choose(&mut self, path: &Path) -> Result<RepositoryInfo, String> {
        let path = selected_local_path(path, true)?;
        let root = git::repository_root(&path)?;
        let root = root
            .to_str()
            .ok_or("Unsupported non-UTF-8 repository path")?;
        let existing: Option<String> = self
            .db
            .query_row("SELECT id FROM checkouts WHERE root=?1", [root], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if let Some(id) = existing {
            return self.repository(&id);
        }
        let id = Uuid::new_v4().to_string();
        let repository_id = git::remote_identity(Path::new(root))
            .unwrap_or_else(|| format!("local:{}", Uuid::new_v4()));
        self.db
            .execute(
                "INSERT INTO checkouts(id,repository_id,root) VALUES(?1,?2,?3)",
                params![id, repository_id, root],
            )
            .map_err(err)?;
        self.db.execute("INSERT INTO projects(repository_id,name) VALUES(?1,?2) ON CONFLICT(repository_id) DO NOTHING", params![repository_id, Path::new(root).file_name().unwrap_or_default().to_string_lossy()]).map_err(err)?;
        self.repository(&id)
    }

    pub fn attach(&mut self, handle: &str, checkout_id: &str) -> Result<LoadedReport, String> {
        let record = self.record(handle)?;
        let checkout = self.repository(checkout_id)?;
        let root = Path::new(&checkout.display_path);
        let root = git::repository_root(root)?;
        if root.to_str() != Some(checkout.display_path.as_str()) {
            return Err("REPOSITORY_MOVED: choose the current root again".into());
        }
        let expected = text(&record.report["repository"], "id");
        if let Some(remote) = git::remote_identity(&root) {
            if remote != expected {
                return Err(format!("REPOSITORY_MISMATCH: this checkout identifies as {remote}, report expects {expected}"));
            }
        } else if !expected.starts_with("local:") {
            return Err("REPOSITORY_MISMATCH: checkout has no verifiable origin identity; report expects a remote repository".into());
        }
        git::verify(&root, &record.report)?;
        let code = git::code_identity(&root, &record.report)?;
        let tx = self.db.transaction().map_err(err)?;
        // A local identity is explicitly adopted only after both exact commits
        // and the inventory/evidence have been verified in the chosen folder.
        tx.execute(
            "UPDATE checkouts SET repository_id=?2 WHERE id=?1",
            params![checkout_id, expected],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE reports SET checkout_id=?2,code_identity=?3 WHERE handle=?1",
            params![handle, checkout_id, code.to_string()],
        )
        .map_err(err)?;
        tx.execute(
            "UPDATE reviews SET revision=revision+1 WHERE repo_id=?1 AND report_id=?2",
            params![expected, text(&record.report, "reportId")],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM projects WHERE repository_id NOT IN (SELECT repository_id FROM checkouts) AND repository_id NOT IN (SELECT repo_id FROM reports)", []).map_err(err)?;
        tx.commit().map_err(err)?;
        self.loaded(handle)
    }

    fn loaded(&self, handle: &str) -> Result<LoadedReport, String> {
        let r = self.record(handle)?;
        let repository = r
            .checkout_id
            .as_deref()
            .map(|id| self.repository(id))
            .transpose()?;
        let state = self.state(&r)?;
        Ok(LoadedReport {
            handle: r.handle,
            digest: r.digest,
            report: r.report,
            state,
            repository,
        })
    }

    fn fingerprints(&self, r: &Record) -> Result<BTreeMap<String, String>, String> {
        let code: Option<String> = self
            .db
            .query_row(
                "SELECT code_identity FROM reports WHERE handle=?1",
                [&r.handle],
                |row| row.get(0),
            )
            .map_err(err)?;
        let code: Value = code
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(err)?
            .unwrap_or(Value::Null);
        let report = &r.report;
        let identity = |id: &str| {
            if code.is_null() {
                json!({"unverifiedComparison":report["comparison"],"file":git::file(report,id)})
            } else {
                code[id].clone()
            }
        };
        let mut result = BTreeMap::new();
        for f in items(report, "files") {
            let round = items(report, "rounds")
                .iter()
                .find(|x| x["id"] == f["roundId"]);
            let guidance =
                json!({"version":1,"entity":f,"round":round,"code":identity(text(f,"id"))});
            result.insert(format!("file:{}", text(f, "id")), digest(&guidance));
        }
        for flow in items(report, "flows") {
            let files: Vec<_> = items(flow, "fileIds")
                .iter()
                .filter_map(Value::as_str)
                .map(identity)
                .collect();
            let evidence: Vec<_> = items(report, "evidence")
                .iter()
                .filter(|e| items(flow, "fileIds").contains(&e["fileId"]))
                .collect();
            result.insert(
                format!("flow:{}", text(flow, "id")),
                digest(&json!({"version":1,"entity":flow,"code":files,"evidence":evidence})),
            );
        }
        for finding in items(report, "findings") {
            let mut evidence_ids = vec![text(finding, "primaryEvidenceId")];
            for step in items(finding, "trace") {
                evidence_ids.extend(items(step, "evidenceIds").iter().filter_map(Value::as_str));
            }
            let evidence: Vec<_> = items(report, "evidence")
                .iter()
                .filter(|e| evidence_ids.contains(&text(e, "id")))
                .map(|e| json!({"anchor":e,"code":identity(text(e,"fileId"))}))
                .collect();
            let flows: Vec<_> = items(finding, "flowIds")
                .iter()
                .filter_map(Value::as_str)
                .map(|id| result.get(&format!("flow:{id}")).cloned())
                .collect();
            result.insert(format!("finding:{}",text(finding,"id")),digest(&json!({"version":1,"entity":finding,"evidence":evidence,"flowFingerprints":flows})));
        }
        Ok(result)
    }

    fn state(&self, r: &Record) -> Result<ReviewState, String> {
        let repo = text(&r.report["repository"], "id");
        let review = text(&r.report, "reportId");
        let (revision, checkpoint): (u64, Option<String>) = self
            .db
            .query_row(
                "SELECT revision,checkpoint FROM reviews WHERE repo_id=?1 AND report_id=?2",
                params![repo, review],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(err)?;
        let mut state = ReviewState {
            revision,
            checkpoint: checkpoint
                .map(|s| serde_json::from_str::<Value>(&s).and_then(serde_json::from_value))
                .transpose()
                .map_err(err)?,
            ..ReviewState::default()
        };
        let fingerprints = self.fingerprints(r)?;
        let mut stmt = self
            .db
            .prepare("SELECT kind,entity_id,body FROM decisions WHERE repo_id=?1 AND report_id=?2")
            .map_err(err)?;
        for row in stmt
            .query_map(params![repo, review], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
        {
            let (kind, id, body) = row.map_err(err)?;
            let Some(current) = fingerprints.get(&format!("{kind}:{id}")) else {
                continue;
            };
            let mut decision: Decision = serde_json::from_str(&body).map_err(err)?;
            decision.stale = &decision.fingerprint != current;
            match kind.as_str() {
                "file" => {
                    state.files.insert(id, decision);
                }
                "flow" => {
                    state.flows.insert(id, decision);
                }
                "finding" => {
                    state.findings.insert(id, decision);
                }
                _ => return Err("CORRUPT_STATE: unknown decision kind".into()),
            }
        }
        Ok(state)
    }

    pub fn decide(
        &mut self,
        handle: &str,
        kind: &str,
        id: &str,
        decision: Option<&str>,
        expected: u64,
        note: Option<&str>,
    ) -> Result<ReviewState, String> {
        let r = self.record(handle)?;
        let allowed = match kind {
            "file" | "flow" => {
                decision.is_none() || matches!(decision, Some("reviewed" | "unreviewed"))
            }
            "finding" => {
                decision.is_none()
                    || matches!(
                        decision,
                        Some("confirmed" | "fixed" | "disputed" | "needs-test")
                    )
            }
            _ => false,
        };
        if !allowed {
            return Err("INVALID_DECISION: value is not valid for the entity kind".into());
        }
        if note.map(|n| n.len() > 16000).unwrap_or(false) {
            return Err("LIMIT_EXCEEDED: note is longer than 16000 bytes".into());
        }
        let fingerprints = self.fingerprints(&r)?;
        let fingerprint = fingerprints
            .get(&format!("{kind}:{id}"))
            .ok_or("UNKNOWN_ENTITY: entity is not in this report")?;
        let repo = text(&r.report["repository"], "id");
        let review = text(&r.report, "reportId");
        let tx = self.db.transaction().map_err(err)?;
        let (active, revision): (String, u64) = tx
            .query_row(
                "SELECT active_handle,revision FROM reviews WHERE repo_id=?1 AND report_id=?2",
                params![repo, review],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(err)?;
        if active != handle {
            return Err("STALE_GENERATION: reopen this report before changing its progress".into());
        }
        if revision != expected {
            return Err(
                "STATE_CONFLICT: progress changed in another window; reload the report and retry"
                    .into(),
            );
        }
        tx.execute("INSERT INTO history(repo_id,report_id,kind,entity_id,previous_body,changed_at) SELECT repo_id,report_id,kind,entity_id,body,?5 FROM decisions WHERE repo_id=?1 AND report_id=?2 AND kind=?3 AND entity_id=?4",params![repo,review,kind,id,now()]).map_err(err)?;
        if let Some(decision) = decision.filter(|d| *d != "unreviewed") {
            let body = serde_json::to_string(&Decision {
                decision: decision.into(),
                fingerprint: fingerprint.clone(),
                updated_at: now(),
                note: note.map(str::to_string),
                stale: false,
            })
            .map_err(err)?;
            tx.execute("INSERT INTO decisions(repo_id,report_id,kind,entity_id,body) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(repo_id,report_id,kind,entity_id) DO UPDATE SET body=excluded.body",params![repo,review,kind,id,body]).map_err(err)?;
        } else {
            tx.execute("DELETE FROM decisions WHERE repo_id=?1 AND report_id=?2 AND kind=?3 AND entity_id=?4",params![repo,review,kind,id]).map_err(err)?;
        }
        tx.execute(
            "UPDATE reviews SET revision=revision+1 WHERE repo_id=?1 AND report_id=?2",
            params![repo, review],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        self.state(&r)
    }

    pub fn checkpoint(&mut self, handle: &str, expected: u64) -> Result<ReviewState, String> {
        let r = self.record(handle)?;
        let fingerprints = self.fingerprints(&r)?;
        let repo = text(&r.report["repository"], "id");
        let review = text(&r.report, "reportId");
        let tx = self.db.transaction().map_err(err)?;
        let (active, revision): (String, u64) = tx
            .query_row(
                "SELECT active_handle,revision FROM reviews WHERE repo_id=?1 AND report_id=?2",
                params![repo, review],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(err)?;
        if active != handle {
            return Err("STALE_GENERATION: reopen this report before saving a checkpoint".into());
        }
        if revision != expected {
            return Err("STATE_CONFLICT: progress changed; reload and retry".into());
        }
        let saved = json!({"head":r.report["comparison"]["head"]["oid"],"savedAt":now(),"digest":r.digest,"base":r.report["comparison"]["base"]["oid"],"files":items(&r.report,"files"),"fingerprints":fingerprints});
        tx.execute("INSERT INTO history(repo_id,report_id,kind,entity_id,previous_body,changed_at) SELECT repo_id,report_id,'checkpoint','checkpoint',checkpoint,?3 FROM reviews WHERE repo_id=?1 AND report_id=?2 AND checkpoint IS NOT NULL",params![repo,review,now()]).map_err(err)?;
        tx.execute("UPDATE reviews SET checkpoint=?3,revision=revision+1 WHERE repo_id=?1 AND report_id=?2",params![repo,review,saved.to_string()]).map_err(err)?;
        tx.commit().map_err(err)?;
        self.state(&r)
    }

    /// Compare immutable snapshots without opening either one or changing the
    /// active generation/revision. A checkpoint belongs to a repository/report
    /// lineage, never merely a PR number or a matching commit.
    pub fn review_changes(&self, handle: &str) -> Result<ReviewChanges, String> {
        let current = self.record(handle)?;
        let state = self.state(&current)?;
        let Some(checkpoint) = state.checkpoint.as_ref() else {
            return Ok(ReviewChanges {
                status: "no-checkpoint".into(),
                ..ReviewChanges::default()
            });
        };
        let baseline_handle: Option<String> = self
            .db
            .query_row(
                "SELECT handle FROM reports WHERE digest=?1 AND repo_id=?2 AND report_id=?3",
                params![
                    checkpoint.digest,
                    text(&current.report["repository"], "id"),
                    text(&current.report, "reportId")
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        let unavailable = |reason: &str| ReviewChanges {
            status: "unavailable".into(),
            reason: Some(reason.into()),
            ..ReviewChanges::default()
        };
        let Some(baseline_handle) = baseline_handle else {
            return Ok(unavailable(
                "The checkpoint snapshot is not available in this report's project and history.",
            ));
        };
        let baseline = match self.record(&baseline_handle) {
            Ok(value) => value,
            Err(_) => {
                return Ok(unavailable(
                    "The checkpoint snapshot could not be verified.",
                ))
            }
        };
        if text(&baseline.report["comparison"]["head"], "oid") != checkpoint.head {
            return Ok(unavailable(
                "The checkpoint commit does not match its saved snapshot.",
            ));
        }
        // Use the verified blob identities stored with each snapshot. Without
        // them fingerprints include the exact commit pair, so a new commit is
        // conservatively reported as changed rather than presumed unchanged.
        let before = self.fingerprints(&baseline)?;
        let after = self.fingerprints(&current)?;
        let changes = |kind: &str, collection: &str| {
            let mut result = ReviewEntityChanges::default();
            let entity = |value: &Value| ReviewChangeEntity {
                id: text(value, "id").into(),
                title: text(value, if kind == "file" { "path" } else { "title" }).into(),
                path: (kind == "file").then(|| text(value, "path").to_string()),
            };
            for value in items(&current.report, collection) {
                let key = format!("{kind}:{}", text(value, "id"));
                match before.get(&key) {
                    None => result.added.push(entity(value)),
                    Some(previous) if Some(previous) == after.get(&key) => result.unchanged += 1,
                    Some(_) => result.changed.push(entity(value)),
                }
            }
            for value in items(&baseline.report, collection) {
                let key = format!("{kind}:{}", text(value, "id"));
                if !after.contains_key(&key) {
                    result.removed.push(entity(value));
                }
            }
            result
        };
        let unchanged_reviewed_file_count = state
            .files
            .iter()
            .filter(|(id, decision)| {
                let key = format!("file:{id}");
                decision.decision == "reviewed"
                    && !decision.stale
                    && before.contains_key(&key)
                    && before.get(&key) == after.get(&key)
            })
            .count();
        Ok(ReviewChanges {
            status: if current.digest == baseline.digest {
                "current"
            } else {
                "compared"
            }
            .into(),
            baseline: Some(ReviewBaseline {
                handle: baseline_handle,
                head: checkpoint.head.clone(),
                digest: checkpoint.digest.clone(),
                saved_at: checkpoint.saved_at.clone(),
            }),
            reason: None,
            files: changes("file", "files"),
            flows: changes("flow", "flows"),
            findings: changes("finding", "findings"),
            unchanged_reviewed_file_count,
        })
    }

    pub fn diff(&self, handle: &str, id: &str) -> Result<FileDiff, String> {
        let r = self.record(handle)?;
        if r.report["provenance"]["mode"] == "synthetic-example" {
            let example: Value = serde_json::from_str(EXAMPLE).map_err(err)?;
            if r.digest != digest(&example) {
                return Err("SYNTHETIC_REPORT: this example has no bundled source fixture".into());
            }
            let sources: Value =
                serde_json::from_str(include_str!("../../resources/example-sources.json"))
                    .map_err(err)?;
            let f = git::file(&r.report, id).ok_or("UNKNOWN_FILE")?;
            let make = |side: &str| -> Result<DiffSide, String> {
                let source = sources[id][side]
                    .as_str()
                    .ok_or("Synthetic source fixture is unavailable")?;
                Ok(DiffSide {
                    path: git::side_path(f, side).into(),
                    oid: text(&r.report["comparison"][side], "oid").into(),
                    blob_oid: None,
                    text: Some(source.into()),
                    kind: "text".into(),
                    reason: Some("Synthetic demonstration source, not a Git snapshot".into()),
                })
            };
            return Ok(git::build_diff(id, make("base")?, make("head")?));
        }
        let id_checkout = r.checkout_id.ok_or(
            "UNMAPPED_REPOSITORY: connect this report to its local repository to read exact diffs",
        )?;
        let checkout = self.repository(&id_checkout)?;
        git::read_diff(Path::new(&checkout.display_path), &r.report, id)
    }

    pub fn file_source(
        &self,
        handle: &str,
        file_id: &str,
        target: &str,
        side: Option<&str>,
    ) -> Result<(String, PathBuf, u64), String> {
        let r = self.record(handle)?;
        match target {
            "github" => git::github_file_url(&r.report, file_id, side),
            "vscode" => {
                let checkout = self.repository(
                    r.checkout_id
                        .as_deref()
                        .ok_or("UNMAPPED_REPOSITORY: connect a local repository first")?,
                )?;
                git::file_source_url(Path::new(&checkout.display_path), &r.report, file_id, side)
            }
            _ => Err("INVALID_TARGET: choose github or vscode".into()),
        }
    }

    pub fn source(
        &self,
        handle: &str,
        evidence_id: &str,
    ) -> Result<(String, PathBuf, u64), String> {
        let r = self.record(handle)?;
        let checkout = self.repository(
            r.checkout_id
                .as_deref()
                .ok_or("UNMAPPED_REPOSITORY: connect a local repository first")?,
        )?;
        git::source_url(Path::new(&checkout.display_path), &r.report, evidence_id)
    }
}
