import { describe, it, expect, vi } from 'vitest';
import { createMediaHouseModule } from './mediaHouse.mjs';

// A household-list change (removal, restore, watched mark) must clear the
// 5-minute suggestions cache so it shows at once on every screen.
describe('mediaHouse composition: suggestions follow household-list changes', () => {
  function compose() {
    let listener = null;
    const householdMediaMemory = {
      onListChanged: vi.fn((fn) => { listener = fn; return () => {}; }),
      listFavourites: async () => ({ items: [] }),
    };
    const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };
    const configService = {
      getAppConfig: () => ({}),
      getHouseholdPath: () => '/nonexistent',
      getDataDir: () => '/nonexistent',
    };
    const module = createMediaHouseModule({ configService, householdMediaMemory, nowLocal: () => '2026-10-03 07:30:00', logger: quiet });
    return { module, fire: (change) => listener(change), householdMediaMemory };
  }

  it('invalidates the named household, or every household for a mark', () => {
    const { module, fire, householdMediaMemory } = compose();
    expect(householdMediaMemory.onListChanged).toHaveBeenCalledTimes(1);
    const one = vi.spyOn(module.suggestions, 'invalidate');
    const all = vi.spyOn(module.suggestions, 'invalidateAll');
    fire({ householdId: 'h2', reason: 'removed', id: 'plex:1' });
    expect(one).toHaveBeenCalledWith('h2');
    fire({ householdId: null, reason: 'watched', id: 'plex:1' });
    expect(all).toHaveBeenCalledTimes(1);
  });
});
