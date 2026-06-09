import { describe, it, expect, beforeEach } from 'vitest';
import { saveActiveSession, loadActiveSession, clearActiveSession } from './fitnessSessionPersistence.js';

describe('fitnessSessionPersistence', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('round-trips a non-empty queue', () => {
    const queue = [{ id: '674287', contentId: 'plex:674287', title: 'Daytona' }];
    saveActiveSession(queue);
    expect(loadActiveSession()).toEqual(queue);
  });

  it('clears persisted state when an empty queue is saved', () => {
    saveActiveSession([{ id: '1' }]);
    saveActiveSession([]);
    expect(loadActiveSession()).toBeNull();
  });

  it('clearActiveSession removes the entry', () => {
    saveActiveSession([{ id: '1' }]);
    clearActiveSession();
    expect(loadActiveSession()).toBeNull();
  });

  it('returns null on corrupt JSON instead of throwing', () => {
    window.sessionStorage.setItem('daylight.fitness.activeSession', '{not json');
    expect(loadActiveSession()).toBeNull();
  });
});
