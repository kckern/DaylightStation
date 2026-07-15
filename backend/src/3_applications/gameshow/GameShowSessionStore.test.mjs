// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GameShowSessionStore } from './GameShowSessionStore.mjs';

const NOOP = { info() {}, warn() {}, error() {}, debug() {} };
const TEAMS = [
  { id: 'team_1', name: 'Kids', color: '#e6b325', slot: 'slot_1', members: [{ id: 'felix', name: 'Felix' }] },
  { id: 'team_2', name: 'Parents', color: '#3273dc', slot: 'slot_2', members: [{ id: 'kckern', name: 'KC' }] },
];

describe('GameShowSessionStore', () => {
  let store;
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshow-sessions-'));
    store = new GameShowSessionStore({ sessionsDir: dir, logger: NOOP });
  });

  it('creates a session with active status and null state', () => {
    const s = store.create({ game: 'jeopardy', setId: 'test-set', teams: TEAMS });
    expect(s.id).toMatch(/^gs_\d+$/);
    expect(s.status).toBe('active');
    expect(s.state).toBe(null);
    expect(store.get(s.id).teams).toHaveLength(2);
  });

  it('checkpoints replace state and survive a fresh store instance (disk round-trip)', () => {
    const s = store.create({ game: 'jeopardy', setId: 'test-set', teams: TEAMS });
    store.checkpoint(s.id, { phase: 'playing', scores: { team_1: 400 } });
    const reloaded = new GameShowSessionStore({ sessionsDir: store.sessionsDir, logger: NOOP });
    expect(reloaded.get(s.id).state.scores.team_1).toBe(400);
  });

  it('getActive returns the most recently updated active session, ignoring finished ones', () => {
    const a = store.create({ game: 'jeopardy', setId: 'a', teams: TEAMS });
    const b = store.create({ game: 'jeopardy', setId: 'b', teams: TEAMS });
    store.checkpoint(a.id, { phase: 'playing' }); // a now newest
    expect(store.getActive().id).toBe(a.id);
    store.finish(a.id);
    expect(store.getActive().id).toBe(b.id);
    store.finish(b.id);
    expect(store.getActive()).toBe(null);
  });

  it('returns null for unknown ids', () => {
    expect(store.get('gs_0')).toBe(null);
    expect(store.checkpoint('gs_0', {})).toBe(null);
    expect(store.finish('gs_0')).toBe(null);
  });
});
