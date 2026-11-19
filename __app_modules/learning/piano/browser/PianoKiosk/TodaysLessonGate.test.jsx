import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ openPianoCourseLesson: vi.fn(() => true) }));

vi.mock('./pianoContentOpen.js', () => ({ openPianoCourseLesson: h.openPianoCourseLesson }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));
vi.mock('../ask/AskSession.jsx', () => ({
  default: ({ onPassed }) => <button type="button" onClick={() => onPassed({ assessmentId: 'a-1', score: 1, status: 'completed' })}>Pass challenge</button>,
}));
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn() }) }),
}));

import TodaysLessonGate from './TodaysLessonGate.jsx';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

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
  it('is the picture, the title and one start action, with nothing only to be read', () => {
    const { container } = mount();
    expect(screen.getByText('Lesson 5: Broken Chords')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    // No word "Start": the way in is a play disc on the still, not a slab of a button.
    expect(container.querySelector('.piano-lesson-gate').textContent).toBe('Lesson 5: Broken Chords');
    expect(screen.queryByText(/Practice broken chords/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hoffman Academy/)).not.toBeInTheDocument();
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders the still when there is one', () => {
    const { container } = mount();
    expect(container.querySelector('.piano-lesson-gate__thumb')).toHaveAttribute('src', '/api/img.jpg');
  });

  it('stands the course poster on the left, then the title over the still with the play disc on it', () => {
    const { container } = mount({ course: { ...COURSE, thumbnail: '/api/poster.jpg' } });
    const button = startButton();
    const poster = container.querySelector('.piano-lesson-gate__poster');
    expect(poster).toHaveAttribute('src', '/api/poster.jpg');
    expect(button.firstElementChild).toBe(poster);
    const side = button.querySelector('.piano-lesson-gate__side');
    expect(side.firstElementChild).toHaveClass('piano-lesson-gate__title');
    expect(side.querySelector('.piano-lesson-gate__still .piano-lesson-gate__play')).not.toBeNull();
  });

  it('leaves the poster out when the course has none', () => {
    const { container } = mount();
    expect(container.querySelector('.piano-lesson-gate__poster')).toBeNull();
  });

  it('renders without a thumbnail rather than a broken image', () => {
    const { container } = mount({ lesson: { id: 'plex:2', title: 'Bare lesson' } });
    expect(container.querySelector('.piano-lesson-gate__thumb')).toBeNull();
    // The play disc still has somewhere to sit.
    expect(container.querySelector('.piano-lesson-gate__still .piano-lesson-gate__play')).not.toBeNull();
    expect(screen.getByText('Bare lesson')).toBeInTheDocument();
  });

  it('renders with no unit (an unstructured course)', () => {
    mount({ unit: null });
    expect(startButton()).toBeInTheDocument();
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
