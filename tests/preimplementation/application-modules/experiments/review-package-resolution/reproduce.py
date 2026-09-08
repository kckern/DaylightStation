#!/usr/bin/env python3
"""Reproduce the recovered synthetic npm experiment in disposable directories."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node', required=True, type=Path)
parser.add_argument('--npm-cli', required=True, type=Path)
args = parser.parse_args()
node, npm = args.node.resolve(), args.npm_cli.resolve()
source = Path(__file__).resolve().parent
report = {'schema': 1, 'scope': 'synthetic packaging only', 'runs': []}
report['executed_at'] = datetime.now(timezone.utc).isoformat()
report['platform'] = {'system': platform.system(), 'architecture': platform.machine()}
report['source_sha256'] = {
    str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
    for p in sorted(source.rglob('*'))
    if p.is_file() and p.suffix in ('.json', '.mjs', '.py')
}

with tempfile.TemporaryDirectory(prefix='module-review-package-') as temporary:
    root = Path(temporary)
    env = {key: value for key, value in os.environ.items()
           if key in ('PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'LANG')}
    env['PATH'] = str(node.parent) + os.pathsep + env.get('PATH', '')
    env['npm_config_userconfig'] = str(root / 'empty.npmrc')
    env['npm_config_globalconfig'] = str(root / 'empty-global.npmrc')
    env['npm_config_cache'] = str(root / 'cache')
    (root / 'empty.npmrc').write_text('')
    (root / 'empty-global.npmrc').write_text('')

    def normalize(value):
        return value.replace(str(root), '{run-root}').replace(str(node), '{node}').replace(str(npm), '{npm-cli}')

    def run(command, cwd, expected=0):
        result = subprocess.run([str(x) for x in command], cwd=cwd, env=env,
                                capture_output=True, text=True, timeout=60)
        report['runs'].append({
            'command': [normalize(str(x)) for x in command],
            'cwd': normalize(str(cwd)), 'exit_code': result.returncode,
            'stdout': normalize(result.stdout), 'stderr': normalize(result.stderr),
        })
        assert result.returncode == expected, report['runs'][-1]
        return result.stdout

    report['node'] = run([node, '--version'], root).strip()
    report['npm'] = run([node, npm, '--version'], root).strip()
    assert report['node'] == 'v22.22.0', report['node']
    assert report['npm'] == '10.9.4', report['npm']
    for layout in ('ancestor', 'sibling'):
        for template in (source / 'fixtures' / layout).rglob('*'):
            if not template.is_file():
                continue
            target = root / layout / template.relative_to(source / 'fixtures' / layout)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(template.read_text().replace('__ANCESTOR_ROOT__', str(root / 'ancestor'))
                              .replace('__SIBLING_ROOT__', str(root / 'sibling')))
        # Historical locks are retained as evidence; fresh installation generates a new lock.
        (root / layout / 'package-lock.json').unlink()

    tarballs = root / 'ancestor' / 'tarballs'
    tarballs.mkdir()
    for package in ('mutable', 'server', 'web', 'cli'):
        run([node, npm, 'pack', '--offline', '--ignore-scripts', '--pack-destination', tarballs],
            root / 'ancestor' / 'fixtures' / package)
    install_flags = ['--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--install-strategy=nested']
    for layout in ('sibling', 'ancestor'):
        cwd = root / layout
        run([node, npm, 'install', *install_flags], cwd)
        for stage in ('install', 'clean-ci'):
            if stage == 'clean-ci':
                for modules in sorted(cwd.rglob('node_modules'), key=lambda p: len(p.parts), reverse=True):
                    if modules.exists():
                        shutil.rmtree(modules)
                run([node, npm, 'ci', *install_flags], cwd)
            for order in ('forward', 'reverse'):
                result = run([node, 'backend/probe.mjs', order], cwd, expected=0 if layout == 'sibling' else 1)
                report['runs'][-1].update({'layout': layout, 'stage': stage, 'order': order})
                if layout == 'sibling':
                    proof = json.loads(result)
                    assert proof['separateInstances'] and proof['sameFacetIdentity'] and proof['privateImportRejected']
                    assert proof['versions'] == {'server': '0.6.0', 'web': '0.5.47', 'cli': '0.5.46'}
                else:
                    failure = report['runs'][-1]['stderr']
                    assert "ERR_MODULE_NOT_FOUND" in failure and "@probe/timezone" in failure, failure
    report['result'] = 'passed'
    report['limitations'] = [
        'Synthetic timezone/mutable packages; no actual Moment/React/native/browser/image parity.',
        'No install scripts run; ignore-scripts is fixture isolation, not production install policy.',
        'Ancestor case is the recovered local-link ancestor/facet variant; other historical variants are not certified.',
    ]
print(json.dumps(report, indent=2))
