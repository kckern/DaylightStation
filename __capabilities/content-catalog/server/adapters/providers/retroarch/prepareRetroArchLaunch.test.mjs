import { describe, it, expect, vi } from 'vitest';
import { createRetroArchLaunchPreparer } from './prepareRetroArchLaunch.mjs';

const config = {
  launch: { game_overrides: { config_dir: '/c' } },
  consoles: { gb: { core_name: 'Gambatte' } },
};
const catalog = {
  games: { gb: [{ id: 'sml', rom: '/g/Super Mario Land.gb' }] },
  overrides: { 'gb/sml': { resume: true } },
};
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const item = { source: 'retroarch', localId: 'gb/sml' };

function make(writer, budgetMs) {
  return createRetroArchLaunchPreparer({ getConfig: () => config, readCatalog: () => catalog, writer, logger, budgetMs });
}

describe('createRetroArchLaunchPreparer', () => {
  it('ensures the planned override for a retroarch item', async () => {
    const writer = { ensure: vi.fn().mockResolvedValue({ status: 'written', path: '/c/Gambatte/Super Mario Land.cfg' }) };
    await make(writer)(item);
    expect(writer.ensure).toHaveBeenCalledWith(expect.objectContaining({ path: '/c/Gambatte/Super Mario Land.cfg', resume: true }));
  });

  it('ignores non-retroarch items', async () => {
    const writer = { ensure: vi.fn() };
    await make(writer)({ source: 'plex', localId: '123' });
    expect(writer.ensure).not.toHaveBeenCalled();
  });

  it('never throws when the writer rejects', async () => {
    const writer = { ensure: vi.fn().mockRejectedValue(new Error('adb gone')) };
    await expect(make(writer)(item)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('retroarch.override.prelaunch', expect.objectContaining({ status: 'failed' }));
  });

  it('gives up after the time budget so the launch is not held', async () => {
    const writer = { ensure: vi.fn(() => new Promise(() => {})) };
    const t0 = Date.now();
    await make(writer, 30)(item);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(logger.warn).toHaveBeenCalledWith('retroarch.override.prelaunch', expect.objectContaining({ status: 'timeout' }));
  });

  it('skips with a warn when the game is not in the catalog', async () => {
    const writer = { ensure: vi.fn() };
    await make(writer)({ source: 'retroarch', localId: 'gb/nope' });
    expect(writer.ensure).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('retroarch.override.skipped', expect.objectContaining({ reason: 'unknown-game' }));
  });
});
