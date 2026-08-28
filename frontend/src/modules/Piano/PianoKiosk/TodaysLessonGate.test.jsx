import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ openPianoCourseLesson: vi.fn(() => true) }));

vi.mock('./pianoContentOpen.js', () => ({ openPianoCourseLesson: h.openPianoCourseLesson }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));
vi.mock('../ask/AskSession.jsx', () => ({
  default: ({ onPassed }) => <button type="button" onClick={() => onPassed({ assessmentId: 'a-1', score: 1, status: 'completed' })}>Pass challenge</button>,
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn() }) }),
}));

import TodaysLessonGate from './TodaysLessonGate.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';

const LESSON = {
  id: 'plex:2', title: 'Lesson 5: Broken Chords',
  thumbnail: '/api/img.jpg', description: 'Practice broken chords.',
};
const COURSE = { id: 'plex:1', title: 'Hoffman Academy' };
const UNIT = { id: '3', title: 'Unit 3' };

const mount = (props = {}) => render(
  <TodaysLessonGate
    lesson={LESSON}
    unit={UNIT}
    course={COURSE}
    basePath="/piano"
    navigate={() => {}}
    {...props}
  />,
);

const startButton = () => screen.getByRole('button', { name: /start today.s lesson/i });

beforeEach(() => {
  h.openPianoCourseLesson.mockReset();
  h.openPianoCourseLesson.mockReturnValue(true);
  DaylightAPI.mockClear();
});

describe('TodaysLessonGate', () => {
  it('names the lesson, its course and unit, and its blurb', () => {
    mount();
    expect(screen.getByText(/Lesson 5: Broken Chords/)).toBeInTheDocument();
    expect(screen.getByText(/Hoffman Academy/)).toBeInTheDocument();
    expect(screen.getByText(/Unit 3/)).toBeInTheDocument();
    expect(screen.getByText(/Practice broken chords/)).toBeInTheDocument();
  });

  it('renders the still when there is one', () => {
    mount();
    expect(screen.getByRole('presentation')).toHaveAttribute('src', '/api/img.jpg');
  });

  it('renders without a thumbnail rather than a broken image', () => {
    mount({ lesson: { id: 'plex:2', title: 'Bare lesson' } });
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    expect(screen.getByText('Bare lesson')).toBeInTheDocument();
  });

  it('renders with no unit (an unstructured course)', () => {
    mount({ unit: null });
    expect(screen.getByText(/Hoffman Academy/)).toBeInTheDocument();
  });

  // The tap happens on the tablet already showing the menu, so it navigates
  // in-app — DoNow's kiosk.launch bus exists to address a DIFFERENT device.
  it('launches straight into the lesson route, with no DoNow dispatch', () => {
    const navigate = vi.fn();
    mount({ navigate });
    fireEvent.click(startButton());
    expect(h.openPianoCourseLesson).toHaveBeenCalledWith({
      courseId: 'plex:1', lessonId: 'plex:2', basePath: '/piano', navigate,
    });
  });

  it('falls back to the course page rather than a dead tap on malformed ids', () => {
    h.openPianoCourseLesson.mockReturnValue(false);
    const navigate = vi.fn();
    mount({ navigate });
    fireEvent.click(startButton());
    expect(navigate).toHaveBeenCalledWith('/piano/videos/1');
  });

  it('mounts the server descriptor as AskSession and records its passed assessment', async () => {
    const onCompleted = vi.fn(async () => {});
    mount({
      learnerId: 'kid-one', onCompleted,
      challenge: {
        id: 'unit-3-c-major', ask: { id: 'named-c-major' },
        materialSpec: { kind: 'chord', root: 'C', quality: 'major' }, framing: 'Play a C major chord.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass challenge' }));
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith(
      'api/v1/piano/users/kid-one/school-piano-challenges/unit-3-c-major/completion',
      { assessmentId: 'a-1', score: 1, status: 'completed', passed: true }, 'POST',
    ));
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(h.openPianoCourseLesson).not.toHaveBeenCalled();
  });
});
