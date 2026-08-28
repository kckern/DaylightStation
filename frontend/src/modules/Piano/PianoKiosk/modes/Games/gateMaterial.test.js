import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  instance: vi.fn(), instances: vi.fn(), catalog: vi.fn(), text: vi.fn(),
}));

vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: { instance: h.instance, instances: h.instances, catalog: h.catalog },
}));
// The raw-MusicXML fetch, doubled at the same boundary `SheetMusic.jsx` uses it
// from. What is asserted below is the ENDPOINT as well as the payload: a score
// fetched from anywhere but the media stream would be a second way to address
// the same file, and the two would drift.
vi.mock('../../../../../lib/api.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  DaylightAPIText: h.text,
}));

const { resolveGateMaterial, pickGateMaterial, keysInstance } = await import('./gateMaterial.js');

const FOUR_BARS = '<?xml version="1.0"?><score-partwise><part id="P1"/></score-partwise>';

const level = (over = {}) => ({ id: 'L', tier: 2, grading: null, material: [], ...over });

describe('resolveGateMaterial', () => {
  beforeEach(() => { h.instance.mockReset(); h.text.mockReset(); });

  it('loads an exercise instance from the bank', async () => {
    const loaded = { id: 'scales/c-major@hands=1', title: 'C major' };
    h.instance.mockResolvedValue({ ok: true, status: 200, data: loaded });

    await expect(resolveGateMaterial({ kind: 'exercise', instanceId: 'scales/c-major@hands=1' }))
      .resolves.toEqual({ ok: true, kind: 'exercise', instance: loaded });
    expect(h.instance).toHaveBeenCalledWith('scales/c-major@hands=1');
  });

  it('uses an instance the material already carries, without a second fetch', async () => {
    // The gate resolves the instance itself now — it needs the axes and the
    // events to write the child's ask. Re-fetching the same id on the run's
    // own load is not merely wasted: a backend restart between the two calls
    // is exactly how a resolved gate used to land on "Exercise not found".
    const carried = { id: 'scales/modes@root=C', title: 'C major', events: [] };
    await expect(resolveGateMaterial({ kind: 'exercise', instanceId: carried.id, instance: carried }))
      .resolves.toEqual({ ok: true, kind: 'exercise', instance: carried });
    expect(h.instance).not.toHaveBeenCalled();
  });

  it('carries a synthesized keys instance the same way, and never asks the bank for one', async () => {
    const lit = keysInstance({ kind: 'keys', notes: 1 }, 0);
    await expect(resolveGateMaterial({ kind: 'keys', instance: lit }))
      .resolves.toEqual({ ok: true, kind: 'keys', instance: lit });
    expect(h.instance).not.toHaveBeenCalled();
  });

  it('reports an unavailable instance rather than throwing', async () => {
    h.instance.mockResolvedValue({ ok: false, status: 404, data: null });

    await expect(resolveGateMaterial({ kind: 'exercise', instanceId: 'nope@x=1' }))
      .resolves.toEqual({ ok: false, error: 'instance-unavailable' });
  });

  it('fetches the score’s MusicXML from the media stream, and carries the measure range with it', async () => {
    h.text.mockResolvedValue(FOUR_BARS);

    await expect(resolveGateMaterial({
      kind: 'score', source: 'files:docs/sheet-music/four-bars.musicxml', measures: [2, 3],
    })).resolves.toEqual({
      ok: true,
      kind: 'score',
      score: {
        id: 'files:docs/sheet-music/four-bars.musicxml',
        musicXml: FOUR_BARS,
        measures: [2, 3],
      },
    });
    // The `files:` scheme is the CONTENT id's, not the media path's — the same
    // strip `SheetMusic.jsx` does before it streams.
    expect(h.text).toHaveBeenCalledWith(
      `api/v1/proxy/media/stream/${encodeURIComponent('docs/sheet-music/four-bars.musicxml')}`,
    );
    expect(h.instance).not.toHaveBeenCalled();
  });

  it('reports an unreachable score rather than throwing', async () => {
    h.text.mockRejectedValue(new Error('HTTP 502: Bad Gateway'));

    await expect(resolveGateMaterial({ kind: 'score', source: 'files:docs/sheet-music/four-bars.musicxml' }))
      .resolves.toEqual({ ok: false, error: 'score-unavailable' });
  });

  it('treats an empty document as unavailable — a blank stave is not a passage', async () => {
    h.text.mockResolvedValue('   ');

    await expect(resolveGateMaterial({ kind: 'score', source: 'files:docs/sheet-music/four-bars.musicxml' }))
      .resolves.toEqual({ ok: false, error: 'score-unavailable' });
  });

  it('does not go looking for a score the level did not name', async () => {
    await expect(resolveGateMaterial({ kind: 'score', measures: [1, 4] }))
      .resolves.toEqual({ ok: false, error: 'score-unavailable' });
    expect(h.text).not.toHaveBeenCalled();
  });

  it('drops a measure range nothing could read, and asks for the whole score', async () => {
    h.text.mockResolvedValue(FOUR_BARS);
    const measuresFor = async (measures) => (await resolveGateMaterial({
      kind: 'score', source: 'four-bars.musicxml', measures,
    })).score.measures;

    expect(await measuresFor([4, 2])).toBe(null); // backwards
    expect(await measuresFor([0, 3])).toBe(null); // bar 0 is not a bar
    expect(await measuresFor('1-4')).toBe(null); // not a pair at all
    expect(await measuresFor(undefined)).toBe(null);
    // Bar 1.9 is not a bar. Truncating it into "bars 1 to 3" would be a guess
    // that puts a child in front of music nobody asked for, with nothing on
    // screen to say so — the exact failure this validation exists to refuse.
    expect(await measuresFor([1.9, 3.2])).toBe(null);
    expect(await measuresFor(['1', '4'])).toBe(null); // a bar number is a number
    expect(await measuresFor([3, 3])).toEqual([3, 3]); // one bar is a passage
  });

  it('declines anything else, including nothing at all', async () => {
    await expect(resolveGateMaterial({ kind: 'chart' })).resolves.toEqual({ ok: false, error: 'unknown-material-kind' });
    await expect(resolveGateMaterial(null)).resolves.toEqual({ ok: false, error: 'unknown-material-kind' });
    await expect(resolveGateMaterial()).resolves.toEqual({ ok: false, error: 'unknown-material-kind' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('keysInstance — the lit-key ask, synthesized locally', () => {
  it('turns notes:1 into one white key between C4 and B4, in a single unordered event', () => {
    const instance = keysInstance({ kind: 'keys', notes: 1, arrangement: 'together' }, 0);
    expect(instance.events).toHaveLength(1);
    expect(instance.events[0].notes).toHaveLength(1);
    const [{ midi }] = instance.events[0].notes;
    expect([60, 62, 64, 65, 67, 69, 71]).toContain(midi);
    // Nothing to put in order, so nothing may be graded on order.
    expect(instance.ordering).toBe('any');
  });

  it('spaces a dyad a third to a fifth apart', () => {
    for (let pickIndex = 0; pickIndex < 12; pickIndex += 1) {
      const instance = keysInstance({ kind: 'keys', notes: 2, arrangement: 'together' }, pickIndex);
      expect(instance.events).toHaveLength(1);
      const [low, high] = instance.events[0].notes.map((note) => note.midi);
      expect(high - low, `pickIndex ${pickIndex}`).toBeGreaterThanOrEqual(3); // a minor third
      expect(high - low, `pickIndex ${pickIndex}`).toBeLessThanOrEqual(7); // a perfect fifth
    }
  });

  it('lays a sequence out as one note per event, and asks for them in order', () => {
    const instance = keysInstance({ kind: 'keys', notes: 3, arrangement: 'sequence' }, 1);
    expect(instance.events).toHaveLength(3);
    for (const event of instance.events) expect(event.notes).toHaveLength(1);
    expect(instance.ordering).toBe('strict');
  });

  it('is deterministic in pickIndex, and consecutive picks are not the same ask', () => {
    // The gate persists the pick counter, so "the same key twice running" is a
    // thing a child would meet in practice rather than a theoretical case.
    const at = (pickIndex) => keysInstance({ kind: 'keys', notes: 1 }, pickIndex)
      .events.flatMap((event) => event.notes.map((note) => note.midi));
    expect(at(4)).toEqual(at(4));
    for (let pickIndex = 0; pickIndex < 8; pickIndex += 1) {
      expect(at(pickIndex), `pickIndex ${pickIndex}`).not.toEqual(at(pickIndex + 1));
    }
  });

  it('is runnable: it carries a tempo, a level and free support', () => {
    // A free attempt still compiles a tempo map. An instance with no tempo at
    // all reaches `compileAssessmentExpectation` with NaN.
    const instance = keysInstance({ kind: 'keys', notes: 1 }, 0);
    expect(instance.tempo?.start_bpm).toBeGreaterThan(0);
    expect(instance.supports).toContain('free');
    expect(typeof instance.id).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pickGateMaterial — a level becomes something the run can grade', () => {
  beforeEach(() => {
    h.instance.mockReset();
    h.instances.mockReset();
    h.catalog.mockReset();
    h.text.mockReset();
  });

  it('serves a keys level without touching the network', async () => {
    const picked = await pickGateMaterial(
      level({ tier: 0, material: [{ kind: 'keys', notes: 1, arrangement: 'together' }] }),
      { pickIndex: 0, mode: 'free' },
    );

    expect(picked.ok).toBe(true);
    expect(picked.material.kind).toBe('keys');
    expect(picked.instance).toBe(picked.material.instance);
    expect(picked.material.instanceId).toBeUndefined();
    expect(h.instance).not.toHaveBeenCalled();
    expect(h.instances).not.toHaveBeenCalled();
    expect(h.catalog).not.toHaveBeenCalled();
  });

  it('builds the scales-bank id for a collection/roots spec and rotates the root', async () => {
    h.instance.mockImplementation(async (id) => ({ ok: true, status: 200, data: { id, key: id.split('root=')[1]?.[0] } }));
    const l2 = level({ material: [{ kind: 'exercise', collection: 'scales', roots: ['G', 'D', 'F'], hands: 'right' }] });

    const first = await pickGateMaterial(l2, { pickIndex: 0, mode: 'free' });
    const second = await pickGateMaterial(l2, { pickIndex: 1, mode: 'free' });

    expect(first.material.instanceId).toBe('scales/modes@root=G,mode=ionian,direction=up,span_octaves=1');
    expect(second.material.instanceId).toBe('scales/modes@root=D,mode=ionian,direction=up,span_octaves=1');
    // The bank was asked once per pick, and the instance came back attached.
    expect(first.instance.id).toBe(first.material.instanceId);
    // No catalog walk: the id is derivable, so there is nothing to search for.
    expect(h.catalog).not.toHaveBeenCalled();
  });

  it('takes a named instanceId as given', async () => {
    h.instance.mockResolvedValue({ ok: true, status: 200, data: { id: 'scales/modes@root=C', key: 'C' } });
    const picked = await pickGateMaterial(
      level({ material: [{ kind: 'exercise', instanceId: 'scales/modes@root=C' }] }), { pickIndex: 0, mode: 'free' },
    );
    expect(picked.material).toMatchObject({ kind: 'exercise', instanceId: 'scales/modes@root=C' });
    expect(h.instance).toHaveBeenCalledWith('scales/modes@root=C');
  });

  it('walks the catalog for a collection it cannot address directly', async () => {
    h.catalog.mockResolvedValue({
      ok: true, status: 200, data: { seeds: [{ id: 'chords/triads', category: 'chords', supports: ['free'] }] },
    });
    h.instances.mockResolvedValue({
      ok: true, status: 200, data: { instances: [{ id: 'chords/triads@root=C', supports: ['free'] }] },
    });
    const picked = await pickGateMaterial(
      level({ material: [{ kind: 'exercise', collection: 'chords' }] }), { pickIndex: 0, mode: 'free' },
    );
    expect(picked.ok).toBe(true);
    expect(picked.material.instanceId).toBe('chords/triads@root=C');
  });

  it('serves a score level, and does NOT fetch the document at pick time', async () => {
    const picked = await pickGateMaterial(
      level({ material: [{ kind: 'score', source: 'files:fur-elise.musicxml', measures: [1, 4] }] }),
      { pickIndex: 0, mode: 'free' },
    );

    expect(picked.ok).toBe(true);
    expect(picked.material).toEqual({ kind: 'score', source: 'files:fur-elise.musicxml', measures: [1, 4] });
    // A score has no bank instance and never gains one: the passage IS the
    // material, and its expectation comes from the engraver, not the bank.
    expect(picked.instance).toBe(null);
    expect(picked.skipped).toEqual([]);
    // The document is fetched ONCE, by the run — a pick that fetched too would
    // pull a whole score over the wire for a level the rotation may skip.
    expect(h.text).not.toHaveBeenCalled();
    expect(h.instance).not.toHaveBeenCalled();
  });

  it('skips a score entry the level did not give a source, and serves its other material', async () => {
    h.instance.mockResolvedValue({ ok: true, status: 200, data: { id: 'scales/modes@root=C' } });
    // pickIndex 1 lands on the score entry; the level still has something to play.
    const picked = await pickGateMaterial(level({
      material: [
        { kind: 'exercise', instanceId: 'scales/modes@root=C' },
        { kind: 'score', measures: [1, 4] },
      ],
    }), { pickIndex: 1, mode: 'free' });

    expect(picked.ok).toBe(true);
    expect(picked.material.instanceId).toBe('scales/modes@root=C');
    expect(picked.skipped).toContainEqual({ kind: 'score', reason: 'no-score-source' });
  });

  it('reports, rather than throws, when nothing in the level resolves', async () => {
    h.instance.mockResolvedValue({ ok: false, status: 502, data: null });
    const picked = await pickGateMaterial(
      level({ material: [{ kind: 'exercise', instanceId: 'scales/modes@root=C' }] }), { pickIndex: 0, mode: 'free' },
    );
    expect(picked.ok).toBe(false);
    expect(picked.error).toBe('instance-unavailable');

    const unknown = await pickGateMaterial(level({ material: [{ kind: 'chart' }] }), { pickIndex: 0, mode: 'free' });
    expect(unknown.error).toBe('unknown-material-kind');

    const nothing = await pickGateMaterial(level({ material: [] }), { pickIndex: 0, mode: 'free' });
    expect(nothing.ok).toBe(false);
    expect(nothing.error).toBe('no-material-in-level');
  });

  it('honours the level mode when it filters the catalog', async () => {
    h.catalog.mockResolvedValue({
      ok: true, status: 200, data: { seeds: [{ id: 'chords/triads', category: 'chords', supports: ['free'] }] },
    });
    const picked = await pickGateMaterial(
      level({ material: [{ kind: 'exercise', collection: 'chords' }] }), { pickIndex: 0, mode: 'cued' },
    );
    expect(picked.ok).toBe(false);
    expect(picked.error).toBe('no-seed-for-level');
  });
});
