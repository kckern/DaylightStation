import { describe, expect, it } from 'vitest';
import { createChessLadderService } from './ChessLadderService.mjs';

/** A service over an in-memory store, so the writes are observable. */
function makeService({ config = {}, progress = {}, writable = true } = {}) {
  const store = { ...progress };
  const service = createChessLadderService({
    readConfig: async () => config,
    readProgress: async (userId) => store[userId] ?? null,
    writeProgress: async (userId, value) => {
      if (!writable) return false;
      store[userId] = value;
      return true;
    },
  });
  return { service, store };
}

const win = (level, help = { hints: 0, best_moves: 0 }) => ({ completed: true, result: 'win', level, help });

describe('no skipping ahead', () => {
  it('clamps a requested level to what the player has unlocked', async () => {
    // This is the ONLY place the rule is enforced. Everything else about it is
    // presentation, and presentation can be bypassed with a crafted request —
    // which is exactly what this asserts cannot work.
    const { service } = makeService({ progress: { milo: { unlocked_through: 2, results: [] } } });
    expect((await service.rungFor('milo', 20)).level).toBe(2);
    expect((await service.rungFor('milo', 20)).rung.skill).toBe(2);
    expect((await service.rungFor('milo', 1)).level, 'a beaten character may be replayed').toBe(1);
    expect((await service.rungFor('milo', -5)).level).toBe(0);
  });

  it('holds a guest to the bottom of the roster', async () => {
    const { service } = makeService();
    expect((await service.rungFor(null, 15)).level).toBe(0);
  });

  it('defaults to the current opponent when no level is asked for', async () => {
    const { service } = makeService({ progress: { milo: { unlocked_through: 4, results: [] } } });
    expect((await service.rungFor('milo', undefined)).level).toBe(4);
  });
});

describe('recording a game', () => {
  it('promotes on the fifth clean win and says who is next', async () => {
    const { service, store } = makeService({ progress: { milo: { unlocked_through: 0, results: [] } } });
    let last;
    for (let i = 0; i < 5; i += 1) last = await service.recordGame('milo', win(0));
    expect(last.promoted).toBe(true);
    expect(last.to).toBe(1);
    expect(last.next_opponent.name).toBeTruthy();
    expect(store.milo.unlocked_through, 'the climb is persisted, not just reported').toBe(1);
  });

  it('does not promote on wins that leant on the engine', async () => {
    const { service } = makeService({ progress: { milo: { unlocked_through: 0, results: [] } } });
    let last;
    for (let i = 0; i < 7; i += 1) {
      last = await service.recordGame('milo', win(0, { hints: 0, best_moves: 3 }));
    }
    expect(last.promoted).toBe(false);
    expect(last.status.wins).toBe(0);
  });

  it('never writes for a guest, and never claims it did', async () => {
    const { service, store } = makeService();
    const result = await service.recordGame(null, win(0));
    expect(result).toEqual({ promoted: false, persisted: false, status: null });
    expect(Object.keys(store)).toHaveLength(0);
  });

  it('reports a failed write rather than a promotion that did not stick', async () => {
    // A promotion announced on screen and then lost on the next load is worse
    // than one that never happened.
    const { service } = makeService({ progress: { milo: { unlocked_through: 0, results: [] } }, writable: false });
    const result = await service.recordGame('milo', win(0));
    expect(result.persisted).toBe(false);
    expect(result.promoted).toBe(false);
  });
});

describe('reading the ladder', () => {
  it('offers only what has been unlocked', async () => {
    const { service } = makeService({ progress: { milo: { unlocked_through: 3, results: [] } } });
    const view = await service.read('milo');
    expect(view.available).toHaveLength(4);
    expect(view.current.level).toBe(3);
    expect(view.roster).toHaveLength(21);
    expect(view.persisted).toBe(true);
  });

  it('tells a guest that nothing is being kept', async () => {
    const view = await makeService().service.read(null);
    expect(view.persisted).toBe(false);
    expect(view.unlocked_through).toBe(0);
    expect(view.available).toHaveLength(1);
  });

  it('carries the roster override through, artwork and all', async () => {
    const { service } = makeService({
      config: { ladder: { roster: [{ name: 'Magikarp', art: '/magikarp.png', theme: '#123456' }] } },
    });
    const view = await service.read(null);
    expect(view.current.name).toBe('Magikarp');
    expect(view.current.art).toBe('/magikarp.png');
    expect(view.current.theme).toBe('#123456');
  });
});
