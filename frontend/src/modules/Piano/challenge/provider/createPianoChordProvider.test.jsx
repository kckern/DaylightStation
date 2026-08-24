import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../MusicNotation/renderers/AbcRenderer.jsx', () => ({ AbcRenderer: () => null }));

import {
  applyScaleNoteFeedback,
  createPianoChordProvider,
} from './createPianoChordProvider.jsx';

const sequence = (midis) => midis.map((midi, index) => ({
  id: `event:${index}`, onsetQuarter: index, durationQuarters: 1,
  notes: [{ id: `note:${index}`, midi, hand: 'unassigned' }],
}));
const chord = (midis) => [{
  id: 'event:0', onsetQuarter: 0, durationQuarters: 1,
  notes: midis.map((midi, index) => ({ id: `note:${index}`, midi, hand: 'unassigned' })),
}];

describe('scale staff feedback', () => {
  it('marks completed notes green and identifies the next engraved note', () => {
    const elements = Array.from({ length: 4 }, () => document.createElementNS('http://www.w3.org/2000/svg', 'path'));
    const staffNotes = [[
      { els: [elements[0]] },
      { els: [elements[1]] },
      { els: [elements[2]] },
      { els: [elements[3]] },
    ]];

    applyScaleNoteFeedback(staffNotes, 2, { status: 'correct' });

    expect(elements[0].classList.contains('piano-scale-note--complete')).toBe(true);
    expect(elements[1].classList.contains('piano-scale-note--complete')).toBe(true);
    expect(elements[2].classList.contains('piano-scale-note--next')).toBe(true);
    expect(elements[3].classList).toHaveLength(0);
  });

  it('moves wrong-note feedback to the note the player must retry', () => {
    const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const staffNotes = [[{ els: [first] }, { els: [second] }]];

    applyScaleNoteFeedback(staffNotes, 0, { status: 'wrong' });

    expect(first.classList.contains('piano-scale-note--wrong')).toBe(true);
    expect(second.classList).toHaveLength(0);
  });
});

describe('createPianoChordProvider telemetry', () => {
  it('rejects contradictory canonical assessment and grading configuration', async () => {
    const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
    const runtime = await provider.createRuntime({
      userId: 'guest',
      services: { recordAttempt: vi.fn() },
      logger: { warn: vi.fn() },
    });
    const base = {
      challenge_id: 'contradictory-config', kind: 'timed-pattern',
      prompt: { label: 'C pattern', expected_events: sequence([60, 62]) },
    };

    await expect(runtime.prepare({
      ...base,
      assessment: { mode: 'free', tempo_bpm: null, lead_in_ms: 0 },
      requirement: { mode: 'cued' },
    })).rejects.toThrow('does not match requirement mode');

    await expect(runtime.prepare({
      ...base,
      assessment: { mode: 'cued', tempo_bpm: 80, lead_in_ms: 0 },
      requirement: { mode: 'cued', gates: { pace: { target_bpm: 90 } } },
    })).rejects.toThrow('does not match requirement tempo');
  });

  it('uses the battle context as the single compact challenge heading', async () => {
    const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
    const runtime = await provider.createRuntime({
      userId: 'guest',
      services: { recordAttempt: vi.fn(async (_userId, attempt) => attempt) },
      logger: { warn: vi.fn() },
    });
    const prepared = await runtime.prepare({
      challenge_id: 'compact-heading', kind: 'scale',
      prompt: {
        label: 'C major scale', key_signature: 'C', expected_events: sequence([60, 62]), tempo_bpm: 80,
      },
      assessment: { mode: 'cued', tempo_bpm: 80, lead_in_ms: 0 },
    });
    const resultPromise = runtime.start(prepared);
    render(<runtime.Surface compact headerContext="Vine Whip · Scales" />);

    expect(screen.getByText('Vine Whip · Scales · 80 BPM')).toBeTruthy();
    expect(screen.getByText('C major scale')).toBeTruthy();
    expect(screen.queryByText(/Play with the pulse/)).toBeNull();
    await act(async () => {
      runtime.cancel('test-complete');
      await resultPromise;
    });
  });

  it('asks the Piano backend to materialize semantic game requirements', async () => {
    const api = {
      prepareChallenge: vi.fn(async () => ({
        prompt: { label: 'F major scale', key_signature: 'F', expected_events: sequence([65, 67, 69]) },
        assessment: { mode: 'free', tempo_bpm: null, lead_in_ms: 0 },
        timeout_ms: 1234,
        pedagogy_policy_version: 'policy-v1',
        selection: { collection: 'major-scales' },
      })),
    };
    const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
    const runtime = await provider.createRuntime({ userId: 'guest', services: api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'semantic-1', kind: 'scale',
      requirements: { collection: 'major-scales' },
      context: { challenge_sequence: 2 },
    });

    expect(api.prepareChallenge).toHaveBeenCalledWith('guest', expect.objectContaining({
      challenge_id: 'semantic-1', requirements: { collection: 'major-scales' },
    }));
    expect(prepared).toMatchObject({
      prompt: { label: 'F major scale', expected_events: sequence([65, 67, 69]) },
      timeout_ms: 1234,
      pedagogy_policy_version: 'policy-v1',
    });
  });

  it('returns aggregate scale experience metrics without logging every note', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 1000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordAttempt: vi.fn(async () => ({ attempt_id: 'saved-attempt' })) };
    const logger = { warn: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'guest', services: api, logger });
    const request = {
      challenge_id: 'challenge-1', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', expected_events: sequence([60, 62, 64]) },
    };
    const prepared = await runtime.prepare(request);
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    for (const [index, note] of [60, 62, 64].entries()) {
      now += 100;
      notes = { ...notes, noteHistory: [...notes.noteHistory, { note, startTime: now + index }] };
      await act(async () => view.rerender(<runtime.Surface />));
    }
    now += 50;
    const result = await resultPromise;

    expect(result).toMatchObject({ status: 'completed', score: 1, attempt_id: 'saved-attempt' });
    expect(result.metrics).toMatchObject({
      firstTry: true,
      notesRequired: 3,
      notesPlayed: 3,
      wrongNotes: 0,
      restarts: 0,
      timeToFirstInputMs: 100,
    });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(300);
    expect(result.metrics.persistenceDurationMs).toBeGreaterThanOrEqual(0);
    expect(api.recordAttempt).toHaveBeenCalledOnce();
  });

  it('lets journey players correct a wrong ordered note without restarting the exercise', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 3000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const runtime = await provider.createRuntime({ userId: 'kid-1', services: api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'journey-correction', kind: 'arpeggio',
      prompt: { exercise_id: 'arp-c', label: 'C arpeggio', expected_events: sequence([60, 64, 67]), key_signature: 'C' },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    for (const note of [61, 60, 64, 67]) {
      now += 100;
      notes = { ...notes, noteHistory: [...notes.noteHistory, { note, startTime: now }] };
      await act(async () => view.rerender(<runtime.Surface />));
    }
    const result = await resultPromise;
    expect(result).toMatchObject({
      status: 'completed',
      metrics: { firstTry: false, wrongNotes: 1, restarts: 0, notesRequired: 3 },
    });
    expect(result.score).toBeCloseTo(0.875);
    expect(result.criteria).toEqual({ completeness: 1, cleanliness: 0.75 });
  });

  it('grades a journey chord as an untimed held attempt', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 4000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const runtime = await provider.createRuntime({ userId: 'kid-1', services: api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'journey-chord', kind: 'chord',
      prompt: {
        exercise_id: 'chord-c-major', label: 'C major chord', root: 0,
        pitch_classes: [0, 4, 7], expected_events: chord([60, 64, 67]),
      },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);
    notes = {
      ...notes,
      activeNotes: new Map([
        [60, { velocity: 90, timestamp: now }],
        [64, { velocity: 90, timestamp: now + 30 }],
        [67, { velocity: 90, timestamp: now + 60 }],
      ]),
    };
    await act(async () => view.rerender(<runtime.Surface />));
    const result = await resultPromise;
    expect(result.score).toBe(1);
    expect(result.criteria).toEqual({ completeness: 1, cleanliness: 1 });
    expect(result.metrics).toMatchObject({
      firstTry: true, pitchSetAccuracy: 1, onsetSpanMs: 60,
    });
  });

  it('ignores keys pressed between prepare and start rather than grading them as the performance', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 8000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const logger = { warn: vi.fn(), info: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'kid-1', services: api, logger });
    // The surface stays mounted across a journey's encounters, so the history
    // cursor baselines when the NEXT challenge is prepared — everything the
    // player touches while the card animates is still pending at start().
    const view = render(<runtime.Surface />);
    let prepared;
    await act(async () => {
      prepared = await runtime.prepare({
        challenge_id: 'pre-start', kind: 'timed-pattern',
        prompt: {
          exercise_id: 'pattern-c-step', label: 'C step pattern', key_signature: 'C',
          expected_events: sequence([60, 62, 64, 65]), tempo_bpm: 60,
        },
        assessment: { mode: 'cued', tempo_bpm: 60, lead_in_ms: 0 },
      });
    });
    await act(async () => view.rerender(<runtime.Surface />));

    notes = {
      ...notes,
      noteHistory: [60, 62, 64, 65].map((note, index) => ({ note, startTime: now + index })),
    };
    await act(async () => view.rerender(<runtime.Surface />));

    now += 500;
    let resultPromise;
    act(() => { resultPromise = runtime.start(prepared); });
    await act(async () => view.rerender(<runtime.Surface />));

    // Nothing was played since the attempt began, so the challenge is still open.
    const progressText = () => view.container.querySelector('.piano-scale-challenge__feedback strong').textContent;
    expect(progressText()).toBe('0 / 4');
    expect(logger.warn).toHaveBeenCalledWith(
      'piano.challenge.pre-start-input-ignored',
      expect.not.objectContaining({ notes: expect.anything() }),
    );
    expect(logger.warn.mock.calls.at(-1)[1]).toMatchObject({ challengeId: 'pre-start', ignored: 4 });

    for (const note of [60, 62, 64, 65]) {
      now += 1000;
      notes = { ...notes, noteHistory: [...notes.noteHistory, { note, startTime: now }] };
      await act(async () => view.rerender(<runtime.Surface />));
    }
    let result;
    await act(async () => { result = await resultPromise; });

    expect(result.metrics).toMatchObject({ notesPlayed: 4, staleInputsIgnored: 4 });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(4000);
  });

  it('records an abandoned attempt when the runtime is disposed mid-challenge', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 9000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => ({ ...attempt, attempt_id: 'saved-abandon' })) };
    const logger = { warn: vi.fn(), info: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'kid-1', services: api, logger });
    const prepared = await runtime.prepare({
      challenge_id: 'abandon-1', kind: 'scale',
      prompt: { exercise_id: 'scale-c-major', label: 'C major scale', key_signature: 'C', expected_events: sequence([60, 62, 64]) },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    now += 200;
    notes = { ...notes, noteHistory: [{ note: 60, startTime: now }] };
    await act(async () => view.rerender(<runtime.Surface />));

    now += 300;
    await act(async () => { runtime.dispose(); });

    const abandoned = await resultPromise;
    expect(abandoned).toMatchObject({ status: 'aborted' });
    expect(abandoned).not.toHaveProperty('score');
    expect(api.recordAttempt).toHaveBeenCalledWith('kid-1', expect.objectContaining({
      status: 'aborted',
      challenge_id: 'abandon-1',
      kind: 'scale',
      prompt: expect.objectContaining({ exercise_id: 'scale-c-major' }),
      metrics: expect.objectContaining({ reason: 'disposed', notesPlayed: 1, durationMs: 500 }),
    }), expect.objectContaining({ keepalive: true }));
    expect(logger.info).toHaveBeenCalledWith('piano.challenge-assessment', expect.objectContaining({
      surface: 'piano-challenge', matcher: 'cursor', mode: 'free', challengeId: 'abandon-1',
      terminalStatus: 'aborted', persistence: 'saved',
    }));
  });

  it('does not record an attempt for a challenge that was disposed before it started', async () => {
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
    const runtime = await provider.createRuntime({ userId: 'kid-1', services: api, logger: { warn: vi.fn(), info: vi.fn() } });
    await runtime.prepare({
      challenge_id: 'never-started', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', expected_events: sequence([60]) },
    });

    runtime.dispose();
    await Promise.resolve();

    expect(api.recordAttempt).not.toHaveBeenCalled();
  });

  it('terminates without persisting a timeout before musical input', async () => {
    vi.useFakeTimers();
    try {
      const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
      const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
      const runtime = await provider.createRuntime({ userId: 'guest', services: api, logger: { warn: vi.fn() } });
      const prepared = await runtime.prepare({
        challenge_id: 'timeout-1', kind: 'scale', timeout_ms: 1000,
        prompt: { label: 'C major', key_signature: 'C', expected_events: sequence([60]) },
      });
      const resultPromise = runtime.start(prepared);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;
      expect(result).toMatchObject({ status: 'timeout', metrics: { reason: 'challenge_timeout', timeoutMs: 1000 } });
      expect(result).not.toHaveProperty('score');
      expect(api.recordAttempt).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a disconnected challenge open and grades input from the on-screen keyboard', async () => {
    const connection = { connected: false, status: 'disconnected' };
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({
      useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }),
      useConnection: () => connection,
    });
    const runtime = await provider.createRuntime({ userId: 'guest', services: api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'disconnect-1', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', expected_events: sequence([60]) },
    });
    const view = render(<runtime.Surface />);

    expect(screen.getByRole('group', { name: 'On-screen piano keyboard' })).toBeTruthy();
    expect(screen.getByText('No piano connected — tap the keys below.')).toBeTruthy();
    expect(view.container.querySelector('.piano-scale-challenge').dataset.inputReady).toBe('false');

    let resultPromise;
    await act(async () => { resultPromise = runtime.start(prepared); });
    expect(view.container.querySelector('.piano-scale-challenge').dataset.inputReady).toBe('true');

    const c4 = view.container.querySelector('[data-note="60"]');
    await act(async () => fireEvent.pointerDown(c4, { pointerId: 1 }));
    const result = await resultPromise;
    expect(result).toMatchObject({
      status: 'completed', score: 1,
      metrics: { firstTry: true, notesPlayed: 1, notesRequired: 1 },
    });
    expect(api.recordAttempt).toHaveBeenCalledWith(
      'guest',
      expect.objectContaining({ status: 'completed' }),
      { keepalive: false },
    );
  });

  it('continues an in-progress scale on the on-screen keyboard after MIDI disconnects', async () => {
    let connection = { connected: true, status: 'connected' };
    let notes = { activeNotes: new Map(), noteHistory: [] };
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({
      useNotes: () => notes,
      useConnection: () => connection,
    });
    const runtime = await provider.createRuntime({ userId: 'guest', services: api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'disconnect-mid-scale', kind: 'scale',
      prompt: { label: 'C to D', key_signature: 'C', expected_events: sequence([60, 62]) },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    notes = { ...notes, noteHistory: [{ note: 60 }] };
    await act(async () => view.rerender(<runtime.Surface />));
    expect(screen.getByText('1 / 2')).toBeTruthy();

    connection = { connected: false, status: 'disconnected' };
    await act(async () => view.rerender(<runtime.Surface />));
    const d4 = view.container.querySelector('[data-note="62"]');
    await act(async () => fireEvent.pointerDown(d4, { pointerId: 2 }));

    await expect(resultPromise).resolves.toMatchObject({
      status: 'completed', score: 1,
      metrics: { firstTry: true, notesPlayed: 2, notesRequired: 2 },
    });
  });

  it('accepts a multi-touch chord from the on-screen keyboard', async () => {
    const api = { recordAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({
      useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }),
      useConnection: () => ({ connected: false, status: 'no-input' }),
      clock: () => 5000,
    });
    const runtime = await provider.createRuntime({ userId: 'guest', services: api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'virtual-chord', kind: 'chord',
      prompt: {
        exercise_id: 'c-major', label: 'C major chord', root: 0,
        pitch_classes: [0, 4, 7], expected_events: chord([60, 64, 67]),
      },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    for (const [pointerId, note] of [60, 64, 67].entries()) {
      const key = view.container.querySelector(`[data-note="${note}"]`);
      await act(async () => fireEvent.pointerDown(key, { pointerId: pointerId + 1 }));
    }

    await expect(resultPromise).resolves.toMatchObject({
      status: 'completed', score: 1,
      metrics: { firstTry: true, notesPlayed: 3, pitchSetAccuracy: 1 },
    });
  });
});
