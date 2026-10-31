// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resumeChoices, resumeSource } from './resumeSource.js';

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

describe('resumeChoices', () => {
  const at = '2026-10-31T21:17:52.000Z';
  it('offers the in-game save first and where-they-stopped second for a battery game saved by the console', () => {
    expect(resumeChoices('battery', { kind: 'save', createdAt: at, snapshot: bytes('s'), battery: bytes('b') })).toEqual([
      { id: 'continue', kind: 'battery', artifact: 'battery', at },
      { id: 'where-stopped', kind: 'state', artifact: 'snapshot', at },
    ]);
  });
  it('never offers a snapshot that was not captured together with the in-game save', () => {
    for (const kind of ['baseline', 'import', 'recover']) {
      expect(resumeChoices('battery', { kind, createdAt: at, snapshot: bytes('s'), battery: bytes('b') }).map(choice => choice.id)).toEqual(['continue']);
    }
  });
  it('has a single choice when only one kind of progress exists, and none after a reset', () => {
    expect(resumeChoices('battery', { kind: 'import', createdAt: at, snapshot: null, battery: bytes('b') }).map(choice => choice.id)).toEqual(['continue']);
    expect(resumeChoices('battery', { kind: 'baseline', createdAt: at, snapshot: bytes('s'), battery: null }).map(choice => choice.id)).toEqual(['where-stopped']);
    expect(resumeChoices('state', { kind: 'save', createdAt: at, snapshot: bytes('s'), battery: null }).map(choice => choice.id)).toEqual(['where-stopped']);
    expect(resumeChoices('battery', { kind: 'reset', snapshot: null, battery: null })).toEqual([]);
    expect(resumeChoices('battery', null)).toEqual([]);
  });
});
