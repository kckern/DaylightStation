import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ lessonSittings: vi.fn() }));
vi.mock('../learning.mjs', () => ({ pianoLearningApi: api }));

import PianoLessonSittingsPanel from './PianoLessonSittingsPanel.jsx';

const row = (extra) => ({
  sittingId: 's1', plexId: 'plex:1', title: 'Lesson A', updatedAt: '2026-11-12T15:00:00Z', percent: 95,
  playedSec: 600, practiceNotes: 30, targetNpm: 10, expectationSource: 'ai', score: 3, outcome: 'drill-owed',
  drillReps: 4, drillsPassed: 0, checkIns: 3, scaleCheckIns: 1, ...extra,
});

beforeEach(() => { api.lessonSittings.mockReset(); });

describe('PianoLessonSittingsPanel', () => {
  it('a low-score row shows score, check-ins, rates, drill and "Not counted yet"', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [row()] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('3/10')).toBeTruthy();
    expect(screen.getByText('3 (1 scales)')).toBeTruthy();
    expect(screen.getByText('3/min vs 10/min (AI)')).toBeTruthy();
    expect(screen.getByText('4 scales, passed 0')).toBeTruthy();
    expect(screen.getByText('Not counted yet')).toBeTruthy();
    expect(api.lessonSittings).toHaveBeenCalledWith('kid', 14);
  });

  it('an after-drill row with a review marker', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [row({ outcome: 'credited-after-drills', drillsPassed: 4, reviewed: true, reviewProbability: 0.3, score: 6 })] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('Counted after warm-up')).toBeTruthy();
    expect(screen.getByText('6/10 · reviewed (0.30)')).toBeTruthy();
    expect(screen.getByText('4 scales, passed 4')).toBeTruthy();
  });

  it('empty state', async () => {
    api.lessonSittings.mockResolvedValue({ ok: true, status: 200, data: { sittings: [] } });
    render(<PianoLessonSittingsPanel learnerId="kid" />);
    expect(await screen.findByText('No piano lessons in the last two weeks.')).toBeTruthy();
  });
});
