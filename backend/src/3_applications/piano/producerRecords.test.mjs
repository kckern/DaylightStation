import { describe, expect, it } from 'vitest';
import {
  PRODUCER_SCHEMA_VERSION,
  normalizeProducerRecord,
  producerContentHash,
  validateProducerRecord,
} from './producerRecords.mjs';

const layer = (source = { kind: 'library', entry: { path: 'chords/a.musicxml' } }) => ({
  id: 'a', role: 'chords', channel: 0, gmProgram: 0, gain: 1,
  muted: false, soloed: false, carried: false, source,
});

describe('Producer record contract', () => {
  it('upgrades legacy crate data with version, title, revision, hash, and length', () => {
    const rec = normalizeProducerRecord('crate', { author: 'kc', kind: 'stack', layers: [layer()] }, {
      id: 'abc', now: '2026-08-10T10:00:00.000Z',
    });
    expect(rec).toMatchObject({ id: 'abc', schemaVersion: PRODUCER_SCHEMA_VERSION, revision: 1, lengthBars: 4 });
    expect(rec.title).toBe('Stack · 2026-08-10 10:00');
    expect(rec.contentHash).toHaveLength(64);
    expect(validateProducerRecord('crate', rec)).toEqual([]);
  });

  it('content hash ignores identity, revision, title, and timestamps', () => {
    const a = { kind: 'melody', notes: [{ midi: 60 }], ppq: 480, lengthBars: 1, title: 'A', id: 'one', revision: 1 };
    const b = { ...a, title: 'B', id: 'two', revision: 99, modified: 'later' };
    expect(producerContentHash('loops', a)).toBe(producerContentHash('loops', b));
  });

  it('rejects a syntactically valid hash that no longer matches the music', () => {
    const rec = normalizeProducerRecord('loops', {
      author: 'kc', kind: 'melody',
      notes: [{ ticks: 0, durationTicks: 480, midi: 60, velocity: 90 }],
      ppq: 480, lengthBars: 1,
    }, { id: 'changed-loop' });
    rec.notes[0].midi = 61;
    expect(validateProducerRecord('loops', rec)).toContain('contentHash does not match musical content');
  });

  it('rejects dead loop, arrangement, and carried references', () => {
    const rec = normalizeProducerRecord('songs', {
      author: 'kc', sections: [{ id: 'a', name: 'A', lengthBars: 4, stack: [
        layer({ kind: 'loop', loopId: 'gone' }), { carriedRef: 'also-gone' },
      ] }],
      arrangement: [{ sectionId: 'missing', repeats: 1 }], carriedLayers: {},
      meta: { bpm: 100, keyShift: 0 },
    }, { id: 'song' });
    const errors = validateProducerRecord('songs', rec, { hasLoop: () => false });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('loopId missing'),
      expect.stringContaining('missing section'),
      expect.stringContaining('missing carried layer'),
    ]));
  });

  it('rejects unplayable note data and unreachable record ids', () => {
    const rec = normalizeProducerRecord('loops', {
      author: 'kc', kind: 'melody', notes: [{ ticks: -1, durationTicks: 0, midi: 200, velocity: 0 }],
      ppq: 480, lengthBars: 1,
    }, { id: 'bad.id' });
    expect(validateProducerRecord('loops', rec)).toEqual(expect.arrayContaining([
      'id invalid',
      expect.stringContaining('ticks'),
      expect.stringContaining('durationTicks'),
      expect.stringContaining('midi'),
      expect.stringContaining('velocity'),
    ]));
  });

  it('rejects channel collisions, invalid mixer state, and embedded takes in stored stacks', () => {
    const first = layer();
    const second = {
      ...layer({ kind: 'take', takeId: 'take-legacy', notes: [{ ticks: 0, durationTicks: 480, midi: 60 }] }),
      id: 'b',
      gain: 2,
      muted: 'no',
    };
    const rec = normalizeProducerRecord('crate', {
      author: 'kc', kind: 'stack', layers: [first, second], lengthBars: 4,
    }, { id: 'crate-1' });
    expect(validateProducerRecord('crate', rec)).toEqual(expect.arrayContaining([
      expect.stringContaining('gain must be 0..1'),
      expect.stringContaining('muted must be boolean'),
      expect.stringContaining('must be persisted as a loop reference'),
      expect.stringContaining('channel duplicates'),
    ]));
  });

  it('rejects song tempo outside the playable workspace range', () => {
    const rec = normalizeProducerRecord('songs', {
      author: 'kc',
      sections: [{ id: 'a', name: 'A', lengthBars: 4, stack: [] }],
      arrangement: [{ sectionId: 'a', repeats: 1 }],
      carriedLayers: {},
      meta: { bpm: 0, keyShift: 0.5 },
    }, { id: 'song-1' });
    expect(validateProducerRecord('songs', rec)).toContain('meta.bpm (40..220) and integer meta.keyShift required');
  });
});
