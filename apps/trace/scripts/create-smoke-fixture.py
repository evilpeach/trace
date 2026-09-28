#!/usr/bin/env python3
"""Create an isolated real Git repository + Trace report for native smoke testing.

No changes to the caller's repository. Prints a temporary directory and report path.
"""
import json
from pathlib import Path
import subprocess
import tempfile

app = Path(__file__).resolve().parents[1]
root = app.parents[1]
sources = json.loads((app / 'resources/example-sources.json').read_text())
report = json.loads((root / 'docs/trace/skills/trace-report/references/example.trace.json').read_text())
destination = Path(tempfile.mkdtemp(prefix='trace-native-smoke-'))

def git(*args):
    return subprocess.check_output(['git', '-C', str(destination), *args], stderr=subprocess.PIPE).decode().strip()

git('init', '-b', 'main')
git('config', 'user.name', 'Trace test fixture')
git('config', 'user.email', 'trace-fixture@example.invalid')
files = report['files'] + report['contextFiles']
for side in ('base', 'head'):
    for file in files:
        path = destination / file['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(sources[file['id']][side])
    git('add', 'src')
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', f'fixture: {side} snapshot')
    report['comparison'][side] = {'oid': git('rev-parse', 'HEAD'), 'label': side}
report['title'] = 'Trace native integration fixture — account-aware checkout'
report['repository'] = {'id': 'local:trace-native-smoke', 'name': destination.name}
report['reportId'] = 'trace-native-smoke:checkout'
report['provenance'] = {
    'mode': 'agent',
    'generator': 'Trace integration fixture generator',
    'checks': [{'label': 'Application runtime', 'status': 'not-run', 'detail': 'This small Git repository exercises Trace imports and navigation. It is not a runnable checkout product.'}],
    'limitations': ['Source is intentionally authored as a test fixture; no claims about a real user application.']
}
report['summary']['bodyMarkdown'] = 'Integration fixture for Trace: two real commits, two changed files and one unchanged evidence dependency. The code is intentionally incomplete and is not a production application.'
report['coverage']['note'] = 'All changed files between these two generated commits are included. Used only to verify Trace behavior.'
out = destination / 'native-smoke.trace.json'
out.write_text(json.dumps(report, indent=2) + '\n')
print(f'Repository: {destination}')
print(f'Report: {out}')
