#!/usr/bin/env node
// Public-tree audit: the machine-checked definition of "nothing private in the
// repo". Path rules forbid whole files; content rules forbid markers inside a
// SCOPE of path prefixes — each open-source sub-project widens a scope as it
// cleans that area, so the audit is green at every step and "done" is a rule,
// not a judgement. Exit 1 on any violation.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SELF = 'scripts/audit-public-tree.mjs';
const INTERNAL_DOCS = /^__docs\/(_wip|_archive|superpowers|plans|notes|roadmap|marketing)\//;
const BUILD_JUNK = /(^|\/)(__pycache__\/|.*\.pyc$|.*\.class$|build\/reports\/)/;
const SCRATCH = /(^|\/)(_tmp_[^/]*|_proto-[^/]*)$/;
const PRIVATE_FILES = new Set(['docker/nginx/logs.kckern.net.conf']);

export const PATH_RULES = [
  { id: 'internal-docs', test: (p) => INTERNAL_DOCS.test(p), why: 'internal docs live in DaylightStation-ops' },
  { id: 'build-junk', test: (p) => BUILD_JUNK.test(p), why: 'build output is not source' },
  { id: 'scratch-file', test: (p) => SCRATCH.test(p), why: '_tmp_/_proto- files are scratch' },
  { id: 'private-file', test: (p) => PRIVATE_FILES.has(p), why: 'private infrastructure config' },
];

// Sub-project A scope: tooling, config and root docs. B and F extend it.
const A_SCOPE = ['.claude/', 'docker/', 'scripts/', '.github/', '.githooks/',
  'package.json', 'Readme.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md'];

export const CONTENT_RULES = [
  { id: 'private-host', re: /\b(homeserver\.local|kckern-server|kckern-macbook)\b/, scope: A_SCOPE, why: 'private hostname' },
  { id: 'host-path', re: /\/(Users|media|home)\/kckern\b/, scope: A_SCOPE, why: 'absolute host path' },
  { id: 'personal-domain', re: /\b[\w.-]*kckern\.(net|com|info)\b/, scope: A_SCOPE, why: 'personal domain' },
  // RFC1918 hosts, but not network/example notations (x.x.x.0, /8 CIDR) or RFC5737 doc ranges.
  { id: 'lan-address', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.(?!0\b)\d{1,3}|192\.168\.\d{1,3}\.(?!0\b)\d{1,3})\b(?!\/)/, scope: A_SCOPE, why: 'LAN address' },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|wasm|woff2?|ttf|otf|mp[34]|webm|wav|mid|sf2|ogg|flac|m4a|mov|bmp|ttc|sqlite|a|o|so|jar|class|pyc)$/i;

export function isProbablyBinary(path, buf) {
  if (BINARY_EXT.test(path)) return true;
  return buf.subarray(0, 8000).includes(0);
}

export function auditPaths(paths) {
  const out = [];
  for (const path of paths) {
    for (const rule of PATH_RULES) if (rule.test(path)) out.push({ rule: rule.id, path });
  }
  return out;
}

const inScope = (path, scope) => scope.some((s) => (s.endsWith('/') ? path.startsWith(s) : path === s));

export function auditContent(path, text) {
  // Exempt the audit script itself from content rules (it documents the markers).
  if (path === SELF) return [];
  const out = [];
  const rules = CONTENT_RULES.filter((r) => inScope(path, r.scope));
  if (!rules.length) return out;
  text.split('\n').forEach((line, i) => {
    for (const rule of rules) if (rule.re.test(line)) out.push({ rule: rule.id, path, line: i + 1 });
  });
  return out;
}

// ---- Binary / large-text gate -------------------------------------------------
// Third-party and household binaries do not belong in the repo (see
// assets.manifest.yml + npm run install:assets). Every tracked binary, and every
// text file of 100 KB or more, must be named in scripts/public-tree-allowlist.yml
// by exact path or glob — never by extension, so a new PNG anywhere fails.
//   keep:      binaries that legitimately stay (fonts, app icons, tiny fixtures)
//   largeText: big text that legitimately stays (lockfiles, authored sources)
//   pending:   still tracked, scheduled for removal; each tagged with its task id
export const LARGE_TEXT_BYTES = 100 * 1024;
const ALLOWLIST_PATH = 'scripts/public-tree-allowlist.yml';

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAllowlist(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

export function parseAllowlist(raw) {
  const keep = raw?.keep ?? [];
  const largeText = raw?.largeText ?? [];
  const pending = (raw?.pending ?? []).map((p) => {
    if (!p?.path) throw new Error('allowlist pending entry needs a path');
    if (!p.task) throw new Error(`allowlist pending entry ${p.path} needs a task id`);
    return p;
  });
  return { keep, largeText, pending: pending.map((p) => p.path), pendingEntries: pending };
}

export function auditAssets(entries, allow) {
  const out = [];
  for (const { path, binary, bytes } of entries) {
    if (binary) {
      if (!matchesAllowlist(path, [...allow.keep, ...allow.pending])) out.push({ rule: 'binary-not-allowlisted', path });
    } else if (bytes >= LARGE_TEXT_BYTES) {
      if (!matchesAllowlist(path, [...allow.keep, ...allow.largeText, ...allow.pending])) out.push({ rule: 'large-text-not-allowlisted', path });
    }
  }
  return out;
}

// An unreadable tracked file (dangling symlink, permissions) must not slip past the gate.
// A symlink whose target resolves is not content itself (the target is tracked on its
// own path, or is a directory of tracked files): it is skipped, not read.
export function readTracked(path, { read = readFileSync, lstat = lstatSync, stat = statSync } = {}) {
  try {
    if (lstat(path).isSymbolicLink()) {
      stat(path); // throws when dangling
      return { symlink: true };
    }
    return { buf: read(path) };
  } catch {
    return { finding: { rule: 'unreadable-tracked-file', path } };
  }
}

function main() {
  // git ls-files prints cwd-relative paths; every anchored rule assumes repo root.
  process.chdir(resolve(fileURLToPath(import.meta.url), '..', '..'));
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).split('\0').filter(Boolean);
  console.log(`audit:public scanned ${files.length} tracked files`);
  const violations = auditPaths(files);
  const allow = parseAllowlist(yaml.load(readFileSync(ALLOWLIST_PATH, 'utf8')));
  const assetEntries = [];
  for (const path of files) {
    const { buf, finding, symlink } = readTracked(path);
    if (finding) { violations.push(finding); continue; }
    if (symlink) continue;
    const binary = isProbablyBinary(path, buf);
    assetEntries.push({ path, binary, bytes: statSync(path).size });
    if (binary) continue;
    violations.push(...auditContent(path, buf.toString('utf8')));
  }
  violations.push(...auditAssets(assetEntries, allow));
  if (allow.pendingEntries.length) console.log(`audit:public ${allow.pendingEntries.length} pending allowlist entr${allow.pendingEntries.length === 1 ? 'y' : 'ies'} (assets awaiting removal)`);
  for (const v of violations) console.log(`${v.rule}\t${v.path}${v.line ? `:${v.line}` : ''}`);
  console.log(violations.length ? `audit:public FAILED — ${violations.length} violation(s)` : 'audit:public OK');
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
