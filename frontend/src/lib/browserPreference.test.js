import { afterEach, expect, it, vi } from 'vitest';
import { browserPreference, subscribeToStorageKey } from './browserPreference.js';

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

it('reconciles a storage notification against the current key and releases the listener', () => {
  const preference = browserPreference('test.layout', 'wide');
  const observed = vi.fn();
  const stop = subscribeToStorageKey('test.layout', () => observed(preference.read()));
  const signal = (key, storageArea) => window.dispatchEvent(new StorageEvent('storage', {
    key, storageArea, newValue: 'older layout',
  }));
  try {
    preference.write('compact');
    signal('another key', localStorage);
    signal('test.layout', sessionStorage);
    signal(null, sessionStorage);
    expect(observed).not.toHaveBeenCalled();
    signal('test.layout', localStorage);
    preference.clear();
    signal(null, localStorage);
    expect(observed.mock.calls).toEqual([['compact'], ['wide']]);
  } finally {
    stop();
    preference.clear();
  }
  signal('test.layout', localStorage);
  expect(observed).toHaveBeenCalledTimes(2);
});

it('ignores a storage notification when the requested storage area is unavailable', () => {
  const observed = vi.fn();
  const stop = subscribeToStorageKey('test.layout', observed, () => { throw new DOMException('Unavailable', 'SecurityError'); });
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    expect(observed).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
