import { afterEach, expect, it, vi } from 'vitest';
import { browserPreference } from './browserPreference.js';

afterEach(() => vi.unstubAllGlobals());

it('reads existing raw keys through the feature decoder and writes compatible strings', () => {
  const view = browserPreference('test.view', 'today', raw => raw === 'room' ? 'rooms' : raw);
  localStorage.setItem('test.view', 'room');
  expect(view.read()).toBe('rooms');
  view.write('mosaic');
  expect(localStorage.getItem('test.view')).toBe('mosaic');
  view.clear();
  expect(localStorage.getItem('test.view')).toBeNull();
  expect(view.read()).toBe('today');
});

it('uses the fallback when browser storage is unavailable', () => {
  const pref = browserPreference('preview', null);
  vi.stubGlobal('localStorage', undefined);
  expect(pref.read()).toBeNull();
  expect(() => pref.write('tv')).not.toThrow();
  expect(() => pref.clear()).not.toThrow();
});
