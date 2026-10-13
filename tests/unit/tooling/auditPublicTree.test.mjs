import { describe, it, expect } from 'vitest';
import { auditPaths, auditContent, isProbablyBinary } from '../../../scripts/audit-public-tree.mjs';

describe('auditPaths', () => {
  it('flags internal docs folders, build junk and scratch files', () => {
    const v = auditPaths([
      '__docs/_wip/plans/x.md',
      '__docs/superpowers/specs/y.md',
      '__docs/_archive/z.md',
      '__docs/plans/p.md',
      '__docs/notes/n.txt',
      '_extensions/playback-hub/__pycache__/web.cpython-313.pyc',
      '_extensions/portal-keys/app/shell-api/bin/main/A.class',
      '_extensions/portal-keys/app/build/reports/problems/problems-report.html',
      'cli/_tmp_plex_poll.mjs',
      '__app_modules/learning/piano/cli/_proto-graph.mjs',
      'docker/nginx/logs.kckern.net.conf',
    ]);
    expect(v.map((x) => x.path).sort()).toHaveLength(11);
  });

  it('does not flag public files that merely contain the same words', () => {
    expect(auditPaths([
      '__docs/reference/school/README.md',
      '__app_modules/money/finance/server/plans/BudgetPlan.mjs',
      'scripts/audit-public-tree.mjs',
      '__docs/runbooks/dev-server.md',
    ])).toEqual([]);
  });
});

describe('auditContent', () => {
  it('flags private infrastructure markers inside its scope, with the line number', () => {
    const v = auditContent('scripts/x.sh', 'echo ok\nssh homeserver.local uptime\n');
    expect(v).toEqual([{ rule: 'private-host', path: 'scripts/x.sh', line: 2 }]);
  });

  it('flags host paths, personal domains and LAN addresses', () => {
    const text = '/media/kckern/Media\nhttps://logs.kckern.net\n10.0.0.92:2323\n192.168.1.4';
    const rules = auditContent('docker/a.conf', text).map((x) => x.rule);
    expect(rules).toEqual(['host-path', 'personal-domain', 'lan-address', 'lan-address']);
  });

  it('ignores files outside the rule scope (widened by later sub-projects)', () => {
    expect(auditContent('__app_modules/x/cli/a.mjs', 'ssh homeserver.local')).toEqual([]);
  });

  it('allows documentation-reserved example ranges', () => {
    expect(auditContent('scripts/x.sh', 'curl http://192.0.2.10/\ncurl http://10.0.0.0/8')).toEqual([]);
  });

  it('exempts the audit script itself from content rules (it documents markers)', () => {
    expect(auditContent('scripts/audit-public-tree.mjs', 'ssh homeserver.local\nkckern.net')).toEqual([]);
  });
});

describe('isProbablyBinary', () => {
  it('skips by extension and by NUL byte', () => {
    expect(isProbablyBinary('a.png', Buffer.from('x'))).toBe(true);
    expect(isProbablyBinary('a.txt', Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
    expect(isProbablyBinary('a.md', Buffer.from('hello'))).toBe(false);
  });
});

describe('audit CLI cwd', () => {
  it('audits the whole repo even when invoked from a subdirectory', async () => {
    const { execFileSync } = await import('node:child_process');
    const script = new URL('../../../scripts/audit-public-tree.mjs', import.meta.url).pathname;
    const root = new URL('../../../', import.meta.url).pathname;
    const scanned = (cwd) => {
      const out = execFileSync('node', [script], { cwd, encoding: 'utf8' });
      return Number(/scanned (\d+) tracked files/.exec(out)?.[1]);
    };
    const fromRoot = scanned(root);
    expect(fromRoot).toBeGreaterThan(1000);
    expect(scanned(root + 'scripts')).toBe(fromRoot);
  });
});

import { auditAssets, matchesAllowlist, parseAllowlist, LARGE_TEXT_BYTES } from '../../../scripts/audit-public-tree.mjs';

describe('auditAssets (binary + large-text gate)', () => {
  const allow = parseAllowlist({
    keep: ['frontend/public/icon-192.png', 'frontend/public/fonts/surround/*.woff2'],
    largeText: ['package-lock.json'],
    pending: [{ path: 'frontend/public/webaudiofont/*.js', task: 'C3' }],
  });
  const bin = (path) => ({ path, binary: true, bytes: 10 });
  const txt = (path, bytes) => ({ path, binary: false, bytes });

  it('flags a binary that is on no list', () => {
    expect(auditAssets([bin('docs/new.png')], allow)).toEqual([{ rule: 'binary-not-allowlisted', path: 'docs/new.png' }]);
  });

  it('flags a text file of 100 KB or more that is on no list', () => {
    expect(LARGE_TEXT_BYTES).toBe(100 * 1024);
    expect(auditAssets([txt('a/big.json', LARGE_TEXT_BYTES)], allow))
      .toEqual([{ rule: 'large-text-not-allowlisted', path: 'a/big.json' }]);
    expect(auditAssets([txt('a/ok.json', LARGE_TEXT_BYTES - 1)], allow)).toEqual([]);
  });

  it('accepts exact paths and globs from keep, largeText and pending', () => {
    expect(auditAssets([
      bin('frontend/public/icon-192.png'),
      bin('frontend/public/fonts/surround/a.woff2'),
      txt('package-lock.json', 999999),
      txt('frontend/public/webaudiofont/0000_x.js', 999999),
    ], allow)).toEqual([]);
  });

  it('matches by path, never by extension: a new png elsewhere still fails', () => {
    expect(auditAssets([bin('frontend/public/other.png'), bin('frontend/public/fonts/surround/deep/a.woff2')], allow)).toHaveLength(2);
  });

  it('keeps a binary allowlisted only under largeText flagged (lists are kind-specific)', () => {
    expect(auditAssets([bin('package-lock.json')], allow)).toHaveLength(1);
  });

  it('supports ** across directories', () => {
    expect(matchesAllowlist('a/b/c/d.png', ['a/**'])).toBe(true);
    expect(matchesAllowlist('a/b.png', ['a/*.png'])).toBe(true);
    expect(matchesAllowlist('a/b/c.png', ['a/*.png'])).toBe(false);
  });

  it('rejects a malformed allowlist (pending without a task id)', () => {
    expect(() => parseAllowlist({ keep: [], largeText: [], pending: [{ path: 'x' }] })).toThrow(/task/);
  });
});
