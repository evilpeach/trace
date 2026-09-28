mod agents;
mod stacks;
mod git;
mod projects;
mod requests;
mod store;
#[cfg(test)]
mod tests;
mod types;
mod validation;

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use types::*;

type NativeState = Arc<Mutex<store::Store>>;

#[tauri::command]
async fn discover_review_stack(checkout_id: String, pr_url: String, state: State<'_, NativeState>) -> Result<stacks::ReviewStack, String> {
    access(state.inner().clone(), move |s| s.discover_review_stack(&checkout_id, &pr_url)).await
}
#[tauri::command]
async fn resolve_review_stack(checkout_id: String, urls: Vec<String>, previous_report_handle: Option<String>, state: State<'_, NativeState>) -> Result<Vec<ReviewComparison>, String> {
    access(state.inner().clone(), move |s| s.resolve_review_stack(&checkout_id, urls, previous_report_handle)).await
}
#[tauri::command]
async fn get_review_agents(state: State<'_, NativeState>) -> Result<Vec<agents::ReviewAgent>, String> {
    access(state.inner().clone(), |s| s.review_agents()).await
}
#[tauri::command]
async fn launch_review_agent(ids: Vec<String>, agent: String, options: Option<agents::AgentLaunchOptions>, state: State<'_, NativeState>) -> Result<agents::AgentLaunch, String> {
    access(state.inner().clone(), move |s| s.launch_review_agent(ids, agent, options)).await
}
#[tauri::command]
async fn list_review_agent_launches(state: State<'_, NativeState>) -> Result<Vec<agents::AgentLaunch>, String> {
    access(state.inner().clone(), |s| s.review_agent_launches()).await
}

#[tauri::command]
async fn get_review_setup(
    checkout_id: String,
    state: State<'_, NativeState>,
) -> Result<ReviewSetup, String> {
    access(state.inner().clone(), move |s| s.review_setup(&checkout_id)).await
}
#[tauri::command]
async fn resolve_review_comparison(
    input: ResolveReviewInput,
    state: State<'_, NativeState>,
) -> Result<ReviewComparison, String> {
    access(state.inner().clone(), move |s| s.resolve_review(input)).await
}
#[tauri::command]
async fn prepare_review_request(
    input: PrepareReviewInput,
    state: State<'_, NativeState>,
) -> Result<ReviewRequest, String> {
    access(state.inner().clone(), move |s| s.prepare_review(input)).await
}
#[tauri::command]
async fn list_review_requests(state: State<'_, NativeState>) -> Result<Vec<ReviewRequest>, String> {
    access(state.inner().clone(), |s| s.review_requests()).await
}
#[tauri::command]
async fn check_review_request(
    id: String,
    state: State<'_, NativeState>,
) -> Result<ReviewRequest, String> {
    access(state.inner().clone(), move |s| s.check_review(&id)).await
}
#[tauri::command]
async fn cancel_review_request(
    id: String,
    state: State<'_, NativeState>,
) -> Result<ReviewRequest, String> {
    access(state.inner().clone(), move |s| s.cancel_review(&id)).await
}
#[tauri::command]
async fn import_review_request(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
) -> Result<Option<ReviewRequest>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import the report for this review request")
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    access(state.inner().clone(), move |s| {
        s.import_review_path(&id, &path).map(Some)
    })
    .await
}
#[tauri::command]
async fn import_review_request_path(
    id: String,
    path: String,
    state: State<'_, NativeState>,
) -> Result<ReviewRequest, String> {
    access(state.inner().clone(), move |s| {
        s.import_review_path(&id, std::path::Path::new(&path))
    })
    .await
}

async fn access<T, F>(state: NativeState, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut store::Store) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = state
            .lock()
            .map_err(|_| "STORAGE_ERROR: state service is unavailable")?;
        f(&mut store)
    })
    .await
    .map_err(|e| format!("NATIVE_ERROR: {e}"))?
}

#[tauri::command]
async fn list_reports(state: State<'_, NativeState>) -> Result<Vec<ReportSummary>, String> {
    access(state.inner().clone(), |s| s.list()).await
}

#[tauri::command]
async fn list_projects(state: State<'_, NativeState>) -> Result<Vec<ProjectSummary>, String> {
    access(state.inner().clone(), |s| s.projects()).await
}

#[tauri::command]
async fn discover_reports(state: State<'_, NativeState>) -> Result<DiscoveryResult, String> {
    access(state.inner().clone(), |s| s.discover()).await
}

#[tauri::command]
async fn add_project(
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
) -> Result<Option<ProjectSummary>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Add a Trace project")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    access(state.inner().clone(), move |s| {
        s.add_project(&path).map(Some)
    })
    .await
}

#[tauri::command]
async fn add_project_path(
    path: String,
    state: State<'_, NativeState>,
) -> Result<ProjectSummary, String> {
    access(state.inner().clone(), move |s| {
        s.add_project(std::path::Path::new(&path))
    })
    .await
}

#[tauri::command]
async fn import_report(
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
) -> Result<Option<LoadedReport>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Import Trace report")
            // Keep the native picker unfiltered: platform type filtering can
            // prevent file selection. Import still enforces JSON, schema and size.
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    access(state.inner().clone(), move |s| {
        s.import_path(&path).map(Some)
    })
    .await
}

#[tauri::command]
async fn import_report_path(
    path: String,
    state: State<'_, NativeState>,
) -> Result<LoadedReport, String> {
    access(state.inner().clone(), move |s| {
        s.import_path(std::path::Path::new(&path))
    })
    .await
}

#[tauri::command]
async fn open_report(
    handle: String,
    state: State<'_, NativeState>,
) -> Result<LoadedReport, String> {
    access(state.inner().clone(), move |s| s.open(&handle)).await
}

#[tauri::command]
async fn load_example(state: State<'_, NativeState>) -> Result<LoadedReport, String> {
    access(state.inner().clone(), |s| {
        s.import_value(serde_json::from_str(store::EXAMPLE).map_err(|e| e.to_string())?)
    })
    .await
}

#[tauri::command]
async fn choose_repository(
    app: tauri::AppHandle,
    state: State<'_, NativeState>,
    selection: Option<String>,
) -> Result<Option<RepositoryInfo>, String> {
    let from_file = match selection.as_deref() {
        None | Some("folder") => false,
        Some("file") => true,
        Some(_) => return Err("INVALID_SELECTION: choose folder or file".into()),
    };
    let selected = tauri::async_runtime::spawn_blocking(move || {
        if from_file {
            // A native file selection provides the same explicit local choice
            // when the platform folder picker cannot enable its Open action.
            app.dialog()
                .file()
                .set_title("Choose any file in the reviewed repository")
                .blocking_pick_file()
        } else {
            app.dialog()
                .file()
                .set_title("Choose reviewed repository")
                .blocking_pick_folder()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    let path = if from_file {
        if !path.is_file() {
            return Err("INVALID_SELECTION: select a file inside the reviewed repository".into());
        }
        path.parent()
            .ok_or("INVALID_SELECTION: selected file has no parent directory")?
            .to_path_buf()
    } else {
        path
    };
    access(state.inner().clone(), move |s| s.choose(&path).map(Some)).await
}

#[tauri::command]
async fn choose_repository_path(
    path: String,
    state: State<'_, NativeState>,
) -> Result<RepositoryInfo, String> {
    access(state.inner().clone(), move |s| {
        s.choose(std::path::Path::new(&path))
    })
    .await
}

#[tauri::command]
async fn attach_repository(
    report_handle: String,
    checkout_id: String,
    state: State<'_, NativeState>,
) -> Result<LoadedReport, String> {
    access(state.inner().clone(), move |s| {
        s.attach(&report_handle, &checkout_id)
    })
    .await
}

#[tauri::command]
async fn read_diff(
    report_handle: String,
    file_id: String,
    state: State<'_, NativeState>,
) -> Result<FileDiff, String> {
    access(state.inner().clone(), move |s| {
        s.diff(&report_handle, &file_id)
    })
    .await
}

#[tauri::command]
async fn get_review_changes(
    report_handle: String,
    state: State<'_, NativeState>,
) -> Result<ReviewChanges, String> {
    access(state.inner().clone(), move |s| {
        s.review_changes(&report_handle)
    })
    .await
}

#[tauri::command]
async fn set_decision(
    app: tauri::AppHandle,
    report_handle: String,
    kind: String,
    entity_id: String,
    decision: Option<String>,
    expected_revision: u64,
    note: Option<String>,
    state: State<'_, NativeState>,
) -> Result<ReviewState, String> {
    let event_handle = report_handle.clone();
    let saved = access(state.inner().clone(), move |s| {
        s.decide(
            &report_handle,
            &kind,
            &entity_id,
            decision.as_deref(),
            expected_revision,
            note.as_deref(),
        )
    })
    .await?;
    let _ = app.emit(
        "trace-state-changed",
        serde_json::json!({"handle":event_handle,"revision":saved.revision}),
    );
    Ok(saved)
}

#[tauri::command]
async fn save_checkpoint(
    app: tauri::AppHandle,
    report_handle: String,
    expected_revision: u64,
    state: State<'_, NativeState>,
) -> Result<ReviewState, String> {
    let event_handle = report_handle.clone();
    let saved = access(state.inner().clone(), move |s| {
        s.checkpoint(&report_handle, expected_revision)
    })
    .await?;
    let _ = app.emit(
        "trace-state-changed",
        serde_json::json!({"handle":event_handle,"revision":saved.revision}),
    );
    Ok(saved)
}

#[tauri::command]
async fn open_source(
    app: tauri::AppHandle,
    report_handle: String,
    evidence_id: String,
    state: State<'_, NativeState>,
) -> Result<OpenSourceResult, String> {
    match access(state.inner().clone(), move |s| {
        s.source(&report_handle, &evidence_id)
    })
    .await
    {
        Ok((uri, path, line)) => match app.opener().open_url(uri, None::<&str>) {
            Ok(()) => Ok(OpenSourceResult {
                opened: true,
                reason: None,
                path: Some(path.to_string_lossy().into()),
                line: Some(line),
            }),
            Err(e) => Ok(OpenSourceResult {
                opened: false,
                reason: Some(format!("Could not open VS Code: {e}")),
                path: Some(path.to_string_lossy().into()),
                line: Some(line),
            }),
        },
        Err(reason) => Ok(OpenSourceResult {
            opened: false,
            reason: Some(reason),
            path: None,
            line: None,
        }),
    }
}

#[tauri::command]
async fn open_file_source(
    app: tauri::AppHandle,
    report_handle: String,
    file_id: String,
    target: String,
    side: Option<String>,
    state: State<'_, NativeState>,
) -> Result<OpenSourceResult, String> {
    match access(state.inner().clone(), move |s| {
        s.file_source(&report_handle, &file_id, &target, side.as_deref())
    })
    .await
    {
        Ok((uri, path, line)) => match app.opener().open_url(uri, None::<&str>) {
            Ok(()) => Ok(OpenSourceResult {
                opened: true,
                reason: None,
                path: Some(path.to_string_lossy().into()),
                line: Some(line),
            }),
            Err(e) => Ok(OpenSourceResult {
                opened: false,
                reason: Some(format!("Could not open source: {e}")),
                path: Some(path.to_string_lossy().into()),
                line: Some(line),
            }),
        },
        Err(reason) => Ok(OpenSourceResult {
            opened: false,
            reason: Some(reason),
            path: None,
            line: None,
        }),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state =
                store::Store::new(app.path().app_data_dir()?).map_err(std::io::Error::other)?;
            app.manage(Arc::new(Mutex::new(state)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_review_stack,
            resolve_review_stack,
            get_review_agents,
            launch_review_agent,
            list_review_agent_launches,
            get_review_setup,
            resolve_review_comparison,
            prepare_review_request,
            list_review_requests,
            check_review_request,
            cancel_review_request,
            import_review_request,
            import_review_request_path,
            list_reports,
            list_projects,
            discover_reports,
            add_project,
            add_project_path,
            import_report,
            import_report_path,
            open_report,
            load_example,
            choose_repository,
            choose_repository_path,
            attach_repository,
            read_diff,
            get_review_changes,
            set_decision,
            save_checkpoint,
            open_source,
            open_file_source
        ])
        .run(tauri::generate_context!())
        .expect("Trace could not start");
}
