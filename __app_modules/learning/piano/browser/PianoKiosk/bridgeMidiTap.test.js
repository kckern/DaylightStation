import { describe, it, expect } from 'vitest';
import { chunkBytes, splitMessages, newChunks, voiceChanges, dedupeChanges } from './bridgeMidiTap.js';

describe('bridgeMidiTap', () => {
  it('reads tap lines, dropping the timestamp field', () => {
    expect(chunkBytes('84365 B0 00 00')).toEqual([0xb0, 0, 0]);
    expect(chunkBytes('')).toEqual([]);
  });

  it('splits a chunk into messages, carrying running status across chunks', () => {
    const state = { status: 0 };
    expect(splitMessages([0xb0, 0, 0, 32, 3, 0xc0, 5], state)).toEqual([[0xb0, 0, 0], [0xb0, 32, 3], [0xc0, 5]]);
    expect(splitMessages([7], state)).toEqual([[0xc0, 7]]);
    expect(splitMessages([0xfe, 0x90, 60, 100], { status: 0 })).toEqual([[0x90, 60, 100]]);
  });

  it('returns only chunks that arrived since the last poll; the first poll is a baseline', () => {
    const snap = { chunks: 10, recent: ['1 B0 00 00', '2 C0 05'] };
    expect(newChunks(snap, null)).toEqual({ total: 10, lines: [] });
    expect(newChunks({ chunks: 11, recent: ['1 B0 00 00', '2 C0 05', '3 C0 06'] }, 10).lines).toEqual(['3 C0 06']);
    expect(newChunks({ chunks: 3, recent: ['x'] }, 10)).toEqual({ total: 3, lines: [] }); // bridge restarted
    expect(newChunks({ chunks: 500, recent: ['a', 'b'] }, 10).lines).toEqual(['a', 'b']);
  });

  it('stamps the channel bank onto each Program Change', () => {
    const banks = {};
    const msgs = [[0xb0, 0, 0], [0xb0, 32, 3], [0xc0, 0], [0xcd, 21]];
    expect(voiceChanges(msgs, banks)).toEqual([
      { ch: 1, msb: 0, lsb: 3, pc: 0 },
      { ch: 14, msb: 0, lsb: 0, pc: 21 },
    ]);
    expect(voiceChanges([[0xc0, 1]], banks)).toEqual([{ ch: 1, msb: 0, lsb: 3, pc: 1 }]);
  });

  it('collapses the echo and flush repeats of one press', () => {
    const c = { ch: 1, msb: 0, lsb: 0, pc: 0 };
    const first = dedupeChanges([c, { ...c, ch: 14 }, c], null, 1000);
    expect(first.changes).toHaveLength(1);
    expect(dedupeChanges([c], first.last, 1200).changes).toHaveLength(0);
    expect(dedupeChanges([c], first.last, 5000).changes).toHaveLength(1);
    expect(dedupeChanges([{ ...c, pc: 1 }], first.last, 1100).changes).toHaveLength(1);
  });
});
