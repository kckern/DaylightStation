import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { createCoachPlan, applyCoachEvent } from '../../../../../../../shared/music/learnCoach.mjs';

const h = vi.hoisted(() => ({ user: 'learner4', states: new Map(), calls: [], defer: null }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: h.user }) }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfigOptional: () => ({ config: { timezone: 'America/Los_Angeles' } }) }));
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, warn() {}, error() {} }) }) }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: async (path, body, method) => {
  h.calls.push({ path, body, method });
  const user = path.split('/users/')[1].split('/')[0];
  if (path.endsWith('/attempts')) { if (h.defer) await h.defer;return body; }
  if (method === 'POST') h.states.set(user, applyCoachEvent(h.states.get(user), body.event, { plan, now: '2026-10-26T18:00:00Z', dayKey: '2026-10-26' }));
  const state = h.states.get(user) ?? null;return { state, revision: state?.revision ?? 0, legacy: {} };
} }));
import useLearnCoach from './useLearnCoach.js';
const plan = createCoachPlan({ scoreId: 'files:test.musicxml', fingerprint: 'content-a', segments: [{ id: 'opening', inMeasure: 0, outMeasure: 3, playableParts: ['rh', 'lh'] }], tempoMap: [{ onsetQuarter: 0, bpm: 100 }] });
const good = { status: 'completed', inputContractVersion: 'onsets-v1', criteria: { completeness: 1, cleanliness: 1 }, verdict: { passed: true }, diagnostics: { expected_notes: 3, matched_notes: 3, wrong_notes: 0, missed_notes: 0 } };
beforeEach(() => { localStorage.clear();h.user = 'learner4';h.states.clear();h.calls = [];h.defer = null; });

describe('Learn coaching lifecycle', () => {
  it('loads and saves after React replays the effect lifecycle in StrictMode', async () => {
    const { result } = renderHook(() => useLearnCoach({ plan }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.record(plan.tasks[0], { ...good, assessmentId: 'strict-one' }); });
    expect(result.current.saveStatus).toBe('saved');
  });
  it('restores a deliberately selected task and records successful takes through acknowledged state', async () => {
    const { result } = renderHook(() => useLearnCoach({ plan }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.selectTask(plan.tasks[1]); });
    expect(result.current.projection.recommended.skill).toBe('left');
    await act(async () => { await result.current.record(plan.tasks[1], { ...good, assessmentId: 'one' }); });
    await act(async () => { await result.current.record(plan.tasks[1], { ...good, assessmentId: 'two' }); });
    expect(result.current.projection.segments[0].skills.find((s) => s.skill === 'left').ready).toBe(true);
    expect(result.current.saveStatus).toBe('saved');
  });

  it('does not display or credit another child when an old request resolves after a profile switch', async () => {
    let release;h.defer = new Promise((resolve) => { release = resolve; });
    const { result, rerender } = renderHook(() => useLearnCoach({ plan }));await waitFor(() => expect(result.current.loaded).toBe(true));
    let pending;act(() => { pending = result.current.record(plan.tasks[0], { ...good, assessmentId: 'old-profile' }); });
    h.user = 'learner5';rerender();
    expect(result.current.state?.evidence ?? []).toHaveLength(0);
    await act(async () => { release();await pending; });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.state?.evidence ?? []).toHaveLength(0);
    expect(h.calls.filter((call) => call.path.endsWith('/attempts'))[0].path).toContain('/learner4/');
  });

  it('keeps guest learning in the session and never issues profile persistence requests', async () => {
    h.user = 'guest';const { result } = renderHook(() => useLearnCoach({ plan }));
    await act(async () => { await result.current.record(plan.tasks[0], { ...good, assessmentId: 'guest-one' }); });
    expect(result.current.saveStatus).toBe('guest');
    expect(result.current.state.evidence).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  });
});
