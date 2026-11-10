import { describe, expect, it } from 'vitest';
import { gamepadKeyEdges } from './useGamepadKeys.js';

const pad = (pressed) => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });

describe('gamepadKeyEdges', () => {
  it('maps D-pad, A and B to menu keys on the press edge only', () => {
    let state = gamepadKeyEdges(new Set(), [pad([12])]);
    expect(state.edges).toEqual(['ArrowUp']);
    state = gamepadKeyEdges(state.pressed, [pad([12])]);
    expect(state.edges).toEqual([]); // held: no repeat
    state = gamepadKeyEdges(state.pressed, [pad([0, 1])]);
    expect(state.edges.sort()).toEqual(['Enter', 'Escape']);
  });
  it('ignores missing pads', () => {
    expect(gamepadKeyEdges(new Set(), [null, undefined]).edges).toEqual([]);
  });
});
