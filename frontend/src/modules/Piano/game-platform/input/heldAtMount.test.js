import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNotesHeldAtMount } from './heldAtMount.js';

const notes = (...nums) => new Map(nums.map((n) => [n, { velocity: 100, timestamp: 1 }]));

describe('useNotesHeldAtMount', () => {
  it('hides the key that was still down when the game opened', () => {
    // 71 picked the game from the launcher and is still held at mount.
    const { result, rerender } = renderHook(({ n }) => useNotesHeldAtMount(n), {
      initialProps: { n: notes(71) },
    });
    expect([...result.current.keys()]).toEqual([]);

    // Still held a moment later — still not a move.
    rerender({ n: notes(71) });
    expect([...result.current.keys()]).toEqual([]);
  });

  it('lets that key count again once it has been released and replayed', () => {
    const { result, rerender } = renderHook(({ n }) => useNotesHeldAtMount(n), {
      initialProps: { n: notes(71) },
    });
    rerender({ n: notes() });          // released
    rerender({ n: notes(71) });        // played deliberately
    expect([...result.current.keys()]).toEqual([71]);
  });

  it('passes through a key pressed after mount untouched', () => {
    const { result, rerender } = renderHook(({ n }) => useNotesHeldAtMount(n), {
      initialProps: { n: notes(71) },
    });
    rerender({ n: notes(71, 60) });
    expect([...result.current.keys()]).toEqual([60]);
  });

  it('masks a whole chord held through the mount, releasing each key on its own', () => {
    const { result, rerender } = renderHook(({ n }) => useNotesHeldAtMount(n), {
      initialProps: { n: notes(60, 64, 67) },
    });
    expect([...result.current.keys()]).toEqual([]);
    rerender({ n: notes(60, 64) });    // 67 lifted
    rerender({ n: notes(60, 64, 67) }); // and replayed
    expect([...result.current.keys()]).toEqual([67]);
  });

  it('is a no-op when nothing was held at mount', () => {
    const first = notes();
    const { result, rerender } = renderHook(({ n }) => useNotesHeldAtMount(n), {
      initialProps: { n: first },
    });
    const live = notes(60);
    rerender({ n: live });
    // Same Map identity back — consumers use this as an effect dependency, and a
    // fresh Map every render would re-run their input effects at MIDI rates.
    expect(result.current).toBe(live);
  });

  it('returns the same identity once every masked key has been released', () => {
    const { rerender, result } = renderHook(({ n }) => useNotesHeldAtMount(n), {
      initialProps: { n: notes(71) },
    });
    rerender({ n: notes() });
    const live = notes(62);
    rerender({ n: live });
    expect(result.current).toBe(live);
  });
});
