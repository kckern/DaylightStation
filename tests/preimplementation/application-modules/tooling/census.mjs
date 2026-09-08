/** Read-only source census; only generated audit outputs are writable. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
export const packet = path.join(root, 'docs/_wip/audits/2026-09-05-application-module-preimplementation');
const planPath = 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md';
const git = (...args) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
});
const hash = data => createHash('sha256').update(data).digest('hex');
const allowed = name => name === planPath || name.startsWith('docs/_wip/audits/2026-09-05-application-module-preimplementation/') || name.startsWith('tests/preimplementation/application-modules/');
export function emit(name, data) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error('Invalid artifact name');
  fs.mkdirSync(packet, {
    recursive: true
  });
  fs.writeFileSync(path.join(packet, name), JSON.stringify(data, null, 2) + '\n');
}
export function tracked() {
  return git('ls-files', '--stage', '-z').split('\0').filter(Boolean).map(line => {
    const [meta, name] = line.split('\t');
    const [mode, blob, stage] = meta.split(' ');
    if (stage !== '0') throw new Error('Unmerged index: ' + name);
    const full = path.join(root, name);
    const bytes = mode === '120000' ? Buffer.from(fs.readlinkSync(full)) : fs.readFileSync(full);
    return {
      id: 'SRC-' + hash(name).slice(0, 16),
      path: name,
      mode,
      gitBlob: blob,
      sha256: hash(bytes),
      bytes: bytes.length,
      ...(mode === '120000' ? {
        symlinkTarget: bytes.toString(),
        disposition: 'canonical alias; do not duplicate target'
      } : {}),
      protected: !allowed(name)
    };
  });
}
function sourceClass(name) {
  if (name.startsWith('docs/')) return {
    role: 'documentation',
    owner: 'documentation',
    review: 'scope classification only'
  };
  if (/\.(test|spec)\./.test(name) || name.startsWith('tests/')) return {
    role: 'test',
    owner: null,
    review: 'runner and semantic owner inspection required'
  };
  const backend = name.match(/^backend\/src\/(\d_[^/]+)\/([^/]+)/);
  if (backend) return {
    role: backend[1],
    contextCandidate: ['2_domains', '3_applications'].includes(backend[1]) ? backend[2] : null,
    owner: null,
    review: 'semantic classification required; current location is not authority'
  };
  return {
    role: name.startsWith('frontend/') ? 'browser-or-build' : name.startsWith('_extensions/') ? 'external-runtime' : 'source-or-resource',
    owner: null,
    review: 'semantic classification required'
  };
}
function tasks() {
  const text = fs.readFileSync(path.join(root, planPath), 'utf8');
  return [...text.matchAll(/^- \[([ x])\] \*\*(PRE-[\d.]+) — (.+)$/gm)].map(([, check, id, title]) => ({
    id,
    title: title.replace(/\*\*/g, ''),
    status: check === 'x' ? 'complete' : 'not-started',
    assignee: 'investigation-lead',
    reviewer: 'self-review; not independent review',
    prerequisiteIds: [],
    baseline: git('rev-parse', 'HEAD').trim(),
    evidenceIds: [],
    decisionIds: [],
    blockers: [],
    completedAt: null,
    invalidatedBy: []
  }));
}
function inventory() {
  if (git('rev-parse', '--show-toplevel').trim() !== root || !fs.existsSync(path.join(root, planPath))) throw new Error('Census must target its own worktree root');
  if (fs.existsSync(path.join(packet, 'baseline.json'))) throw new Error('Baseline exists; use verify, never overwrite evidence');
  const files = tracked();
  const head = git('rev-parse', 'HEAD').trim();
  const roots = {};
  for (const file of files) roots[file.path.split('/')[0]] = (roots[file.path.split('/')[0]] || 0) + 1;
  const folderCount = prefix => new Set(files.filter(f => f.path.startsWith(prefix)).map(f => f.path.slice(prefix.length).split('/')[0])).size;
  emit('source-ledger.json', {
    schema: 'daylight.preimplementation.source/v1',
    baseline: head,
    method: 'git ls-files --stage -z; lstat/readlink semantics; regular-file SHA-256',
    total: files.length,
    counts: {
      roots,
      applications: folderCount('backend/src/3_applications/'),
      domains: folderCount('backend/src/2_domains/'),
      frontendModules: folderCount('frontend/src/modules/'),
      extensions: folderCount('_extensions/')
    },
    files: files.map(file => ({
      ...file,
      ...sourceClass(file.path)
    }))
  });
  const inputs = files.filter(f => /(^|\/)(package(-lock)?\.json|[^/]*config\.[^/]+|Dockerfile|\.dockerignore|\.npmrc)$/.test(f.path));
  emit('baseline.json', {
    schema: 'daylight.preimplementation.baseline/v1',
    capturedAt: new Date().toISOString(),
    revision: head,
    planningSource: '2144f762a37408b906efc0e359dc4649078d5ab4',
    branch: git('branch', '--show-current').trim(),
    initialTrackedStatus: git('status', '--porcelain=v1', '-uno').trim().split('\n').filter(Boolean),
    authorizedChangesAtCapture: [planPath],
    node: process.version,
    npm: execFileSync('npm', ['--version'], {
      encoding: 'utf8'
    }).trim(),
    platform: process.platform,
    architecture: process.arch,
    freshness: {
      originAndDeployedSource: '2144f762a37408b906efc0e359dc4649078d5ab4',
      checked: '2026-09-05',
      evidence: 'RUN-BOOTSTRAP',
      deployedTrackedWorktree: 'clean at read-only inspection',
      deployedImageDigest: null,
      limit: 'source checkout identity is not running-image provenance'
    },
    protectedCount: files.filter(f => f.protected).length,
    protectedDigest: hash(JSON.stringify(files.filter(f => f.protected).map(f => [f.path, f.mode, f.sha256]))),
    inputs,
    ignoredRequirements: {
      state: 'not-yet-inspected',
      note: 'Do not read/copy private mounts or local secrets; inspect build declarations instead.'
    }
  });
  if (!fs.existsSync(path.join(packet, 'task-status.json'))) emit('task-status.json', {
    schema: 'daylight.preimplementation.tasks/v1',
    items: tasks()
  });
  process.stdout.write(JSON.stringify({
    revision: head,
    files: files.length,
    protected: files.filter(f => f.protected).length,
    output: path.relative(root, packet)
  }) + '\n');
}
function verify() {
  const old = JSON.parse(fs.readFileSync(path.join(packet, 'source-ledger.json')));
  const actual = new Map(tracked().map(f => [f.path, f]));
  const changed = old.files.filter(f => f.protected && (!actual.has(f.path) || actual.get(f.path).sha256 !== f.sha256 || actual.get(f.path).mode !== f.mode)).map(f => f.path);
  const outside = git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean).map(line => line.slice(3)).filter(name => !allowed(name));
  process.stdout.write(JSON.stringify({
    protectedChanged: changed,
    changesOutsideAllowlist: outside
  }) + '\n');
  if (changed.length || outside.length) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'capture') inventory();else if (process.argv[2] === 'verify') verify();else throw new Error('Usage: node census.mjs capture|verify');
}
