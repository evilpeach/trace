//! The native privilege boundary validates reports independently of the renderer.
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const SCHEMA: &str =
    include_str!("../../../../docs/trace/skills/trace-report/references/schema.json");
const MAX_VALUES: usize = 200_000;
static VALIDATOR: OnceLock<Result<jsonschema::Validator, String>> = OnceLock::new();

/// JSON Schema integers include lexical floats such as 1.0. Keep JS/Rust bounds identical.
pub fn source_integer(value: &Value) -> Option<u64> {
    const MAX_SAFE: u64 = 9_007_199_254_740_991;
    if let Some(n) = value.as_u64() {
        return (n <= MAX_SAFE).then_some(n);
    }
    value
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0 && *n <= MAX_SAFE as f64 && n.fract() == 0.0)
        .map(|n| n as u64)
}

fn array<'a>(v: &'a Value, key: &str) -> &'a Vec<Value> {
    v[key].as_array().expect("validated array")
}
fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().expect("validated string")
}
fn ids(v: &Value) -> impl Iterator<Item = &str> {
    v.as_array()
        .expect("validated ids")
        .iter()
        .map(|x| x.as_str().expect("validated id"))
}
fn check_path(path: &str) -> bool {
    !path.starts_with('/')
        && !path.contains('\\')
        && !(path.as_bytes().get(1) == Some(&b':') && path.as_bytes()[0].is_ascii_alphabetic())
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
        && !path.chars().any(char::is_control)
}
fn index<'a>(
    items: impl Iterator<Item = &'a Value>,
    label: &str,
) -> Result<HashMap<&'a str, &'a Value>, String> {
    let mut result = HashMap::new();
    for item in items {
        let id = string(item, "id");
        if result.insert(id, item).is_some() {
            return Err(format!("{label}: duplicate id {id}"));
        }
    }
    Ok(result)
}
fn refs(values: &Value, target: &HashMap<&str, &Value>, label: &str) -> Result<(), String> {
    for id in ids(values) {
        if !target.contains_key(id) {
            return Err(format!("{label}: unknown reference {id}"));
        }
    }
    Ok(())
}
fn reachable<'a>(
    starts: impl Iterator<Item = &'a str>,
    graph: &HashMap<&'a str, Vec<&'a str>>,
) -> HashSet<&'a str> {
    let mut seen = HashSet::new();
    let mut todo: Vec<_> = starts.collect();
    while let Some(id) = todo.pop() {
        if seen.insert(id) {
            if let Some(next) = graph.get(id) {
                todo.extend(next);
            }
        }
    }
    seen
}
fn check_limits(data: &Value) -> Result<(), String> {
    let mut stack = vec![(data, 0usize)];
    let mut count = 0usize;
    while let Some((value, depth)) = stack.pop() {
        count += 1;
        if depth > 32 || count > MAX_VALUES {
            return Err("LIMIT_EXCEEDED: report nesting or value count exceeds limits".into());
        }
        match value {
            Value::String(s)
                if s.chars().any(|c| {
                    (c.is_control() && c != '\n' && c != '\t') || ('\u{7f}'..='\u{9f}').contains(&c)
                }) =>
            {
                return Err("Report contains forbidden control characters".into())
            }
            Value::Array(items) => {
                if items.len() > 20_000 {
                    return Err("LIMIT_EXCEEDED: array has more than 20000 entries".into());
                }
                stack.extend(items.iter().map(|x| (x, depth + 1)));
            }
            Value::Object(map) => {
                stack.extend(map.values().map(|x| (x, depth + 1)));
            }
            _ => {}
        }
    }
    for (field, limit) in [
        ("files", 10_000),
        ("contextFiles", 10_000),
        ("evidence", 20_000),
        ("rounds", 2_000),
        ("flows", 500),
        ("findings", 5_000),
    ] {
        if data[field].as_array().is_some_and(|v| v.len() > limit) {
            return Err(format!(
                "LIMIT_EXCEEDED: {field} allows at most {limit} entries"
            ));
        }
    }
    if let Some(flows) = data["flows"].as_array() {
        for flow in flows {
            for side in ["before", "after"] {
                for (key, limit) in [("nodes", 200), ("edges", 800)] {
                    if flow[side]["graph"][key]
                        .as_array()
                        .is_some_and(|v| v.len() > limit)
                    {
                        return Err(format!("LIMIT_EXCEEDED: flow graph {key} limit is {limit}"));
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn validate(data: &Value) -> Result<(), String> {
    check_limits(data)?;
    let validator = VALIDATOR
        .get_or_init(|| {
            let schema: Value = serde_json::from_str(SCHEMA).map_err(|e| e.to_string())?;
            jsonschema::options()
                .with_draft(jsonschema::Draft::Draft202012)
                .should_validate_formats(true)
                .build(&schema)
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| e.clone())?;
    let errors: Vec<_> = validator
        .iter_errors(data)
        .take(24)
        .map(|e| format!("{}: {}", e.instance_path, e))
        .collect();
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    if let Some(pr) = data.get("pullRequest") {
        if source_integer(&pr["number"]).is_none() {
            return Err("pullRequest.number exceeds safe integer range".into());
        }
    }
    let repo_id = string(&data["repository"], "id");
    if repo_id.starts_with('/')
        || repo_id.starts_with("file:")
        || repo_id.contains('\\')
        || (repo_id.as_bytes().get(1) == Some(&b':') && repo_id.as_bytes()[0].is_ascii_alphabetic())
    {
        return Err("repository.id must be portable, not a local checkout path".into());
    }
    let files = index(
        array(data, "files")
            .iter()
            .chain(array(data, "contextFiles").iter()),
        "files/contextFiles",
    )?;
    let rounds = index(array(data, "rounds").iter(), "rounds")?;
    let evidence = index(array(data, "evidence").iter(), "evidence")?;
    let flows = index(array(data, "flows").iter(), "flows")?;
    if let Some(main_journey) = data.get("mainJourney") {
        let flow_id = string(main_journey, "flowId");
        if !flows.contains_key(flow_id) {
            return Err(format!("mainJourney.flowId: unknown flow {flow_id}"));
        }
        if string(main_journey, "why").trim().is_empty() {
            return Err("mainJourney.why: must explain the main journey designation".into());
        }
    }
    index(array(data, "findings").iter(), "findings")?;
    if let Some(values) = data["valueDerivations"].as_array() {
        index(values.iter(), "valueDerivations")?;
    }
    let mut paths = HashSet::new();
    for (id, file) in &files {
        let path = string(file, "path");
        if !check_path(path) {
            return Err(format!("file {id}: non-canonical relative path {path}"));
        }
        if !paths.insert(path) {
            return Err(format!("duplicate file path {path}"));
        }
        if let Some(status) = file["status"].as_str() {
            let moved = status == "renamed" || status == "copied";
            if moved != file.get("previousPath").is_some() {
                return Err(format!(
                    "file {id}: previousPath is required only for renamed/copied files"
                ));
            }
            if let Some(previous) = file["previousPath"].as_str() {
                if !check_path(previous) || previous == path {
                    return Err(format!("file {id}: invalid previousPath"));
                }
            }
            if let Some(round) = file["roundId"].as_str() {
                if !rounds.contains_key(round) {
                    return Err(format!("file {id}: unknown round {round}"));
                }
            } else if data["coverage"]["inventory"] == "complete" {
                return Err(format!("file {id}: complete inventory requires a round"));
            }
        }
    }
    // Kahn's algorithm keeps imported deep dependency chains off the call stack.
    let mut indegrees: HashMap<_, usize> = rounds
        .iter()
        .map(|(id, r)| (*id, ids(&r["dependsOn"]).count()))
        .collect();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
    for (id, round) in &rounds {
        refs(&round["dependsOn"], &rounds, "round dependsOn")?;
        for dep in ids(&round["dependsOn"]) {
            dependents.entry(dep).or_default().push(id);
        }
    }
    let mut ready: Vec<_> = indegrees
        .iter()
        .filter_map(|(id, n)| (*n == 0).then_some(*id))
        .collect();
    let mut visited = 0;
    while let Some(id) = ready.pop() {
        visited += 1;
        if let Some(next) = dependents.get(id) {
            for n in next {
                let degree = indegrees.get_mut(n).unwrap();
                *degree -= 1;
                if *degree == 0 {
                    ready.push(n);
                }
            }
        }
    }
    if visited != rounds.len() {
        return Err("rounds: dependency cycle".into());
    }
    for (id, anchor) in &evidence {
        let file_id = string(anchor, "fileId");
        let file = files
            .get(file_id)
            .ok_or_else(|| format!("evidence {id}: unknown file {file_id}"))?;
        let start = source_integer(&anchor["startLine"])
            .ok_or("evidence.startLine exceeds safe integer range")?;
        let end = source_integer(&anchor["endLine"])
            .ok_or("evidence.endLine exceeds safe integer range")?;
        if start > end {
            return Err(format!("evidence {id}: end precedes start"));
        }
        if (file["status"] == "added" && anchor["side"] == "base")
            || (file["status"] == "deleted" && anchor["side"] == "head")
        {
            return Err(format!("evidence {id}: source side does not exist"));
        }
    }
    for (flow_id, flow) in &flows {
        refs(&flow["fileIds"], &files, "flow fileIds")?;
        let flow_files: HashSet<_> = ids(&flow["fileIds"]).collect();
        for (snapshot, side) in [("before", "base"), ("after", "head")] {
            let graph = &flow[snapshot]["graph"];
            if graph.is_null() {
                continue;
            }
            let label = format!("flow {flow_id} {snapshot}");
            let nodes = index(array(graph, "nodes").iter(), &label)?;
            let mut forward: HashMap<&str, Vec<&str>> =
                nodes.keys().map(|id| (*id, vec![])).collect();
            let mut reverse = forward.clone();
            let check_evidence = |references: &Value| -> Result<(), String> {
                refs(references, &evidence, &label)?;
                for eid in ids(references) {
                    let anchor = evidence[eid];
                    if anchor["side"] != side {
                        return Err(format!("{label}: evidence {eid} must use {side} revision"));
                    }
                    if !flow_files.contains(string(anchor, "fileId")) {
                        return Err(format!(
                            "{label}: evidence {eid} file must appear in fileIds"
                        ));
                    }
                }
                Ok(())
            };
            for (id, node) in &nodes {
                check_evidence(&node["evidenceIds"])?;
                if node["kind"] != "entry" && array(node, "evidenceIds").is_empty() {
                    return Err(format!("{label} node {id}: behavior needs source evidence"));
                }
            }
            let mut seen_edges = HashSet::new();
            for edge in array(graph, "edges") {
                let from = string(edge, "from");
                let to = string(edge, "to");
                if !nodes.contains_key(from) || !nodes.contains_key(to) {
                    return Err(format!("{label}: edge has unknown endpoint"));
                }
                if !seen_edges.insert((from, to, edge["label"].as_str())) {
                    return Err(format!("{label}: duplicate edge"));
                }
                check_evidence(&edge["evidenceIds"])?;
                forward.get_mut(from).unwrap().push(to);
                reverse.get_mut(to).unwrap().push(from);
            }
            let entries: Vec<_> = nodes
                .iter()
                .filter_map(|(id, n)| (n["kind"] == "entry").then_some(*id))
                .collect();
            let outcomes: Vec<_> = nodes
                .iter()
                .filter_map(|(id, n)| (n["kind"] == "outcome").then_some(*id))
                .collect();
            if entries.is_empty() || outcomes.is_empty() {
                return Err(format!("{label}: needs an entry and an outcome"));
            }
            if reachable(entries.into_iter(), &forward).len() != nodes.len() {
                return Err(format!("{label}: unreachable nodes"));
            }
            if reachable(outcomes.into_iter(), &reverse).len() != nodes.len() {
                return Err(format!("{label}: nodes without a path to an outcome"));
            }
            for (id, node) in &nodes {
                if node["kind"] == "decision" {
                    let outgoing: Vec<_> = array(graph, "edges")
                        .iter()
                        .filter(|e| e["from"] == *id)
                        .collect();
                    let labels: HashSet<_> = outgoing
                        .iter()
                        .filter_map(|e| e["label"].as_str())
                        .collect();
                    if outgoing.len() < 2 || labels.len() != outgoing.len() {
                        return Err(format!(
                            "{label}: decision {id} needs distinct labeled branches"
                        ));
                    }
                }
            }
        }
    }
    for finding in array(data, "findings") {
        if !evidence.contains_key(string(finding, "primaryEvidenceId")) {
            return Err("finding: unknown primary evidence".into());
        }
        refs(&finding["flowIds"], &flows, "finding flowIds")?;
        for step in array(finding, "trace") {
            refs(&step["evidenceIds"], &evidence, "finding trace")?;
        }
        if finding["assessment"] == "supported" && finding["priority"].is_null() {
            return Err("supported finding requires explicit priority".into());
        }
    }
    if let Some(derivations) = data["valueDerivations"].as_array() {
        for d in derivations {
            for step in array(d, "trace") {
                refs(&step["evidenceIds"], &evidence, "value derivation")?;
            }
        }
    }
    if string(&data["comparison"]["base"], "oid").len()
        != string(&data["comparison"]["head"], "oid").len()
    {
        return Err("base/head object formats differ".into());
    }
    if data["coverage"]["inventory"] == "partial" && data["summary"]["outcome"] != "incomplete" {
        return Err("partial inventory requires incomplete outcome".into());
    }
    if data["coverage"]["flowAnalysis"] == "not-assessed" && !flows.is_empty() {
        return Err("not-assessed flow coverage must not contain authored flows".into());
    }
    if data["coverage"]["flowAnalysis"] == "complete"
        && flows.values().any(|f| {
            f["before"]["status"] == "unavailable" || f["after"]["status"] == "unavailable"
        })
    {
        return Err("complete flow coverage cannot have unavailable snapshots".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../../docs/trace/skills/trace-report/references/example.trace.json"
        ))
        .unwrap()
    }
    #[test]
    fn integer_semantics_match_javascript() {
        let mut d = fixture();
        d["evidence"][0]["startLine"] = serde_json::json!(1.0);
        validate(&d).unwrap();
        d["evidence"][0]["startLine"] = serde_json::json!(13.0);
        assert!(validate(&d).unwrap_err().contains("end precedes"));
        d["evidence"][0]["startLine"] = serde_json::json!(9_007_199_254_740_992u64);
        assert!(validate(&d).unwrap_err().contains("safe integer"));
    }
    #[test]
    fn valid_and_clean_reports() {
        let mut d = fixture();
        validate(&d).unwrap();
        d["findings"] = serde_json::json!([]);
        validate(&d).unwrap();
    }
    #[test]
    fn validates_optional_main_journey_designation() {
        let mut d = fixture();
        d.as_object_mut().unwrap().remove("mainJourney");
        validate(&d).unwrap();
        d["mainJourney"] = serde_json::json!({
            "flowId": d["flows"][0]["id"],
            "why": "This journey connects the changed account selection to checkout."
        });
        validate(&d).unwrap();
        d["mainJourney"]["flowId"] = "unknown-flow".into();
        assert!(validate(&d).unwrap_err().contains("mainJourney.flowId"));
        d["mainJourney"]["flowId"] = d["flows"][0]["id"].clone();
        d["mainJourney"]["why"] = " \n\t ".into();
        assert!(validate(&d).is_err());
        d["mainJourney"]["why"] = "This journey explains the central behavior.".into();
        d["flows"] = serde_json::json!([]);
        assert!(validate(&d).unwrap_err().contains("mainJourney.flowId"));
    }
    #[test]
    fn rejects_traversal_and_absolute_paths() {
        for path in [
            "../secret",
            "/etc/passwd",
            "src//file.ts",
            "C:/secret",
            "src/./foo",
        ] {
            let mut d = fixture();
            d["files"][0]["path"] = path.into();
            assert!(validate(&d).is_err(), "{path}");
        }
    }
    #[test]
    fn rejects_broken_evidence() {
        let mut d = fixture();
        d["evidence"][0]["fileId"] = "missing".into();
        assert!(validate(&d).unwrap_err().contains("unknown"));
    }
    #[test]
    fn rejects_wrong_side() {
        let mut d = fixture();
        d["evidence"][0]["side"] = "head".into();
        assert!(validate(&d).unwrap_err().contains("base revision"));
    }
    #[test]
    fn rejects_round_cycle() {
        let mut d = fixture();
        d["rounds"][0]["dependsOn"] = serde_json::json!(["round-checkout"]);
        assert!(validate(&d).unwrap_err().contains("cycle"));
    }
    #[test]
    fn rejects_unlabeled_decision() {
        let mut d = fixture();
        d["flows"][0]["after"]["graph"]["edges"][1]
            .as_object_mut()
            .unwrap()
            .remove("label");
        assert!(validate(&d).unwrap_err().contains("labeled"));
    }
    #[test]
    fn rejects_app_state_and_incomplete_guidance() {
        let mut d = fixture();
        d["reviewed"] = true.into();
        assert!(validate(&d).is_err());
        let mut d = fixture();
        d["files"][0]["analysis"]["tldr"] = Value::Null;
        assert!(validate(&d).is_err());
    }
    #[test]
    fn limits_graphs_and_controls() {
        let mut d = fixture();
        let n = d["flows"][0]["after"]["graph"]["nodes"][0].clone();
        d["flows"][0]["after"]["graph"]["nodes"] = Value::Array(vec![n; 201]);
        assert!(validate(&d).unwrap_err().contains("LIMIT_EXCEEDED"));
        let mut d = fixture();
        d["title"] = "unsafe\u{001b}text".into();
        assert!(validate(&d).is_err());
    }
}
