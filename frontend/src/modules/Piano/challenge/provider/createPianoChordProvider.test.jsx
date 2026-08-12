import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../MusicNotation/renderers/AbcRenderer.jsx', () => ({ AbcRenderer: () => null }));

import {
  applyScaleNoteFeedback,
  createPianoChordProvider,
} from './createPianoChordProvider.jsx';

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
  it('asks the Piano backend to materialize semantic game requirements', async () => {
    const api = {
      preparePianoChallenge: vi.fn(async () => ({
        prompt: { label: 'F major scale', key_signature: 'F', expected_midi: [65, 67, 69] },
        timeout_ms: 1234,
        pedagogy_policy_version: 'policy-v1',
        selection: { curriculum: 'foundation-major-scales' },
      })),
    };
    const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'semantic-1', kind: 'scale',
      requirements: { curriculum: 'foundation-major-scales' },
      context: { challenge_sequence: 2 },
    });

    expect(api.preparePianoChallenge).toHaveBeenCalledWith('guest', expect.objectContaining({
      challenge_id: 'semantic-1', requirements: { curriculum: 'foundation-major-scales' },
    }));
    expect(prepared).toMatchObject({
      prompt: { label: 'F major scale', expected_midi: [65, 67, 69] },
      timeout_ms: 1234,
      pedagogy_policy_version: 'policy-v1',
    });
  });

  it('returns aggregate scale experience metrics without logging every note', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 1000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async () => ({ attempt_id: 'saved-attempt' })) };
    const logger = { warn: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger });
    const request = {
      challenge_id: 'challenge-1', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', expected_midi: [60, 62, 64] },
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
    expect(api.recordPianoAttempt).toHaveBeenCalledOnce();
  });

  it('lets journey players correct a wrong ordered note without restarting the exercise', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 3000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const runtime = await provider.createRuntime({ userId: 'kid-1', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'journey-correction', kind: 'arpeggio',
      prompt: { exercise_id: 'arp-c', label: 'C arpeggio', expected_midi: [60, 64, 67], key_signature: 'C' },
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
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.score).toBeLessThan(0.75);
  });

  it('grades a journey chord from pitch-set accuracy and onset simultaneity', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 4000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const runtime = await provider.createRuntime({ userId: 'kid-1', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'journey-chord', kind: 'chord',
      prompt: {
        exercise_id: 'chord-c-major', label: 'C major chord', root: 0,
        pitch_classes: [0, 4, 7], expected_midi: [60, 64, 67],
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
    expect(result.score).toBeCloseTo(0.928);
    expect(result.metrics).toMatchObject({
      firstTry: true, pitchSetAccuracy: 1, onsetSpanMs: 60, simultaneity: 0.76,
    });
  });

  it('ignores keys pressed between prepare and start rather than grading them as the performance', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 8000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const logger = { warn: vi.fn(), info: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'kid-1', api, logger });
    // The surface stays mounted across a journey's encounters, so the history
    // cursor baselines when the NEXT challenge is prepared — everything the
    // player touches while the card animates is still pending at start().
    const view = render(<runtime.Surface />);
    const prepared = await runtime.prepare({
      challenge_id: 'pre-start', kind: 'timed-pattern',
      prompt: {
        exercise_id: 'pattern-c-step', label: 'C step pattern', key_signature: 'C',
        expected_midi: [60, 62, 64, 65], tempo_bpm: 60,
      },
    });
    await act(async () => view.rerender(<runtime.Surface />));

    notes = {
      ...notes,
      noteHistory: [60, 62, 64, 65].map((note, index) => ({ note, startTime: now + index })),
    };
    await act(async () => view.rerender(<runtime.Surface />));

    now += 500;
    const resultPromise = runtime.start(prepared);
    await act(async () => view.rerender(<runtime.Surface />));

    // Nothing was played since the attempt began, so the challenge is still open.
    const progressText = () => view.container.querySelector('.piano-scale-challenge__feedback strong').textContent;
    expect(progressText()).toBe('0 / 4');
    expect(logger.warn).toHaveBeenCalledWith(
      'piano.challenge.pre-start-input-ignored',
      expect.objectContaining({ challengeId: 'pre-start', ignored: 4 }),
    );

    for (const note of [60, 62, 64, 65]) {
      now += 1000;
      notes = { ...notes, noteHistory: [...notes.noteHistory, { note, startTime: now }] };
      await act(async () => view.rerender(<runtime.Surface />));
    }
    const result = await resultPromise;

    expect(result.metrics).toMatchObject({ notesPlayed: 4, staleInputsIgnored: 4 });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(4000);
  });

  it('records an abandoned attempt when the runtime is disposed mid-challenge', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 9000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => ({ ...attempt, attempt_id: 'saved-abandon' })) };
    const logger = { warn: vi.fn(), info: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'kid-1', api, logger });
    const prepared = await runtime.prepare({
      challenge_id: 'abandon-1', kind: 'scale',
      prompt: { exercise_id: 'scale-c-major', label: 'C major scale', key_signature: 'C', expected_midi: [60, 62, 64] },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    now += 200;
    notes = { ...notes, noteHistory: [{ note: 60, startTime: now }] };
    await act(async () => view.rerender(<runtime.Surface />));

    now += 300;
    await act(async () => { runtime.dispose(); });

    await expect(resultPromise).resolves.toMatchObject({ status: 'aborted', score: null });
    expect(api.recordPianoAttempt).toHaveBeenCalledWith('kid-1', expect.objectContaining({
      status: 'aborted',
      challenge_id: 'abandon-1',
      kind: 'scale',
      prompt: expect.objectContaining({ exercise_id: 'scale-c-major' }),
      metrics: expect.objectContaining({ reason: 'disposed', notesPlayed: 1, durationMs: 500 }),
    }), expect.objectContaining({ keepalive: true }));
    expect(logger.info).toHaveBeenCalledWith(
      'piano.challenge.abandoned',
      expect.objectContaining({ challengeId: 'abandon-1', attemptId: 'saved-abandon', notesPlayed: 1 }),
    );
  });

  it('does not record an attempt for a challenge that was disposed before it started', async () => {
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
    const runtime = await provider.createRuntime({ userId: 'kid-1', api, logger: { warn: vi.fn(), info: vi.fn() } });
    await runtime.prepare({
      challenge_id: 'never-started', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', expected_midi: [60] },
    });

    runtime.dispose();
    await Promise.resolve();

    expect(api.recordPianoAttempt).not.toHaveBeenCalled();
  });

  it('fizzles a scale card after its authored mistake limit', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 2000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async () => ({ attempt_id: 'failed-attempt' })) };
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'challenge-fizzle', kind: 'scale',
      prompt: {
        label: 'C major', key_signature: 'C', expected_midi: [60, 62, 64], max_mistakes: 3,
      },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    for (const note of [61, 63, 65]) {
      now += 100;
      notes = { ...notes, noteHistory: [...notes.noteHistory, { note, startTime: now }] };
      await act(async () => view.rerender(<runtime.Surface />));
    }
    const result = await resultPromise;

    expect(result).toMatchObject({ status: 'completed', score: 0, attempt_id: 'failed-attempt' });
    expect(result.metrics).toMatchObject({
      failed: true,
      firstTry: false,
      wrongNotes: 3,
      wrongInputs: [
        { played: 61, expected: 60, progress: 0 },
        { played: 63, expected: 60, progress: 0 },
        { played: 65, expected: 60, progress: 0 },
      ],
    });
  });

  it('terminates and records an attempt when the challenge times out', async () => {
    vi.useFakeTimers();
    try {
      const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
      const provider = createPianoChordProvider({ useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }) });
      const runtime = await provider.createRuntime({ userId: 'guest', api, logger: { warn: vi.fn() } });
      const prepared = await runtime.prepare({
        challenge_id: 'timeout-1', kind: 'scale', timeout_ms: 1000,
        prompt: { label: 'C major', key_signature: 'C', expected_midi: [60] },
      });
      const resultPromise = runtime.start(prepared);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;
      expect(result).toMatchObject({ status: 'timeout', score: null, metrics: { reason: 'challenge_timeout', timeoutMs: 1000 } });
      expect(api.recordPianoAttempt).toHaveBeenCalledWith(
        'guest',
        expect.objectContaining({ status: 'timeout' }),
        { keepalive: false },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a disconnected challenge open and grades input from the on-screen keyboard', async () => {
    const connection = { connected: false, status: 'disconnected' };
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({
      useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }),
      useConnection: () => connection,
    });
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'disconnect-1', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', expected_midi: [60] },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    expect(screen.getByRole('group', { name: 'On-screen piano keyboard' })).toBeTruthy();
    expect(screen.getByText('No piano connected — tap the keys below.')).toBeTruthy();

    const c4 = view.container.querySelector('[data-note="60"]');
    await act(async () => fireEvent.pointerDown(c4, { pointerId: 1 }));
    const result = await resultPromise;
    expect(result).toMatchObject({
      status: 'completed', score: 1,
      metrics: { firstTry: true, notesPlayed: 1, notesRequired: 1 },
    });
    expect(api.recordPianoAttempt).toHaveBeenCalledWith(
      'guest',
      expect.objectContaining({ status: 'completed' }),
      { keepalive: false },
    );
  });

  it('continues an in-progress scale on the on-screen keyboard after MIDI disconnects', async () => {
    let connection = { connected: true, status: 'connected' };
    let notes = { activeNotes: new Map(), noteHistory: [] };
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({
      useNotes: () => notes,
      useConnection: () => connection,
    });
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'disconnect-mid-scale', kind: 'scale',
      prompt: { label: 'C to D', key_signature: 'C', expected_midi: [60, 62] },
    });
    const resultPromise = runtime.start(prepared);
    const view = render(<runtime.Surface />);

    notes = { ...notes, noteHistory: [{ note: 60, startTime: 100 }] };
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
    const api = { recordPianoAttempt: vi.fn(async (_userId, attempt) => attempt) };
    const provider = createPianoChordProvider({
      useNotes: () => ({ activeNotes: new Map(), noteHistory: [] }),
      useConnection: () => ({ connected: false, status: 'no-input' }),
      clock: () => 5000,
    });
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger: { warn: vi.fn() } });
    const prepared = await runtime.prepare({
      challenge_id: 'virtual-chord', kind: 'chord',
      prompt: {
        exercise_id: 'c-major', label: 'C major chord', root: 0,
        pitch_classes: [0, 4, 7], expected_midi: [60, 64, 67],
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
