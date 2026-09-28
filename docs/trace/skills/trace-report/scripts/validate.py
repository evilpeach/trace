#!/usr/bin/env python3
"""Validate Trace v1 shape and references; optionally verify the exact Git snapshots.

Usage: python3 scripts/validate.py REPORT.trace.json [--repo /path/to/checkout]
Dependency: jsonschema>=4.18. No network requests or files are written.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    sys.exit("Install the validator dependency: python3 -m pip install 'jsonschema>=4.18'")

CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
STATUS = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed",
          "C": "copied", "T": "type-changed"}


def semantic_errors(data: dict) -> list[str]:
    errors: list[str] = []

    def error(message: str) -> None:
        errors.append(message)

    def scan(value, path="$"):
        if isinstance(value, str) and CONTROL.search(value):
            error(f"{path}: forbidden control character")
        elif isinstance(value, list):
            for i, item in enumerate(value):
                scan(item, f"{path}[{i}]")
        elif isinstance(value, dict):
            for key, item in value.items():
                scan(item, f"{path}.{key}")

    scan(data)
    repository_id = data["repository"]["id"]
    if repository_id.startswith(("/", "file:")) or "\\" in repository_id or re.match(r"^[A-Za-z]:", repository_id):
        error("repository.id: local checkout paths are not portable repository identities")

    def index(items, label):
        result = {}
        for item in items:
            if item["id"] in result:
                error(f"{label}: duplicate id {item['id']}")
            result[item["id"]] = item
        return result

    def refs(values, target, label):
        for value in values:
            if value not in target:
                error(f"{label}: unknown reference {value}")

    def path_check(path, label):
        if (path.startswith("/") or "\\" in path or
                any(part in {"", ".", ".."} for part in path.split("/")) or
                re.match(r"^[A-Za-z]:", path) or any(ord(c) < 32 for c in path)):
            error(f"{label}: must be a canonical repository-relative POSIX path")

    files = index(data["files"] + data["contextFiles"], "files/contextFiles")
    rounds = index(data["rounds"], "rounds")
    evidence = index(data["evidence"], "evidence")
    flows = index(data["flows"], "flows")
    index(data["findings"], "findings")
    index(data.get("valueDerivations", []), "valueDerivations")

    if "mainJourney" in data:
        refs([data["mainJourney"]["flowId"]], flows, "mainJourney.flowId")

    paths = set()
    for file in files.values():
        path_check(file["path"], f"file {file['id']}")
        if file["path"] in paths:
            error(f"files/contextFiles: duplicate path {file['path']}")
        paths.add(file["path"])
        if "status" not in file:
            continue
        moved = file["status"] in {"renamed", "copied"}
        if moved != ("previousPath" in file):
            error(f"file {file['id']}: previousPath is required only for renamed/copied files")
        if "previousPath" in file:
            path_check(file["previousPath"], f"file {file['id']} previousPath")
            if file["previousPath"] == file["path"]:
                error(f"file {file['id']}: previousPath must differ from path")
        if file["roundId"] is not None:
            refs([file["roundId"]], rounds, f"file {file['id']} roundId")
        elif data["coverage"]["inventory"] == "complete":
            error(f"file {file['id']}: a complete inventory requires a review round")

    active, done = set(), set()

    def visit(round_id):
        if round_id in active:
            error(f"rounds: dependency cycle at {round_id}")
            return
        if round_id in done or round_id not in rounds:
            return
        active.add(round_id)
        for dependency in rounds[round_id]["dependsOn"]:
            visit(dependency)
        active.remove(round_id)
        done.add(round_id)

    for rid, rnd in rounds.items():
        refs(rnd["dependsOn"], rounds, f"round {rid} dependsOn")
        visit(rid)

    for eid, anchor in evidence.items():
        refs([anchor["fileId"]], files, f"evidence {eid} fileId")
        if anchor["startLine"] > anchor["endLine"]:
            error(f"evidence {eid}: endLine precedes startLine")
        file = files.get(anchor["fileId"], {})
        if ((file.get("status") == "added" and anchor["side"] == "base") or
                (file.get("status") == "deleted" and anchor["side"] == "head")):
            error(f"evidence {eid}: {anchor['side']} side does not exist")

    def evidence_refs(ids, label, side=None, flow_files=None):
        refs(ids, evidence, label)
        for eid in ids:
            anchor = evidence.get(eid)
            if anchor is None:
                continue
            if side and anchor["side"] != side:
                error(f"{label}: evidence {eid} must use {side} revision")
            if flow_files is not None and anchor["fileId"] not in flow_files:
                error(f"{label}: evidence {eid} file must be listed in flow.fileIds")

    def closure(starts, adjacency):
        reached, pending = set(), list(starts)
        while pending:
            node = pending.pop()
            if node in reached:
                continue
            reached.add(node)
            pending.extend(adjacency.get(node, []))
        return reached

    for fid, flow in flows.items():
        refs(flow["fileIds"], files, f"flow {fid} fileIds")
        for snapshot, side in (("before", "base"), ("after", "head")):
            graph = flow[snapshot]["graph"]
            if graph is None:
                continue
            label = f"flow {fid} {snapshot}"
            nodes = index(graph["nodes"], label + " nodes")
            forward = {node: [] for node in nodes}
            reverse = {node: [] for node in nodes}
            for node in nodes.values():
                evidence_refs(node["evidenceIds"], label + " node " + node["id"], side, flow["fileIds"])
                if node["kind"] != "entry" and not node["evidenceIds"]:
                    error(f"{label} node {node['id']}: code behavior needs source evidence")
            seen_edges = set()
            for edge in graph["edges"]:
                refs([edge["from"], edge["to"]], nodes, label + " edge")
                evidence_refs(edge["evidenceIds"], label + " edge", side, flow["fileIds"])
                identity = (edge["from"], edge["to"], edge.get("label"))
                if identity in seen_edges:
                    error(f"{label}: duplicate edge {identity}")
                seen_edges.add(identity)
                if edge["from"] in nodes and edge["to"] in nodes:
                    forward[edge["from"]].append(edge["to"])
                    reverse[edge["to"]].append(edge["from"])
            entries = [n["id"] for n in nodes.values() if n["kind"] == "entry"]
            outcomes = [n["id"] for n in nodes.values() if n["kind"] == "outcome"]
            if not entries or not outcomes:
                error(f"{label}: needs an entry and an outcome")
            if set(nodes) - closure(entries, forward):
                error(f"{label}: nodes unreachable from an entry")
            if set(nodes) - closure(outcomes, reverse):
                error(f"{label}: nodes without a path to an outcome")
            for node in nodes.values():
                outgoing = [e for e in graph["edges"] if e["from"] == node["id"]]
                if node["kind"] == "decision":
                    labels = [e.get("label") for e in outgoing]
                    if len(labels) < 2 or not all(labels) or len(set(labels)) != len(labels):
                        error(f"{label} decision {node['id']}: needs distinct labeled branches")

    for finding in data["findings"]:
        label = f"finding {finding['id']}"
        refs(finding["flowIds"], flows, label + " flowIds")
        evidence_refs([finding["primaryEvidenceId"]], label + " primaryEvidenceId")
        for step in finding["trace"]:
            evidence_refs(step["evidenceIds"], label + " trace")
        if finding["assessment"] == "supported" and finding["priority"] is None:
            error(label + ": supported findings require explicit priority")

    for derivation in data.get("valueDerivations", []):
        for step in derivation["trace"]:
            evidence_refs(step["evidenceIds"], f"derivation {derivation['id']} trace")

    base, head = (data["comparison"][side]["oid"] for side in ("base", "head"))
    if len(base) != len(head):
        error("comparison: base/head must use the same Git object format")
    if data["coverage"]["inventory"] == "partial" and data["summary"]["outcome"] != "incomplete":
        error("summary: partial inventory requires outcome incomplete")
    if data["coverage"]["flowAnalysis"] == "not-assessed" and data["flows"]:
        error("coverage: not-assessed flowAnalysis must have no authored flows")
    if data["coverage"]["flowAnalysis"] == "complete" and any(
        flow[side]["status"] == "unavailable" for flow in data["flows"] for side in ("before", "after")
    ):
        error("coverage: flowAnalysis cannot be complete with an unavailable snapshot")
    return errors


def git_errors(data: dict, repo: Path) -> list[str]:
    errors: list[str] = []

    def git(*args):
        return subprocess.check_output(
            ["git", "--literal-pathspecs", "-C", str(repo), *args], stderr=subprocess.PIPE)

    base, head = (data["comparison"][side]["oid"] for side in ("base", "head"))
    for oid in (base, head):
        if git("cat-file", "-t", oid).strip() != b"commit":
            errors.append(f"Git: {oid} is not a commit")
    if errors:
        return errors

    # Same rename/copy policy as Trace's v1 native inventory. Git is authoritative.
    parts = git("diff", "--no-ext-diff", "--no-textconv", "--raw", "-z", "--no-abbrev",
                "--find-renames=50%", "--find-copies=50%", base, head, "--").split(b"\0")
    actual = {}
    i = 0
    while i < len(parts) and parts[i]:
        header = parts[i].decode("ascii").split()
        status = STATUS[header[4][0]]
        first = parts[i + 1].decode("utf-8")
        i += 2
        previous = None
        if status in {"renamed", "copied"}:
            previous, path = first, parts[i].decode("utf-8")
            i += 1
        else:
            path = first
        actual[path] = (status, previous)
    reported = {f["path"]: (f["status"], f.get("previousPath")) for f in data["files"]}
    for path, value in reported.items():
        if actual.get(path) != value:
            errors.append(f"Git: file status/path mismatch for {path}")
    if data["coverage"]["inventory"] == "complete":
        for path in actual.keys() - reported.keys():
            errors.append(f"Git: complete inventory omits {path}")

    files = {f["id"]: f for f in data["files"] + data["contextFiles"]}
    for file in data["contextFiles"]:
        if file["path"] in actual:
            errors.append(f"Git: context file {file['path']} is changed; put it in files")
        left = git("ls-tree", "-z", base, "--", file["path"])
        right = git("ls-tree", "-z", head, "--", file["path"])
        if not left or left != right:
            errors.append(f"Git: context file {file['path']} must exist unchanged on both sides")

    cache = {}
    for anchor in data["evidence"]:
        file = files[anchor["fileId"]]
        side = anchor["side"]
        oid = data["comparison"][side]["oid"]
        path = file.get("previousPath", file["path"]) if side == "base" else file["path"]
        key = (oid, path)
        if key not in cache:
            entry = git("ls-tree", "-z", oid, "--", path)
            # Symlinks and submodules are intentionally not treated as code text.
            if not entry.startswith((b"100644 blob ", b"100755 blob ")):
                cache[key] = None
            else:
                blob = git("cat-file", "blob", f"{oid}:{path}")
                cache[key] = (None if b"\0" in blob else
                              blob.count(b"\n") + int(bool(blob) and not blob.endswith(b"\n")))
        lines = cache[key]
        if lines is None:
            errors.append(f"Git: evidence {anchor['id']} does not point to a regular text blob")
        elif anchor["endLine"] > lines:
            errors.append(f"Git: evidence {anchor['id']} exceeds {side} file length ({lines} lines)")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--repo", type=Path, help="also check complete inventory and source lines against Git")
    args = parser.parse_args()
    try:
        data = json.loads(args.report.read_text(encoding="utf-8"))
        schema = json.loads((Path(__file__).parent.parent / "references/schema.json").read_text())
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        errors = [f"Schema {'.'.join(map(str, e.absolute_path)) or '$'}: {e.message}"
                  for e in validator.iter_errors(data)]
        if not errors:
            errors.extend(semantic_errors(data))
        if not errors and args.repo:
            if data["provenance"]["mode"] == "synthetic-example":
                errors.append("Git: synthetic-example reports cannot verify against a real checkout")
            else:
                errors.extend(git_errors(data, args.repo.resolve()))
        if errors:
            print("FAIL\n" + "\n".join(errors))
            return 1
        print(f"OK — {len(data['files'])} changed files, {len(data['flows'])} flows, "
              f"{len(data['findings'])} findings; schema and references verified")
        print("Git snapshots verified." if args.repo else
              "Git not checked: pass --repo to verify inventory, status, side existence and line bounds.")
        return 0
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        detail = exc.stderr.decode("utf-8", "replace").strip() if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        print(f"FAIL: {detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
