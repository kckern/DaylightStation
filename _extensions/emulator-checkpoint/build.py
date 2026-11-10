#!/usr/bin/env python3
"""Build side-by-side protected EmulatorJS 4.2.x cores (never installs them).

Activate Emscripten 3.1.74 first. Pass an empty scratch directory and an output
directory. Source pins follow the forks' first-parent history before the shipped
June 14 2025 build; do not substitute upstream commits with newer timestamps.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

RETROARCH = '31ccb892522a7b0e914dc71731f0834c6495a218'
CORES = {
    'gambatte': ('gambatte-libretro', '4ac2b30d196a842061d6b333ea5e523a7c1a7cce', 'COPYING'),
    'mgba': ('mgba', '1d9dbb1dc8d51ed744fe6be82183f7f5076e549d', 'LICENSE'),
    'genesis_plus_gx': ('Genesis-Plus-GX', '594cdf3a666546f65f46391c3615ac5e9550bfc1', 'LICENSE.txt'),
}


def run(args, cwd):
    subprocess.run(args, cwd=cwd, check=True)


def checkout(root, name, repo, pin):
    path = root / name
    if not path.exists():
        run(['git', 'clone', '--filter=blob:none', '--no-checkout',
             f'https://github.com/EmulatorJS/{repo}.git', name], root)
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=path, text=True).strip()
    if actual != pin:
        run(['git', 'checkout', pin], path)
    return path


def main():
    os.environ['BINARYEN_CORES'] = '2'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scratch', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--core', choices=list(CORES))
    args = parser.parse_args()
    version = subprocess.check_output(['emcc', '--version'], text=True)
    if '3.1.74' not in version.splitlines()[0]:
        raise SystemExit('Activate the pinned Emscripten 3.1.74 SDK first')
    root, output = args.scratch.resolve(), args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    ra = checkout(root, 'RetroArch', 'RetroArch', RETROARCH)
    patch = Path(__file__).with_name('restore-contract.patch').resolve()
    # A scratch checkout may already contain exactly our patch after a failed build.
    applied = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=ra).returncode == 0
    if not applied:
        run(['git', 'apply', str(patch)], ra)
    for name, (repo, pin, license_file) in CORES.items():
        if args.core and args.core != name:
            continue
        source = checkout(root, name, repo, pin)
        run(['emmake', 'make', '-f', 'Makefile.libretro', 'clean'], source)
        run(['emmake', 'make', '-f', 'Makefile.libretro', '-j2', 'platform=emscripten'], source)
        archive = source / f'{name}_libretro_emscripten.bc'
        for variant in ['wasm', 'legacy-wasm']:
            shutil.copyfile(archive, ra / 'libretro_emscripten.bc')
            run(['emmake', 'make', '-f', 'Makefile.emulatorjs', 'clean'], ra)
            run(['emmake', 'make', '-f', 'Makefile.emulatorjs', '-j2', 'HAVE_CHD=1',
                 'HAVE_THREADS=0', 'PTHREAD_POOL_SIZE=0', 'ASYNC=1',
                 f'HAVE_OPENGLES3={0 if variant == "legacy-wasm" else 1}',
                 'STACK_SIZE=4194304',
                 f'INITIAL_HEAP={536870912 if name == "genesis_plus_gx" else 134217728}',
                 f'TARGET={name}_libretro.js'], ra)
            provenance = {'contract': 1, 'emscripten': '3.1.74', 'retroarch': RETROARCH,
                          'core': name, 'source': pin, 'variant': variant,
                          'patchSha256': hashlib.sha256(patch.read_bytes()).hexdigest()}
            dest = output / f'{name}-{variant}.protected-v1.data'
            # EJS checkCompression supports ZIP by magic, independent of .data suffix.
            with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
                for suffix in ['js', 'wasm']:
                    filename = f'{name}_libretro.{suffix}'
                    bundle.write(ra / filename, filename)
                bundle.write(source / license_file, 'license.txt')
                bundle.write(ra / 'COPYING', 'retroarch-license.txt')
                bundle.writestr('build.json', json.dumps({'version': '2.0.2', 'minimumEJSVersion': '4.2.2'}))
                bundle.writestr('core.json', json.dumps(json.loads(Path(__file__).with_name('cores.json').read_text())[name]))
                bundle.writestr('checkpoint-build.json', json.dumps(provenance, indent=2))
            provenance['bundleSha256'] = hashlib.sha256(dest.read_bytes()).hexdigest()
            dest.with_suffix('.json').write_text(json.dumps(provenance, indent=2) + '\n')
            print('BUILT', dest, provenance['bundleSha256'], flush=True)


if __name__ == '__main__':
    main()
