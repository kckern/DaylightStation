import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlSequenceStore } from './YamlSequenceStore.mjs';
import { ISequenceStore } from '#apps/content/ports/ISequenceStore.mjs';

let root;
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

function write(relPath, body) {
  const full = path.join(root, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  return full;
}

const FM100 = [
  'match: { contentId: plex:757556, title: FM100 }',
  'sequence:',
  '  head: 1',
  '  idents:',
  '    every: [3, 5]',
  '    pool:',
  '      - plex:757863',
  '',
].join('\n');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sequence-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('YamlSequenceStore', () => {
  it('implements the port', () => {
    expect(new YamlSequenceStore({ rootDir: root, logger: makeLogger() })).toBeInstanceOf(ISequenceStore);
  });

  it('indexes a sequence sidecar at any depth by match.contentId', () => {
    write('radio/salt-lake/fm100.yml', FM100);
    write('deep/a/b/c/x.yml', 'match: { contentId: plex:1 }\nsequence: { head: 2 }\n');
    const store = new YamlSequenceStore({ rootDir: root, logger: makeLogger() });
    expect(store.lookup('plex:757556')).toEqual({
      head: 1,
      idents: { every: [3, 5], pool: ['plex:757863'] },
    });
    expect(store.lookup('plex:1')).toEqual({ head: 2, idents: null });
    expect(store.lookup('plex:999')).toBeNull();
  });

  it('ignores files without a sequence block and reserved names', () => {
    write('classical/beethoven/eroica.yml', 'work: beethoven/x\nsurround: concert-hall\nmatch: { contentId: plex:663134 }\n');
    write('_surrounds/concert-hall.yml', 'id: concert-hall\nsequence: { head: 1 }\nmatch: { contentId: plex:5 }\n');
    write('radio/_drafts/x.yml', 'match: { contentId: plex:6 }\nsequence: { head: 1 }\n');
    write('radio/salt-lake/_x.yml', 'match: { contentId: plex:7 }\nsequence: { head: 1 }\n');
    const logger = makeLogger();
    const store = new YamlSequenceStore({ rootDir: root, logger });
    expect(store.lookup('plex:663134')).toBeNull();
    expect(store.lookup('plex:5')).toBeNull();
    expect(store.lookup('plex:6')).toBeNull();
    expect(store.lookup('plex:7')).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('station.sequence.indexed', { count: 0 });
  });

  it('warns on a sidecar with no contentId and on invalid fields', () => {
    write('radio/a.yml', 'sequence: { head: 1 }\n');
    write('radio/b.yml', 'match: { contentId: plex:2 }\nsequence: { head: nope }\n');
    const logger = makeLogger();
    const store = new YamlSequenceStore({ rootDir: root, logger });
    expect(logger.warn).toHaveBeenCalledWith('station.sequence.invalid', {
      file: path.join('radio', 'a.yml'), problems: ['missing-match-contentId'],
    });
    expect(logger.warn).toHaveBeenCalledWith('station.sequence.invalid', {
      file: path.join('radio', 'b.yml'), problems: ['head-invalid'],
    });
    // Invalid field falls back to the default rather than dropping the station.
    expect(store.lookup('plex:2')).toEqual({ head: 1, idents: null });
  });

  it('warns when two sidecars claim one contentId', () => {
    write('radio/a.yml', 'match: { contentId: plex:3 }\nsequence: { head: 1 }\n');
    write('radio/b.yml', 'match: { contentId: plex:3 }\nsequence: { head: 2 }\n');
    const logger = makeLogger();
    new YamlSequenceStore({ rootDir: root, logger });
    expect(logger.warn).toHaveBeenCalledWith('station.sequence.duplicate', expect.objectContaining({ contentId: 'plex:3' }));
  });

  it('returns a clone', () => {
    write('radio/salt-lake/fm100.yml', FM100);
    const store = new YamlSequenceStore({ rootDir: root, logger: makeLogger() });
    store.lookup('plex:757556').idents.pool.push('plex:evil');
    expect(store.lookup('plex:757556').idents.pool).toEqual(['plex:757863']);
  });

  it('picks up an edit after the freshness window, without a restart', () => {
    const file = write('radio/salt-lake/fm100.yml', FM100);
    let clock = 1_000_000;
    const store = new YamlSequenceStore({ rootDir: root, logger: makeLogger(), now: () => clock });
    expect(store.lookup('plex:757556').head).toBe(1);

    writeFileSync(file, FM100.replace('head: 1', 'head: 3'));
    const future = new Date(Date.now() + 60_000);
    utimesSync(file, future, future);

    clock += 500; // inside the window: still the old index
    expect(store.lookup('plex:757556').head).toBe(1);
    clock += 5_000;
    expect(store.lookup('plex:757556').head).toBe(3);
  });

  it('picks up a normal edit even when another file is future-dated', () => {
    const file = write('radio/salt-lake/fm100.yml', FM100);
    const skewed = write('radio/salt-lake/other.yml', 'match: { contentId: plex:2 }\nsequence: { head: 1 }\n');
    const future = new Date(Date.now() + 86_400_000);
    utimesSync(skewed, future, future);
    let clock = 1_000_000;
    const store = new YamlSequenceStore({ rootDir: root, logger: makeLogger(), now: () => clock });

    writeFileSync(file, FM100.replace('head: 1', 'head: 4'));
    const past = new Date(Date.now() - 60_000); // older than the skewed file, but different
    utimesSync(file, past, past);
    clock += 5_000;
    expect(store.lookup('plex:757556').head).toBe(4);
  });

  it('drops a deleted sidecar after the window', () => {
    const file = write('radio/salt-lake/fm100.yml', FM100);
    let clock = 1_000_000;
    const store = new YamlSequenceStore({ rootDir: root, logger: makeLogger(), now: () => clock });
    rmSync(file);
    clock += 5_000;
    expect(store.lookup('plex:757556')).toBeNull();
  });

  it('never throws on a missing root', () => {
    const store = new YamlSequenceStore({ rootDir: path.join(root, 'nope'), logger: makeLogger() });
    expect(store.lookup('plex:757556')).toBeNull();
  });
});
