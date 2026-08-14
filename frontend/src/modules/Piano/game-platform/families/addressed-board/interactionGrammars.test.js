import { describe, expect, it } from 'vitest';
import {
  applyColumnDropEvent, applySourceDestinationEvent, createColumnDropState,
  createSourceDestinationState, resolveAddressedSelection,
} from './interactionGrammars.js';

describe('addressed-board interaction grammars', () => {
  it('commits a hovered column', () => {
    const hovered = applyColumnDropEvent(createColumnDropState(), { type: 'address', value: 3 });
    expect(applyColumnDropEvent(hovered, { type: 'confirm' }).committed).toBe(3);
  });

  it('commits source then destination', () => {
    let state = applySourceDestinationEvent(createSourceDestinationState(), { type: 'address', value: 12 });
    state = applySourceDestinationEvent(state, { type: 'confirm' });
    state = applySourceDestinationEvent(state, { type: 'address', value: 16 });
    expect(applySourceDestinationEvent(state, { type: 'confirm' }).committed).toEqual({ from: 12, to: 16 });
  });

  it('enforces game-provided source and destination sets', () => {
    expect(resolveAddressedSelection({ selected: null, address: 4, sources: [8], destinations: [] }).rejection).toBe('select_source');
    expect(resolveAddressedSelection({ selected: 8, address: 12, sources: [8], destinations: [12] }).committed).toEqual({ from: 8, to: 12 });
  });
});
