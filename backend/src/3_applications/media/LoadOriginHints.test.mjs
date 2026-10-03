import { describe, it, expect } from 'vitest';
import { LoadOriginHints } from './LoadOriginHints.mjs';

const routine = { kind: 'routine', id: 'automation:kitchen_button_1', name: 'Kitchen button 1' };

describe('LoadOriginHints', () => {
  it('hands a load\'s origin to the next start on that screen within the window, once', () => {
    const hints = new LoadOriginHints({ windowMs: 180_000 });
    hints.note('fleet:livingroom-tv', routine, 1_000);
    expect(hints.take('fleet:office-tv', 2_000)).toBeNull();
    expect(hints.take('fleet:livingroom-tv', 60_000)).toEqual(routine);
    expect(hints.take('fleet:livingroom-tv', 61_000)).toBeNull();
  });
  it('a hint older than the window says nothing', () => {
    const hints = new LoadOriginHints({ windowMs: 180_000 });
    hints.note('fleet:livingroom-tv', routine, 0);
    expect(hints.take('fleet:livingroom-tv', 180_001)).toBeNull();
  });
  it('a newer load replaces the older hint; a null origin clears it', () => {
    const hints = new LoadOriginHints();
    hints.note('fleet:tv', routine, 0);
    hints.note('fleet:tv', { kind: 'device', id: 'browser:a', name: null }, 10);
    expect(hints.take('fleet:tv', 20)).toEqual({ kind: 'device', id: 'browser:a', name: null });
    hints.note('fleet:tv', routine, 30);
    hints.note('fleet:tv', null, 40);
    expect(hints.take('fleet:tv', 50)).toBeNull();
  });
});
