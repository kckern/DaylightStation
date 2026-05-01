import { describe, it, expect, beforeEach } from 'vitest';
import { HealthArchiveIngestion } from '#domains/health/services/HealthArchiveIngestion.mjs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Build a mock filesystem adapter backed by an in-memory map of
 * absolute path -> { type: 'dir' | 'file', content?: Buffer, mtime?: Date }.
 *
 * Tracks every write/mkdir for assertion in dry-run scenarios.
 */
function createMockFs(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  const mkdirs = [];

  const enoent = (p) => {
    const err = new Error(`ENOENT: no such file or directory, ${p}`);
    err.code = 'ENOENT';
    return err;
  };

  return {
    _store: store,
    _writes: writes,
    _mkdirs: mkdirs,

    async stat(p) {
      const node = store.get(p);
      if (!node) throw enoent(p);
      return {
        isDirectory: () => node.type === 'dir',
        isFile: () => node.type === 'file',
        size: node.content ? node.content.length : 0,
        mtime: node.mtime || new Date(0),
        mtimeMs: node.mtime ? node.mtime.getTime() : 0,
      };
    },

    async readFile(p) {
      const node = store.get(p);
      if (!node) throw enoent(p);
      if (node.type !== 'file') throw new Error(`EISDIR: ${p}`);
      return node.content;
    },

    async writeFile(p, content) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      writes.push({ path: p, content: buf });
      store.set(p, { type: 'file', content: buf, mtime: new Date() });
    },

    async mkdir(p, opts) {
      mkdirs.push({ path: p, opts });
      // Mimic recursive creation behaviour
      const segments = p.split(path.sep).filter(Boolean);
      let acc = path.isAbsolute(p) ? path.sep : '';
      for (const seg of segments) {
        acc = acc === path.sep ? path.join(path.sep, seg) : path.join(acc, seg);
        if (!store.has(acc)) {
          store.set(acc, { type: 'dir' });
        }
      }
    },

    async readdir(p, opts) {
      const node = store.get(p);
      if (!node) throw enoent(p);
      if (node.type !== 'dir') throw new Error(`ENOTDIR: ${p}`);
      const prefix = p.endsWith(path.sep) ? p : p + path.sep;
      const children = [];
      for (const key of store.keys()) {
        if (key === p) continue;
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes(path.sep)) continue; // grandchildren only listed via recursion
        const childNode = store.get(key);
        if (opts && opts.withFileTypes) {
          children.push({
            name: rest,
            isDirectory: () => childNode.type === 'dir',
            isFile: () => childNode.type === 'file',
          });
        } else {
          children.push(rest);
        }
      }
      return children;
    },
  };
}

function hashOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('HealthArchiveIngestion', () => {
  const SRC = '/src/scans';
  const DEST = '/dest/scans';

  let fs;
  let svc;

  beforeEach(() => {
    fs = createMockFs({
      '/src': { type: 'dir' },
      [SRC]: { type: 'dir' },
      [`${SRC}/2024-01-01.json`]: {
        type: 'file',
        content: Buffer.from('{"hello":"world"}'),
        mtime: new Date('2026-01-01T00:00:00Z'),
      },
      [`${SRC}/sub`]: { type: 'dir' },
      [`${SRC}/sub/2024-02-01.json`]: {
        type: 'file',
        content: Buffer.from('{"a":1}'),
        mtime: new Date('2026-02-01T00:00:00Z'),
      },
      '/dest': { type: 'dir' },
    });
    svc = new HealthArchiveIngestion({ fs });
  });

  it('copies new files when destination does not exist', async () => {
    const report = await svc.ingest({
      userId: 'test-user',
      category: 'scans',
      sourcePath: SRC,
      destPath: DEST,
    });

    expect(report.copied.length).toBe(2);
    expect(report.skipped.length).toBe(0);
    expect(report.failed.length).toBe(0);

    // Both files written under DEST preserving relative structure.
    const writtenPaths = fs._writes.map((w) => w.path).sort();
    expect(writtenPaths).toEqual([
      `${DEST}/2024-01-01.json`,
      `${DEST}/sub/2024-02-01.json`,
    ]);
  });

  it('skips files whose mtime + content-hash match existing destination', async () => {
    // Pre-populate destination with identical content + same-or-newer mtime.
    const srcContent = Buffer.from('{"hello":"world"}');
    const subContent = Buffer.from('{"a":1}');
    fs._store.set(DEST, { type: 'dir' });
    fs._store.set(`${DEST}/2024-01-01.json`, {
      type: 'file',
      content: srcContent,
      mtime: new Date('2026-01-01T00:00:00Z'),
    });
    fs._store.set(`${DEST}/sub`, { type: 'dir' });
    fs._store.set(`${DEST}/sub/2024-02-01.json`, {
      type: 'file',
      content: subContent,
      mtime: new Date('2026-02-01T00:00:00Z'),
    });

    const report = await svc.ingest({
      userId: 'test-user',
      category: 'scans',
      sourcePath: SRC,
      destPath: DEST,
    });

    expect(report.copied.length).toBe(0);
    expect(report.skipped.length).toBe(2);
    expect(report.failed.length).toBe(0);
    expect(fs._writes.length).toBe(0);
  });

  it('hard-fails when source path matches exclusion (email|chat|finance|journal|search|calendar|social)', async () => {
    const cases = [
      '/external/email/2024',
      '/external/chat/logs',
      '/external/finance/banking',
      '/external/journal/entries',
      '/external/search-history/2024',
      '/external/calendar/events',
      '/external/social/posts',
    ];
    for (const p of cases) {
      await expect(
        svc.ingest({ userId: 'test-user', category: 'scans', sourcePath: p, destPath: DEST }),
      ).rejects.toThrow(/exclusion/i);
    }
  });

  it('respects whitelist categories — rejects unknown category', async () => {
    await expect(
      svc.ingest({
        userId: 'test-user',
        category: 'email',
        sourcePath: SRC,
        destPath: DEST,
      }),
    ).rejects.toThrow(/category/i);
  });

  it('dry-run reports planned ops without writing', async () => {
    const report = await svc.ingest({
      userId: 'test-user',
      category: 'scans',
      sourcePath: SRC,
      destPath: DEST,
      dryRun: true,
    });

    expect(report.copied.length).toBe(2);
    expect(fs._writes.length).toBe(0);
    expect(fs._mkdirs.length).toBe(0);
  });

  it('returns structured report with copied/skipped/failed counts', async () => {
    // One file already up-to-date -> skipped; another new -> copied.
    const srcContent = Buffer.from('{"hello":"world"}');
    fs._store.set(DEST, { type: 'dir' });
    fs._store.set(`${DEST}/2024-01-01.json`, {
      type: 'file',
      content: srcContent,
      mtime: new Date('2026-01-01T00:00:00Z'),
    });

    const report = await svc.ingest({
      userId: 'test-user',
      category: 'scans',
      sourcePath: SRC,
      destPath: DEST,
    });

    expect(report).toEqual(
      expect.objectContaining({
        copied: expect.any(Array),
        skipped: expect.any(Array),
        failed: expect.any(Array),
      }),
    );
    expect(report.copied.length).toBe(1);
    expect(report.skipped.length).toBe(1);
    expect(report.failed.length).toBe(0);
    expect(report.copied).toContain('sub/2024-02-01.json');
    expect(report.skipped).toContain('2024-01-01.json');
  });
});
