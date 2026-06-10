import { describe, it, expect } from 'vitest';
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { reduce } from './sessionReducer.js';

function snap() {
  return createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'c1' });
}

describe('sessionReducer', () => {
  it('LOAD_ITEM transitions idle -> loading and sets currentItem', () => {
    const item = { contentId: 'p:1', format: 'video', title: 'T', duration: 30 };
    const next = reduce(snap(), { type: 'LOAD_ITEM', item });
    expect(next.state).toBe('loading');
    expect(next.currentItem).toEqual(item);
    expect(next.position).toBe(0);
  });

  it('PLAYER_STATE playing -> playing', () => {
    const s = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const next = reduce(s, { type: 'PLAYER_STATE', playerState: 'playing' });
    expect(next.state).toBe('playing');
  });

  it('UPDATE_POSITION sets position but does not change state', () => {
    const s0 = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const s1 = reduce(s0, { type: 'PLAYER_STATE', playerState: 'playing' });
    const s2 = reduce(s1, { type: 'UPDATE_POSITION', position: 5.5 });
    expect(s2.state).toBe('playing');
    expect(s2.position).toBe(5.5);
  });

  it('ITEM_ENDED transitions to ended', () => {
    const s0 = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const s1 = reduce(s0, { type: 'PLAYER_STATE', playerState: 'playing' });
    const next = reduce(s1, { type: 'ITEM_ENDED' });
    expect(next.state).toBe('ended');
  });

  it('ITEM_ERROR transitions to error and stores lastError on meta', () => {
    const next = reduce(snap(), { type: 'ITEM_ERROR', error: 'boom', code: 'E_X' });
    expect(next.state).toBe('error');
    expect(next.meta.lastError).toEqual({ message: 'boom', code: 'E_X' });
  });

  it('RESET returns to idle', () => {
    const s = reduce(snap(), { type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    const next = reduce(s, { type: 'RESET' });
    expect(next.state).toBe('idle');
    expect(next.currentItem).toBeNull();
    expect(next.queue.items).toEqual([]);
  });

  it('SET_CONFIG merges config keys', () => {
    const next = reduce(snap(), { type: 'SET_CONFIG', patch: { shuffle: true, volume: 80 } });
    expect(next.config.shuffle).toBe(true);
    expect(next.config.volume).toBe(80);
    expect(next.config.repeat).toBe('off'); // untouched
  });

  it('touches meta.updatedAt on every reduction', async () => {
    const before = snap();
    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 1));
    const after = reduce(before, { type: 'SET_CONFIG', patch: { volume: 70 } });
    expect(after.meta.updatedAt).not.toBe(before.meta.updatedAt);
  });
});
