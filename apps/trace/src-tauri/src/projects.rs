use crate::{
    store::{digest, Store, MAX_REPORT_BYTES},
    types::*,
};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::{
    fd::{AsRawFd, FromRawFd},
    unix::fs::OpenOptionsExt,
};
use std::{fs, io::Read, path::Path};

const MAX_SCAN_ENTRIES: usize = 1024;
const MAX_SCAN_FILES: u64 = 256;
const MAX_SCAN_BYTES: usize = 64 * 1024 * 1024;

fn err(e: impl std::fmt::Display) -> String {
    format!("STORAGE_ERROR: {e}")
}

impl Store {
    /// Migration reads only the existing private database, never report-supplied paths.
    pub(crate) fn migrate_projects(&self) -> Result<(), String> {
        for report in self.list()? {
            self.db.execute("INSERT INTO projects(repository_id,name) VALUES(?1,?2) ON CONFLICT(repository_id) DO NOTHING", params![report.project_id, report.repository_name]).map_err(err)?;
        }
        let mut stmt = self
            .db
            .prepare("SELECT repository_id,root FROM checkouts")
            .map_err(err)?;
        for row in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
        {
            let (id, root) = row.map_err(err)?;
            let name = Path::new(&root)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            self.db.execute("INSERT INTO projects(repository_id,name) VALUES(?1,?2) ON CONFLICT(repository_id) DO NOTHING", params![id,name]).map_err(err)?;
        }
        Ok(())
    }

    pub fn projects(&self) -> Result<Vec<ProjectSummary>, String> {
        let mut result = Vec::new();
        let mut stmt = self.db.prepare("SELECT repository_id,name,(SELECT COUNT(*) FROM reports WHERE repo_id=repository_id) FROM projects ORDER BY name COLLATE NOCASE").map_err(err)?;
        for row in stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, u64>(2)?,
                ))
            })
            .map_err(err)?
        {
            let (id, name, count) = row.map_err(err)?;
            let mut checkouts = self
                .db
                .prepare("SELECT id FROM checkouts WHERE repository_id=?1 ORDER BY root")
                .map_err(err)?;
            let repositories = checkouts
                .query_map([&id], |r| r.get::<_, String>(0))
                .map_err(err)?
                .map(|row| self.repository(&row.map_err(err)?))
                .collect::<Result<Vec<_>, String>>()?;
            result.push(ProjectSummary {
                id: id.clone(),
                name,
                repository_id: id,
                repositories,
                report_count: count,
            });
        }
        Ok(result)
    }

    pub fn add_project(&mut self, path: &Path) -> Result<ProjectSummary, String> {
        let repo = self.choose(path)?;
        self.projects()?
            .into_iter()
            .find(|p| p.id == repo.repository_id)
            .ok_or("PROJECT_UNAVAILABLE: project registration did not persist".into())
    }

    pub fn discover(&mut self) -> Result<DiscoveryResult, String> {
        let projects = self.projects()?;
        let mut result = DiscoveryResult::default();
        let mut bytes_read = 0;
        let mut entries_read = 0;
        for project in projects {
            for checkout in project.repositories {
                let path = Path::new(&checkout.display_path).join(".trace");
                let mut issue = |message: String, path: &Path| {
                    result.issues.push(DiscoveryIssue {
                        project_id: project.id.clone(),
                        path: path.to_string_lossy().into(),
                        message,
                    })
                };
                let directory = match scan_directory(&path) {
                    Ok(Some(directory)) => directory,
                    Ok(None) => continue,
                    Err(e) => {
                        issue(e, &path);
                        continue;
                    }
                };
                let entries = match fs::read_dir(&path) {
                    Ok(entries) => entries,
                    Err(e) => {
                        issue(format!("DISCOVERY_ERROR: {e}"), &path);
                        continue;
                    }
                };
                for entry in entries {
                    entries_read += 1;
                    if entries_read > MAX_SCAN_ENTRIES
                        || result.scanned >= MAX_SCAN_FILES
                        || bytes_read >= MAX_SCAN_BYTES
                    {
                        result.issues.push(DiscoveryIssue { project_id: project.id.clone(), path: path.to_string_lossy().into(), message: "DISCOVERY_LIMIT: scan stopped at 1024 entries, 256 reports or 64 MiB; import remaining reports individually".into() });
                        return Ok(result);
                    }
                    let entry = match entry {
                        Ok(e) => e,
                        Err(e) => {
                            result.issues.push(DiscoveryIssue {
                                project_id: project.id.clone(),
                                path: path.to_string_lossy().into(),
                                message: e.to_string(),
                            });
                            continue;
                        }
                    };
                    let name = entry.file_name();
                    if !name.to_string_lossy().ends_with(".trace.json") {
                        continue;
                    }
                    result.scanned += 1;
                    let source_path = path.join(&name);
                    let process = (|| -> Result<bool, String> {
                        let contents = read_candidate(
                            &directory,
                            &source_path,
                            &name,
                            (MAX_SCAN_BYTES - bytes_read).min(MAX_REPORT_BYTES),
                        )?;
                        bytes_read += contents.len();
                        let source_hash = format!("{:x}", Sha256::digest(&contents));
                        let source_key = source_path
                            .to_str()
                            .ok_or("UNSUPPORTED_PATH: report path is not UTF-8")?;
                        let cached: Option<String> = self
                            .db
                            .query_row(
                                "SELECT content_hash FROM discovery_sources WHERE path=?1",
                                [source_key],
                                |r| r.get(0),
                            )
                            .optional()
                            .map_err(err)?;
                        if cached.as_deref() == Some(&source_hash) {
                            return Ok(false);
                        }
                        let report: Value = serde_json::from_slice(&contents)
                            .map_err(|e| format!("INVALID_REPORT: {e}"))?;
                        let report_repo = text(&report["repository"], "id");
                        if report_repo != checkout.repository_id
                            && !(report_repo.starts_with("local:")
                                && checkout.repository_id.starts_with("local:"))
                        {
                            return Err("REPOSITORY_MISMATCH: this report belongs to another project; import it explicitly".into());
                        }
                        let hash = digest(&report);
                        let existing: Option<String> = self
                            .db
                            .query_row("SELECT handle FROM reports WHERE digest=?1", [&hash], |r| {
                                r.get(0)
                            })
                            .optional()
                            .map_err(err)?;
                        let imported = existing.is_none();
                        let loaded = self.import_value_mode(report, false, Some(&checkout))?;
                        self.db.execute("INSERT INTO discovery_sources(path,content_hash,handle) VALUES(?1,?2,?3) ON CONFLICT(path) DO UPDATE SET content_hash=excluded.content_hash,handle=excluded.handle", params![source_key,source_hash,loaded.handle]).map_err(err)?;
                        Ok(imported)
                    })();
                    match process {
                        Ok(true) => result.imported += 1,
                        Ok(false) => result.skipped += 1,
                        Err(message) => result.issues.push(DiscoveryIssue {
                            project_id: project.id.clone(),
                            path: source_path.to_string_lossy().into(),
                            message,
                        }),
                    }
                }
            }
        }
        Ok(result)
    }
}

fn scan_directory(path: &Path) -> Result<Option<fs::File>, String> {
    let root = path.parent().ok_or("INVALID_PATH: missing project root")?;
    // Registered paths were canonical when chosen. Do not follow replacements.
    if root
        .canonicalize()
        .map_err(|e| format!("DISCOVERY_ERROR: {e}"))?
        != root
    {
        return Err("UNSAFE_PATH: project root moved or is now a symbolic link".into());
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("DISCOVERY_ERROR: {e}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("UNSAFE_PATH: .trace must be a real directory, not a symbolic link".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    options
        .open(path)
        .map(Some)
        .map_err(|e| format!("DISCOVERY_ERROR: {e}"))
}

fn read_candidate(
    directory: &fs::File,
    path: &Path,
    name: &std::ffi::OsStr,
    limit: usize,
) -> Result<Vec<u8>, String> {
    #[cfg(unix)]
    let file = {
        use std::os::unix::ffi::OsStrExt;
        let name = std::ffi::CString::new(name.as_bytes()).map_err(|_| "INVALID_PATH")?;
        // Open relative to the already validated directory descriptor. A rename
        // or symlink swap cannot redirect this read outside the selected folder.
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(format!(
                "UNSAFE_REPORT: {}",
                std::io::Error::last_os_error()
            ));
        }
        unsafe { fs::File::from_raw_fd(fd) }
    };
    #[cfg(not(unix))]
    let file = {
        let _ = (directory, name);
        if fs::symlink_metadata(path)
            .map_err(err)?
            .file_type()
            .is_symlink()
        {
            return Err("UNSAFE_REPORT: symbolic links are not followed".into());
        }
        fs::File::open(path).map_err(err)?
    };
    let _ = path;
    let metadata = file.metadata().map_err(err)?;
    if !metadata.is_file() {
        return Err("UNSAFE_REPORT: discovery only reads regular report files".into());
    }
    if metadata.len() > limit as u64 {
        return Err("LIMIT_EXCEEDED: report exceeds 20 MiB or the remaining scan budget".into());
    }
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > limit {
        return Err("LIMIT_EXCEEDED: report grew beyond scan budget".into());
    }
    Ok(bytes)
}
