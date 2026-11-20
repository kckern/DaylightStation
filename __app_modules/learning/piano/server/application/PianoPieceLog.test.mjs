// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PianoPieceLog } from './PianoPieceLog.mjs';
import { YamlPianoPieceLogStore } from '../adapters/persistence/YamlPianoPieceLogStore.mjs';

const memory = () => { const entries = []; return { entries, list: () => [...entries], append: (_user, entry) => { entries.push(entry); return true; } }; };
const clock = () => new Date('2026-11-18T20:00:00Z');

describe('piano piece log', () => {
  it('notes a level once per piece and never for a guest', () => {
    const store = memory(); const log = new PianoPieceLog({ store, clock });
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'silver', passages: 3, fingerprint: 'f' }))
      .toEqual({ at: '2026-11-18T20:00:00.000Z', scoreId: 'files:a.mxl', level: 'silver', passages: 3, fingerprint: 'f' });
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'silver', passages: 3, fingerprint: 'g' })).toBeNull();
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'gold' })).toMatchObject({ level: 'gold' });
    expect(log.note({ userId: 'guest', scoreId: 'files:a.mxl', level: 'gold' })).toBeNull();
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'bronze' })).toBeNull();
    expect(store.entries).toHaveLength(2);
  });

  it('notes the Polish gem and diamond as their own levels, with the run detail', () => {
    const store = memory(); const log = new PianoPieceLog({ store, clock });
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'polish-gem', fingerprint: 'f', detail: { tempoPercent: 60, score: 96 } }))
      .toEqual({ at: '2026-11-18T20:00:00.000Z', scoreId: 'files:a.mxl', level: 'polish-gem', passages: null, fingerprint: 'f', tempoPercent: 60, score: 96 });
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'polish-diamond', detail: { at: 'x', level: 'gold', scoreId: 'y' } }))
      .toMatchObject({ at: '2026-11-18T20:00:00.000Z', scoreId: 'files:a.mxl', level: 'polish-diamond' });
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'polish-gem' })).toBeNull();
    expect(log.has('learner4', 'files:a.mxl', 'polish-gem')).toBe(true);
    expect(log.has('learner4', 'files:a.mxl', 'gold')).toBe(false);
  });

  it('never throws when the store fails', () => {
    const warned = [];
    const log = new PianoPieceLog({ store: { list: () => { throw new Error('unreadable'); }, append: () => true }, clock,
      logger: { warn: (name, data) => warned.push([name, data]) } });
    expect(log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'silver' })).toBeNull();
    expect(warned[0]).toEqual(['piano.piece-log.append-failed', { userId: 'learner4', scoreId: 'files:a.mxl', level: 'silver', error: 'unreadable' }]);
  });

  it('appends to a per-player YAML file and refuses to overwrite one it cannot read', () => {
    const usersDir = mkdtempSync(join(tmpdir(), 'piece-log-'));
    const log = new PianoPieceLog({ store: new YamlPianoPieceLogStore({ usersDir }), clock });
    log.note({ userId: 'learner4', scoreId: 'files:a.mxl', level: 'silver', passages: 2 });
    log.note({ userId: 'learner4', scoreId: 'files:b.mxl', level: 'silver', passages: 5 });
    expect(log.list('learner4').map((entry) => entry.scoreId)).toEqual(['files:a.mxl', 'files:b.mxl']);
    expect(readFileSync(join(usersDir, 'learner4/apps/piano/piece-log.yml'), 'utf8')).toContain('schema: piano.piece-log/v1');
    expect(log.list('learner5')).toEqual([]);
    mkdirSync(join(usersDir, 'learner5/apps/piano'), { recursive: true });
    writeFileSync(join(usersDir, 'learner5/apps/piano/piece-log.yml'), 'entries: [: broken');
    expect(log.note({ userId: 'learner5', scoreId: 'files:a.mxl', level: 'silver' })).toBeNull();
    expect(readFileSync(join(usersDir, 'learner5/apps/piano/piece-log.yml'), 'utf8')).toBe('entries: [: broken');
  });
});
