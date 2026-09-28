use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub decision: String,
    pub fingerprint: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub stale: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub head: String,
    pub saved_at: String,
    pub digest: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewState {
    pub revision: u64,
    pub files: BTreeMap<String, Decision>,
    pub flows: BTreeMap<String, Decision>,
    pub findings: BTreeMap<String, Decision>,
    pub checkpoint: Option<Checkpoint>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChangeEntity {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEntityChanges {
    pub added: Vec<ReviewChangeEntity>,
    pub changed: Vec<ReviewChangeEntity>,
    pub removed: Vec<ReviewChangeEntity>,
    pub unchanged: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewBaseline {
    pub handle: String,
    pub head: String,
    pub digest: String,
    pub saved_at: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChanges {
    pub status: String,
    pub baseline: Option<ReviewBaseline>,
    pub reason: Option<String>,
    pub files: ReviewEntityChanges,
    pub flows: ReviewEntityChanges,
    pub findings: ReviewEntityChanges,
    pub unchanged_reviewed_file_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub checkout_id: String,
    pub repository_id: String,
    pub display_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedReport {
    pub handle: String,
    pub digest: String,
    pub report: Value,
    pub state: ReviewState,
    pub repository: Option<RepositoryInfo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    pub project_id: String,
    pub report_id: String,
    pub pr_number: Option<u64>,
    pub pr_url: Option<String>,
    pub handle: String,
    pub title: String,
    pub repository_name: String,
    pub generated_at: String,
    pub head: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSide {
    pub path: String,
    pub oid: String,
    pub blob_oid: Option<String>,
    pub text: Option<String>,
    pub kind: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub file_id: String,
    pub base: DiffSide,
    pub head: DiffSide,
    pub patch: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSourceResult {
    pub opened: bool,
    pub reason: Option<String>,
    pub path: Option<String>,
    pub line: Option<u64>,
}

pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub fn items<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub repository_id: String,
    pub repositories: Vec<RepositoryInfo>,
    pub report_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryIssue {
    pub project_id: String,
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub imported: u64,
    pub skipped: u64,
    pub scanned: u64,
    pub issues: Vec<DiscoveryIssue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSetup {
    pub checkout_id: String,
    pub head_ref: String,
    pub default_base_ref: Option<String>,
    pub base_source: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveReviewInput {
    pub checkout_id: String,
    pub kind: String,
    pub base_ref: Option<String>,
    pub head_ref: Option<String>,
    pub pr_url: Option<String>,
    pub previous_report_handle: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReviewRevision {
    pub oid: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReviewPullRequest {
    pub number: u64,
    pub url: String,
    pub title: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComparison {
    pub token: String,
    pub checkout_id: String,
    pub repository_id: String,
    pub repository_name: String,
    pub base: ReviewRevision,
    pub head: ReviewRevision,
    pub changed_file_count: usize,
    pub pr: Option<ReviewPullRequest>,
    pub report_id: String,
    pub prior_report_handle: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareReviewInput {
    pub comparison_token: String,
    pub focus: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    pub id: String,
    pub comparison: ReviewComparison,
    pub focus: String,
    pub prompt: String,
    pub output_path: String,
    pub toolkit_path: String,
    pub created_at: String,
    pub status: String,
    pub error: Option<String>,
    pub report_handle: Option<String>,
}
