// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWriteAuditor } from '../../../cli/_writeAudit.mjs';

const FALLBACK_DIR = '/tmp/dscli-cli-transcripts';

describe('createWriteAuditor', () => {
  let tmpRoot;
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dscli-audit-'));
    // Clean fallback dir between tests so we can detect when it's used
    await fs.rm(FALLBACK_DIR, { recursive: true, force: true });
  });
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.rm(FALLBACK_DIR, { recursive: true, force: true });
  });

  it('appends a JSON line per call', async () => {
    const audit = createWriteAuditor({ baseDir: tmpRoot, dateFn: () => '2026-05-03' });
    await audit.log({ command: 'ha', action: 'toggle', args: { entity_id: 'light.x', state: 'on' }, result: { ok: true } });
    await audit.log({ command: 'memory', action: 'write', args: { key: 'notes' }, result: { ok: true } });

    const file = path.join(tmpRoot, '2026-05-03.ndjson');
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const e1 = JSON.parse(lines[0]);
    expect(e1.command).toBe('ha');
    expect(e1.action).toBe('toggle');
    expect(e1.args.entity_id).toBe('light.x');
    expect(e1.timestamp).toMatch(/^20\d\d-/);
    expect(typeof e1.pid).toBe('number');
  });

  it('redacts known sensitive arg keys', async () => {
    const audit = createWriteAuditor({ baseDir: tmpRoot, dateFn: () => '2026-05-03' });
    await audit.log({ command: 'system', action: 'reload', args: { token: 'secret-xyz', other: 'visible' }, result: { ok: true } });

    const file = path.join(tmpRoot, '2026-05-03.ndjson');
    const entry = JSON.parse((await fs.readFile(file, 'utf8')).trim());
    expect(entry.args.token).toBe('[redacted]');
    expect(entry.args.other).toBe('visible');
  });

  it('redacts nested sensitive keys', async () => {
    const audit = createWriteAuditor({ baseDir: tmpRoot, dateFn: () => '2026-05-03' });
    await audit.log({ command: 'x', action: 'y', args: { headers: { authorization: 'Bearer xyz' } }, result: {} });
    const entry = JSON.parse((await fs.readFile(path.join(tmpRoot, '2026-05-03.ndjson'), 'utf8')).trim());
    expect(entry.args.headers.authorization).toBe('[redacted]');
  });

  it('falls back to /tmp/dscli-cli-transcripts when primary path is unwritable', async () => {
    // Simulate an unwritable baseDir by creating a regular FILE where we'll
    // try to mkdir — fails with ENOTDIR immediately.
    const blockerFile = path.join(tmpRoot, 'blocker');
    await fs.writeFile(blockerFile, 'not a directory');
    const badDir = path.join(blockerFile, 'subdir');

    const audit = createWriteAuditor({ baseDir: badDir, dateFn: () => '2026-05-03' });
    await audit.log({ command: 'x', action: 'y', args: {}, result: { ok: true } });

    // Should have written to fallback instead
    const fallbackFile = path.join(FALLBACK_DIR, '2026-05-03.ndjson');
    const text = await fs.readFile(fallbackFile, 'utf8');
    const entry = JSON.parse(text.trim());
    expect(entry.command).toBe('x');
  });

  it('does not throw when primary fails (graceful)', async () => {
    // Even with primary unwritable, the auditor must not throw.
    const blockerFile = path.join(tmpRoot, 'blocker2');
    await fs.writeFile(blockerFile, 'not a directory');
    const badDir = path.join(blockerFile, 'subdir');

    const audit = createWriteAuditor({ baseDir: badDir, dateFn: () => '2026-05-03' });
    await expect(audit.log({ command: 'x', action: 'y', args: {}, result: {} })).resolves.toBeUndefined();
  });
});
