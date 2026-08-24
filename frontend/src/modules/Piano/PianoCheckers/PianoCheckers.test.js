import { describe, expect, it } from 'vitest';
import { resolveAddressedSelection } from '../game-platform/families/addressed-board/interactionGrammars.js';
import { selectionMessage } from './PianoCheckers.jsx';
import { DEFAULT_FILE_NOTES, DEFAULT_RANK_NOTES, squareForAddress } from './checkersAddress.js';

/** Piano Checkers uses the addressed-board selection grammar and file/rank axes. */
describe('Piano Checkers addressing', () => {
  it('addresses a square by playing its file and rank notes together', () => {
    const notes = { file_notes: DEFAULT_FILE_NOTES, rank_notes: DEFAULT_RANK_NOTES };
    const square = squareForAddress([DEFAULT_FILE_NOTES[0], DEFAULT_RANK_NOTES[0]], notes);
    expect(square).not.toBeNull();
  });

  it('explains a locked forced jump instead of refusing silently', () => {
    expect(selectionMessage('forced_source')).toMatch(/jump/i);
  });

  it('has no message once a rejection is cleared', () => {
    expect(selectionMessage(null)).toBeNull();
  });

  it('uses the addressed-board source/destination grammar', () => {
    expect(resolveAddressedSelection({ selected: null, address: 20, sources: [20], destinations: [] }))
      .toEqual({ selected: 20, committed: null, rejection: null });
    expect(resolveAddressedSelection({ selected: 20, address: 16, sources: [20], destinations: [16, 17] }))
      .toEqual({ selected: null, committed: { from: 20, to: 16 }, rejection: null });
  });
});
