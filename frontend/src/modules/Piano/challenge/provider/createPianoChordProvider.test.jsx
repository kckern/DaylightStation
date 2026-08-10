import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

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
  it('returns aggregate scale experience metrics without logging every note', async () => {
    let notes = { activeNotes: new Map(), noteHistory: [] };
    let now = 1000;
    const provider = createPianoChordProvider({ useNotes: () => notes, clock: () => now });
    const api = { recordPianoAttempt: vi.fn(async () => ({ attempt_id: 'saved-attempt' })) };
    const logger = { warn: vi.fn() };
    const runtime = await provider.createRuntime({ userId: 'guest', api, logger });
    const request = {
      challenge_id: 'challenge-1', kind: 'scale',
      prompt: { label: 'C major', key_signature: 'C', abc: 'C D E', expected_midi: [60, 62, 64] },
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
});
