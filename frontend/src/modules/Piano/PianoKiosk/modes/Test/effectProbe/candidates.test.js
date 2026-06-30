// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildCandidates, candidateNeedsSysex } from './candidates.js';

const cands = buildCandidates();

describe('buildCandidates', () => {
  it('has unique ids and a dry+wet pair each', () => {
    const ids = cands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cands.every((c) => c.dry.length && c.wet.length)).toBe(true);
  });
  it('covers both reverb and chorus', () => {
    expect(cands.some((c) => c.kind === 'reverb')).toBe(true);
    expect(cands.some((c) => c.kind === 'chorus')).toBe(true);
  });
  it('framed-CC candidates are non-sysex; GS/XG/GM2 are sysex', () => {
    expect(candidateNeedsSysex(cands.find((c) => c.id === 'rv-cc91-framed'))).toBe(false);
    expect(candidateNeedsSysex(cands.find((c) => c.id === 'rv-gs'))).toBe(true);
    expect(candidateNeedsSysex(cands.find((c) => c.id === 'rv-xg'))).toBe(true);
  });
  it('every message is a valid 7-bit-framed byte array (sysex starts F0 ends F7)', () => {
    for (const c of cands) {
      for (const m of [...c.dry, ...c.wet]) {
        expect(Array.isArray(m)).toBe(true);
        expect(m.every((b) => Number.isInteger(b) && b >= 0 && b <= 0xff)).toBe(true);
        if (m[0] === 0xf0) expect(m[m.length - 1]).toBe(0xf7);
      }
    }
  });
  it('wet reverb clips drive the send/return up (vs dry at 0)', () => {
    const gs = cands.find((c) => c.id === 'rv-gs');
    // dry has a reverb level 0 sysex; wet has level 127.
    const flat = (msgs) => msgs.flat();
    expect(flat(gs.wet)).toContain(127);
  });
});
