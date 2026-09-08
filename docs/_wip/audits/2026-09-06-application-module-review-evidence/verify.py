#!/usr/bin/env python3
"""Verify recovered review snapshots, patch chronology, and package-run evidence."""
import hashlib
import itertools
import json
import re
from pathlib import Path
import subprocess
import difflib

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
index = json.loads((HERE / 'index.json').read_text())
events = json.loads((HERE / 'patches.json').read_text())

def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()

def read(record):
    text = (HERE / record['artifact']).read_text()
    assert sha(text) == record['sha256'], record['artifact']
    if 'lines' in record:
        assert len(text.splitlines()) == record['lines'], record['artifact']
    return text

state = {name: read(record) for name, record in index['initial'].items()}
initial = state.copy()
PLAN = 'docs/_wip/plans/2026-09-05-application-module-migration-plan.md'
NAMES = [PLAN, PLAN.replace('migration-plan', 'source-inventory'),
         PLAN.replace('migration-plan', 'adversarial-reviews'),
         PLAN.replace('migration-plan', 'runtime-design'),
         'docs/roadmap/2026-08-31-full-stack-application-modules.md']
def apply(patch):
    lines = patch.splitlines()
    i = 1
    while i < len(lines) and lines[i] != '*** End Patch':
        header = lines[i]
        match = re.fullmatch(r'\*\*\* (Add|Update) File: (.+)', header)
        assert match, header
        mode, name = match.groups()
        i += 1
        body = []
        while i < len(lines) and not lines[i].startswith('*** '):
            body.append(lines[i]); i += 1
        if i < len(lines) and lines[i] == '*** End of File':
            i += 1
        if name not in NAMES:
            continue
        if mode == 'Add':
            assert name not in state, name
            assert all(line.startswith('+') for line in body)
            state[name] = '\n'.join(line[1:] for line in body) + '\n'
            continue
        current = state[name].splitlines()
        chunks = []
        chunk = []
        for line in body:
            if line.startswith('@@'):
                if chunk: chunks.append(chunk)
                chunk = []
            else:
                assert line[:1] in (' ', '+', '-'), repr(line)
                chunk.append(line)
        if chunk: chunks.append(chunk)
        cursor = 0
        for chunk in chunks:
            before = [line[1:] for line in chunk if line[0] in ' -']
            after = [line[1:] for line in chunk if line[0] in ' +']
            matches = [j for j in range(cursor, len(current) - len(before) + 1) if current[j:j+len(before)] == before]
            assert matches, (name, before[:3])
            j = matches[0]
            current[j:j+len(before)] = after
            cursor = j + len(after)
        state[name] = '\n'.join(current) + '\n'

history = []
assert len(events) == 19
assert len({event['id'] for event in events}) == len(events)
assert [event['timestamp'] for event in events] == sorted(event['timestamp'] for event in events)
for event in events:
    old = state.copy()
    apply(event['patch'])
    delta = ''.join(''.join(difflib.unified_diff(old.get(name, '').splitlines(True), state.get(name, '').splitlines(True), fromfile=name, tofile=name, n=0)) for name in NAMES if old.get(name) != state.get(name))
    assert (HERE / 'changes' / (event['id'] + '.diff')).read_text() == delta, event['id']
    history.append((event['timestamp'], state.copy()))

def at(timestamp):
    candidates = [s for ts, s in history if ts < timestamp]
    return candidates[-1] if candidates else initial

assert [r['round'] for r in index['rounds']] == [1, 2, 3, 4, 5]
previous = None
for r in index['rounds']:
    for field, timestamp in [('input', r['dispatched_at']), ('revised', r['revision_window_end'])]:
        expected = {name: read(record) for name, record in r[field].items()}
        assert at(timestamp) == expected, (r['round'], field)
    assert r['changes'] == [e['id'] for e in events if r['dispatched_at'] <= e['timestamp'] < r['revision_window_end']]
    for response in r['responses']:
        read(response)
        assert r['dispatched_at'] < response['timestamp'] < r['revision_window_end']
    if previous:
        assert previous['revised'] == r['input']
        assert max(x['timestamp'] for x in previous['responses']) < r['dispatched_at']
    previous = r
assert 'R5-01 is closed' in read(index['rounds'][4]['responses'][-1])

for record in index['binding_references']:
    text = subprocess.check_output(['git', 'show', record['commit'] + ':' + record['path']], cwd=REPO, text=True)
    assert sha(text) == record['sha256'], record['path']
for name, text in state.items():
    committed = subprocess.check_output(['git', 'show', index['consolidated_commit'] + ':' + name], cwd=REPO, text=True)
    delta = ''.join(difflib.unified_diff(text.splitlines(True), committed.splitlines(True), fromfile='round-5-end/' + name, tofile='committed/' + name, n=0))
    if delta:
        assert (HERE / 'changes' / ('post-review-' + Path(name).name + '.diff')).read_text() == delta

fixture = REPO / 'tests/preimplementation/application-modules/experiments/review-package-resolution'
recovery = json.loads((fixture / 'recovery.json').read_text())
for record in recovery['files']:
    text = (fixture / 'fixtures' / record['layout'] / record['path']).read_text()
    assert sha(text) == record['template_sha256'], record['path']
proof = json.loads((HERE / 'package-results.json').read_text())
assert proof['node'] == 'v22.22.0' and proof['npm'] == '10.9.4'
assert proof['result'] == 'passed'
for name, digest in proof['source_sha256'].items():
    assert sha((fixture / name).read_text()) == digest, name
cases = [run for run in proof['runs'] if 'layout' in run]
assert len(cases) == 8
assert {(r['layout'], r['stage'], r['order']) for r in cases} == set(itertools.product(('sibling', 'ancestor'), ('install', 'clean-ci'), ('forward', 'reverse')))
for run in proof['runs']:
    assert run['exit_code'] == (1 if run.get('layout') == 'ancestor' else 0)
for run in cases:
    if run['layout'] == 'ancestor':
        assert 'ERR_MODULE_NOT_FOUND' in run['stderr'] and '@probe/timezone' in run['stderr']
    else:
        result = json.loads(run['stdout'])
        assert result['versions'] == {'server': '0.6.0', 'web': '0.5.47', 'cli': '0.5.46'}
        assert result['separateInstances'] and result['sameFacetIdentity'] and result['privateImportRejected']
print(json.dumps({'result': 'passed', 'rounds': 5, 'patches_replayed': len(events), 'reviewer_responses': sum(len(r['responses']) for r in index['rounds']), 'package_cases': len(cases), 'binding_references': len(index['binding_references'])}))
