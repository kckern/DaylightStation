import { describe, expect, it, vi } from 'vitest';
import { createChessConfigService, mergeChessConfig, resolveRung } from './ChessConfigService.mjs';

const HOUSE = {
  default_rung: 'learner',
  rungs: [
    { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
    { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
    { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
  ],
  opponent_delay_ms: 700,
  feedback: { hint_level: 'after-mistake', toast: true },
};

describe('mergeChessConfig', () => {
  it('returns the household config when the user has no overrides', () => {
    expect(mergeChessConfig(HOUSE, null)).toEqual(HOUSE);
  });

  it('lets a user override a single key without losing the rest', () => {
    const merged = mergeChessConfig(HOUSE, { default_rung: 'steady' });
    expect(merged.default_rung).toBe('steady');
    expect(merged.opponent_delay_ms).toBe(700);
    expect(merged.rungs).toHaveLength(3);
  });

  it('merges the feedback block key by key', () => {
    const merged = mergeChessConfig(HOUSE, { feedback: { hint_level: 'off' } });
    expect(merged.feedback).toEqual({ hint_level: 'off', toast: true });
  });

  it('replaces the ladder wholesale rather than merging it element-wise', () => {
    const merged = mergeChessConfig(HOUSE, { rungs: [{ id: 'only', label: 'Only', skill: 5, movetime_ms: 100 }] });
    expect(merged.rungs).toHaveLength(1);
    expect(merged.rungs[0].id).toBe('only');
  });
});

describe('resolveRung', () => {
  it('finds a rung by id', () => {
    expect(resolveRung(HOUSE, 'steady').skill).toBe(8);
  });

  it('falls back to the middle rung and warns when the id is unknown', () => {
    const logger = { warn: vi.fn(), info() {}, error() {}, debug() {} };
    const rung = resolveRung(HOUSE, 'nonsense', logger);
    expect(rung.id).toBe('learner');
    expect(logger.warn).toHaveBeenCalledWith('chess.config.unknown-rung', expect.objectContaining({ requested: 'nonsense' }));
  });
});

describe('createChessConfigService', () => {
  const silent = { warn() {}, info() {}, error() {}, debug() {} };

  it('writes only the user layer, never the household file', async () => {
    const writes = [];
    const service = createChessConfigService({
      readHouseholdConfig: () => HOUSE,
      readUserConfig: () => ({}),
      writeUserConfig: (userId, data) => { writes.push({ userId, data }); },
      logger: silent,
    });
    await service.writeUserLayer('test-user', { default_rung: 'steady' });
    expect(writes).toEqual([{ userId: 'test-user', data: { default_rung: 'steady' } }]);
  });

  it('merges a patch into the existing override instead of replacing the file', async () => {
    // The datastore overwrites whole files, so a second setting must not erase
    // the first. One tap picks a rung, the next picks a hint level; both persist.
    let stored = { default_rung: 'steady' };
    const service = createChessConfigService({
      readHouseholdConfig: () => HOUSE,
      readUserConfig: () => stored,
      writeUserConfig: (_userId, data) => { stored = data; },
      logger: silent,
    });
    await service.writeUserLayer('test-user', { feedback: { hint_level: 'off' } });
    expect(stored).toEqual({ default_rung: 'steady', feedback: { hint_level: 'off' } });
  });

  it('refuses to write without a user, so guests never create a profile', async () => {
    const writeUserConfig = vi.fn();
    const service = createChessConfigService({
      readHouseholdConfig: () => HOUSE, readUserConfig: () => ({}), writeUserConfig, logger: silent,
    });
    await expect(service.writeUserLayer(null, { default_rung: 'steady' })).rejects.toThrow();
    expect(writeUserConfig).not.toHaveBeenCalled();
  });
});
