/**
 * repairNotes — drop strava_notes that echo our own description and un-double
 * the Strava copy. Built for the 2026-09-25 audit: 91 echoed notes, 38 doubled
 * activities, 3 genuine typed notes in the prior 90 days.
 */
import { describe, it, expect, vi } from 'vitest';
import { repairSession } from './repairNotes.mjs';

const MEMO = '🎙️ "We finished the horror cup together."';
const MEDIA = '🖥️ Game Cycling — Sonic & Sega All Stars Racing';
const CLEAN = `${MEMO}\n\n${MEDIA}`;
const DOUBLED = `${MEMO}\n\n📝 "${CLEAN}"\n\n${MEDIA}`;

const session = (extra = {}) => ({
  sessionId: '20260925140616',
  participants: { kckern: { strava: { activityId: 20328730789 } } },
  timeline: {
    events: [
      { type: 'voice_memo', timestamp: 1, data: { transcript: 'We finished the horror cup together.' } },
      { type: 'media', timestamp: 2, data: { grandparentTitle: 'Game Cycling', title: 'Sonic & Sega All Stars Racing', contentType: 'episode' } },
    ],
  },
  ...extra,
});

const deps = (description, overrides = {}) => ({
  getActivity: vi.fn().mockResolvedValue({ id: 20328730789, name: 'Game Cycling—Sonic & Sega All Stars Racing', description }),
  updateActivity: vi.fn().mockResolvedValue({}),
  selectionConfig: {},
  write: true,
  ...overrides,
});

describe('repairSession', () => {
  it('rewrites a doubled description we pushed, drops the echo, records provenance', async () => {
    const s = session({ strava_notes: { text: CLEAN }, strava: { pushed: { name: 'n', description: DOUBLED } } });
    const d = deps(DOUBLED);
    const r = await repairSession(s, d);

    expect(d.updateActivity).toHaveBeenCalledWith('20328730789', { description: CLEAN });
    expect(r).toMatchObject({ changed: true, notes: 'dropped', strava: 'rewritten' });
    expect(r.session.strava_notes).toBeUndefined();
    expect(r.session.strava.pushed.description).toBe(CLEAN);
    expect(s.strava_notes.text).toBe(CLEAN); // input untouched
  });

  it('dry run reads Strava but never writes it', async () => {
    const d = deps(DOUBLED, { write: false });
    const r = await repairSession(session({ strava_notes: { text: CLEAN }, strava: { pushed: { description: DOUBLED } } }), d);

    expect(d.updateActivity).not.toHaveBeenCalled();
    expect(r.strava).toBe('would be rewritten');
    expect(r.session.strava.pushed.description).toBe(DOUBLED);
  });

  it('leaves a description edited on Strava alone (current ≠ what we pushed)', async () => {
    const d = deps('My own words.');
    const r = await repairSession(session({ strava_notes: { text: CLEAN }, strava: { pushed: { description: DOUBLED } } }), d);

    expect(d.updateActivity).not.toHaveBeenCalled();
    expect(r.strava).toMatch(/edited/);
    expect(r.session.strava_notes).toBeUndefined(); // the local echo still goes
  });

  it('no provenance and all-ours on Strava → rewrite', async () => {
    const d = deps(DOUBLED);
    const r = await repairSession(session({ strava_notes: { text: CLEAN } }), d);
    expect(r.strava).toBe('rewritten');
  });

  it('no provenance and typed text on Strava → keep', async () => {
    const d = deps(`${DOUBLED}\n\nLegs toast.`);
    const r = await repairSession(session({ strava_notes: { text: CLEAN } }), d);
    expect(d.updateActivity).not.toHaveBeenCalled();
    expect(r.strava).toMatch(/edited/);
  });

  it('repairs a doubled push even when the session no longer has notes', async () => {
    const d = deps(DOUBLED);
    const r = await repairSession(session({ strava: { pushed: { description: DOUBLED } } }), d);
    expect(r).toMatchObject({ changed: true, notes: 'none', strava: 'rewritten' });
  });

  it('does not fetch when provenance says Strava is clean', async () => {
    const d = deps(CLEAN);
    const r = await repairSession(session({ strava_notes: { text: CLEAN }, strava: { pushed: { description: CLEAN } } }), d);
    expect(d.getActivity).not.toHaveBeenCalled();
    expect(r).toMatchObject({ changed: true, notes: 'dropped', strava: 'clean per provenance' });
  });

  it('keeps genuine notes and reports no change', async () => {
    const d = deps(CLEAN);
    const r = await repairSession(session({ strava_notes: { text: 'Forgot to stop the watch.' }, strava: { pushed: { description: CLEAN } } }), d);
    expect(r).toMatchObject({ changed: false, notes: 'kept' });
  });

  it('a failed fetch or update saves nothing, so the next run retries', async () => {
    const s = session({ strava_notes: { text: CLEAN }, strava: { pushed: { description: DOUBLED } } });
    const fetchFail = await repairSession(s, deps(DOUBLED, { getActivity: vi.fn().mockRejectedValue(new Error('GET failed (429)')) }));
    expect(fetchFail).toMatchObject({ changed: false, strava: 'fetch failed' });
    expect(fetchFail.session).toBeUndefined();

    const updateFail = await repairSession(s, deps(DOUBLED, { updateActivity: vi.fn().mockRejectedValue(new Error('PUT failed (500)')) }));
    expect(updateFail).toMatchObject({ changed: false, strava: 'update failed' });
    expect(updateFail.session).toBeUndefined();
  });
});
