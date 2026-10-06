// Ghost registrations and merged-duplicate names (review of media/fe-house).
import { describe, it, expect } from 'vitest';
import { buildScreenView, touchScreen, mergeScreens, isPlaceholderBrowserName, emptyRegistry } from './screenRegistry.mjs';

const NOW = Date.parse('2026-10-03T12:00:00.000Z');
const at = new Date(NOW).toISOString();

describe('placeholder-named browsers', () => {
  it('knows the made-up "Browser 1a2b3c4d" name', () => {
    expect(isPlaceholderBrowserName('Browser 1a2b3c4d')).toBe(true);
    expect(isPlaceholderBrowserName('Kitchen tablet')).toBe(false);
    expect(isPlaceholderBrowserName(null)).toBe(false);
  });

  it('folds a placeholder-named browser that never played out of the main list', () => {
    let state = emptyRegistry();
    state = touchScreen(state, 'browser:aaaa1111bbbb', { at }).state;
    state = touchScreen(state, 'browser:cccc2222dddd', { at, playing: true }).state;
    state = touchScreen(state, 'browser:eeee3333ffff', { name: 'Kitchen tablet', at }).state;
    const view = buildScreenView({ state, now: NOW });
    expect(view.screens.map((s) => s.id).sort()).toEqual(['browser:cccc2222dddd', 'browser:eeee3333ffff']);
    expect(view.unnamed.map((s) => s.id)).toEqual(['browser:aaaa1111bbbb']);
  });

  it('a ledger play signal also keeps it in the main list', () => {
    const state = touchScreen(emptyRegistry(), 'browser:aaaa1111bbbb', { at }).state;
    const view = buildScreenView({ state, now: NOW, signals: { 'browser:aaaa1111bbbb': { lastPlayed: at } } });
    expect(view.unnamed).toEqual([]);
    expect(view.screens[0].lastPlayed).toBe(at);
  });
});

describe('merged duplicates keep their names', () => {
  it('lists each alias with the name it had', () => {
    let state = emptyRegistry();
    state = touchScreen(state, 'browser:old', { name: 'Kitchen tablet', at }).state;
    state = touchScreen(state, 'browser:new', { name: 'Kitchen tablet again', at }).state;
    state = mergeScreens(state, 'browser:new', 'browser:old', { at }).state;
    const view = buildScreenView({ state, now: NOW });
    expect(view.screens[0].aliases).toEqual(['browser:new']);
    expect(view.screens[0].aliasNames).toEqual({ 'browser:new': 'Kitchen tablet again' });
  });
});
