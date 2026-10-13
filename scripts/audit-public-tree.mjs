#!/usr/bin/env node
// Public-tree audit: the machine-checked definition of "nothing private in the
// repo". Path rules forbid whole files; content rules forbid markers inside a
// SCOPE of path prefixes — each open-source sub-project widens a scope as it
// cleans that area, so the audit is green at every step and "done" is a rule,
// not a judgement. Exit 1 on any violation.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|wasm|woff2?|ttf|otf|mp[34]|webm|wav|mid|sf2|a|o|so|jar|class|pyc)$/i;

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

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).split('\0').filter(Boolean);
  const violations = auditPaths(files);
  for (const path of files) {
    let buf;
    try { buf = readFileSync(path); } catch { continue; }
    if (isProbablyBinary(path, buf)) continue;
    violations.push(...auditContent(path, buf.toString('utf8')));
  }
  for (const v of violations) console.log(`${v.rule}\t${v.path}${v.line ? `:${v.line}` : ''}`);
  console.log(violations.length ? `audit:public FAILED — ${violations.length} violation(s)` : 'audit:public OK');
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
