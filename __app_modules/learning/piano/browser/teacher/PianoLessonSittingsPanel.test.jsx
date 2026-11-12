import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ lessonSittings: vi.fn() }));
vi.mock('../learning.mjs', () => ({ pianoLearningApi: api }));

import PianoLessonSittingsPanel from './PianoLessonSittingsPanel.jsx';

const row = (extra) => ({
  sittingId: 's1', plexId: 'plex:1', title: 'Lesson A', updatedAt: '2026-11-12T15:00:00Z', percent: 95,
  playedSec: 600, practiceNotes: 30, score: 3, scoreSource: 'model', outcome: 'drill-owed',
  drillReps: 4, drillsPassed: 0, checkIns: 3, scaleCheckIns: 1, ...extra,
});

beforeEach(() => { api.lessonSittings.mockReset(); });

describe('PianoLessonSittingsPanel', () => {
  it('a low-score row shows score, check-ins, rates, drill and "Not counted yet"', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [row()] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('3/10')).toBeTruthy();
    expect(screen.getByText('3 (1 scales)')).toBeTruthy();
    expect(screen.getByText('3/min')).toBeTruthy();
    expect(screen.getByText('4 scales, passed 0')).toBeTruthy();
    expect(screen.getByText('Not counted yet')).toBeTruthy();
    expect(api.lessonSittings).toHaveBeenCalledWith('kid', 14);
  });

  it('an after-drill row', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [row({ outcome: 'credited-after-drills', drillsPassed: 4, score: 4.6 })] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('Counted after warm-up')).toBeTruthy();
    expect(screen.getByText('4.6/10')).toBeTruthy();
    expect(screen.getByText('4 scales, passed 4')).toBeTruthy();
  });

  it('a sitting the judge never answered says so', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [row({ outcome: 'credited', score: null, scoreSource: 'fallback', sittingId: 'a' }), row({ outcome: 'drill-owed', score: 0, scoreSource: 'fallback', sittingId: 'b' })] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('no judge')).toBeTruthy();
    expect(screen.getByText('0/10 · no judge')).toBeTruthy();
  });

  it('empty state', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('No piano lessons in the last two weeks.')).toBeTruthy();
  });
});
