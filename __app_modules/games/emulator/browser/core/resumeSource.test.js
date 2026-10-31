// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resumeSource } from './resumeSource.js';

const bytes = label => new Uint8Array(Buffer.from(label));

describe('resumeSource', () => {
  it('boots fresh with no record or after a recorded reset', () => {
    expect(resumeSource('battery', null)).toEqual({ kind: 'fresh', artifact: null });
    expect(resumeSource('battery', { kind: 'reset', snapshot: null, battery: null })).toEqual({ kind: 'fresh', artifact: null });
  });
  it('resumes a battery game from its in-game save even when a snapshot exists', () => {
    expect(resumeSource('battery', { kind: 'save', snapshot: bytes('s'), battery: bytes('b') })).toEqual({ kind: 'battery', artifact: 'battery' });
  });
  it('falls back to the snapshot for a battery game that has no in-game save yet', () => {
    expect(resumeSource('battery', { kind: 'baseline', snapshot: bytes('s'), battery: null })).toEqual({ kind: 'state', artifact: 'snapshot' });
  });
  it('resumes a state game from its snapshot', () => {
    expect(resumeSource('state', { kind: 'save', snapshot: bytes('s'), battery: bytes('b') })).toEqual({ kind: 'state', artifact: 'snapshot' });
  });
  it('refuses a non-reset record with nothing usable', () => {
    expect(() => resumeSource('battery', { kind: 'save', snapshot: null, battery: null })).toThrow(expect.objectContaining({ code: 'ECHECKPOINTCORRUPT' }));
  });
});
