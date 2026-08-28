// LessonScore.test.jsx — the placard that says WHOSE lesson this is.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass-embedded';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import LessonScore, { scoreModel } from './LessonScore.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};

const spyLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
});

const CHECKPOINTS = [{ id: 'a', at: 60 }, { id: 'b', at: 300 }, { id: 'c', at: 540 }, { id: 'd', at: 900 }];

const mount = (lesson, logger = spyLogger()) => render(
  <LessonScore
    data={{ contentId: 'lesson-1', lesson }}
    position={120}
    duration={1200}
    playing
    seeking={false}
    region={{ slot: 'top' }}
    logger={logger}
  />,
);

const placard = (c) => c.querySelector('[data-testid="lesson-score"]');
const tally = (c) => c.querySelector('[data-testid="lesson-score-tally"]');

describe('attribution', () => {
  it('names the learner and shows their avatar', () => {
    const { container } = mount({
      learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: [],
    });
    expect(container.querySelector('[data-testid="lesson-score-name"]').textContent).toBe('Ada');
    expect(container.querySelector('img.piano-avatar').getAttribute('src')).toContain('/users/ada');
  });

  it('accepts `displayName` as well as `name`', () => {
    const { container } = mount({ learner: { id: 'ada', displayName: 'Ada B.' }, checkpoints: CHECKPOINTS });
    expect(container.querySelector('[data-testid="lesson-score-name"]').textContent).toBe('Ada B.');
  });

  /**
   * The placard exists to make attribution visible. With no learner there is
   * nobody to attribute it TO, and a scoreboard with no name on it is worse than
   * no scoreboard: a sibling reads it as theirs. No box, and a warn — the
   * lesson still plays gated (the ONE RULE), an adult finds out from the store.
   */
  it('generates no box when there is no learner, and warns', () => {
    const logger = spyLogger();
    const { container } = mount({ learner: null, checkpoints: CHECKPOINTS, cleared: [] }, logger);
    expect(container.innerHTML).toBe('');
    expect(logger.warn).toHaveBeenCalledWith('school.surround.score.unattributed', expect.anything());
  });

  /**
   * A learner OBJECT with nothing usable on it — a snapshot that shipped the key
   * and not the person. Same answer as no learner at all: the placard's whole
   * job is to say whose lesson this is, and it cannot. Found by mutation
   * testing: the `learner: null` case above never reached this branch, so a
   * placard that invented the word "Learner" passed every spec in the file.
   */
  it.each([
    ['an empty learner', {}],
    ['blank strings', { id: '   ', name: '' }],
    ['a learner that is not an object', 'ada'],
  ])('generates no box for %s', (_label, learner) => {
    const logger = spyLogger();
    const { container } = mount({ learner, checkpoints: CHECKPOINTS, cleared: [] }, logger);
    expect(container.innerHTML).toBe('');
    expect(logger.warn).toHaveBeenCalledWith('school.surround.score.unattributed', expect.anything());
  });

  it('logs the attribution it painted', () => {
    const logger = spyLogger();
    mount({ learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a'], attempts: 3 }, logger);
    expect(logger.info).toHaveBeenCalledWith('school.surround.score.attributed', expect.objectContaining({
      learnerId: 'ada', correct: 1, of: 4, attempts: 3,
    }));
  });
});

describe('the tally', () => {
  /**
   * The placard is up from the first frame, before anything has been answered.
   * Attribution is the point and it does not wait for a score; "0" is a true
   * statement about a lesson that has not reached its first stop.
   */
  it('shows a zero score before the first checkpoint, and still names the child', () => {
    const { container } = mount({ learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: [] });
    expect(placard(container)).not.toBeNull();
    expect(tally(container).textContent).toContain('0');
    expect(tally(container).textContent).toContain('4');
  });

  it('counts cleared checkpoints when the payload carries no explicit count', () => {
    const { container } = mount({
      learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a', 'c'],
    });
    expect(placard(container).dataset.correct).toBe('2');
    expect(placard(container).dataset.of).toBe('4');
  });

  it('prefers the payload\'s own item counts over the checkpoint arithmetic', () => {
    const { container } = mount({
      learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a'], correct: 5, total: 9,
    });
    expect(placard(container).dataset.correct).toBe('5');
    expect(placard(container).dataset.of).toBe('9');
  });
});

/**
 * THE DELIBERATE OMISSION. This renders on a television in a shared family room
 * and a sibling may be in the room. The lesson is retry-until-correct, so every
 * checkpoint ends in a ✓ and a wrong-answer count measures only how long it
 * took — a public record of struggle with nothing the learner can do about it.
 * `attempts` is carried (the attribute and the log event have it; the backend
 * has it durably) and is never painted.
 */
describe('attempts are carried, never painted', () => {
  it('keeps the attempt count off the visible surface', () => {
    const { container } = mount({
      learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a', 'b'], attempts: 7,
    });
    expect(placard(container).dataset.attempts).toBe('7');
    expect(placard(container).textContent).not.toContain('7');
  });

  it('paints the same thing for a struggle as for a clean run', () => {
    const clean = mount({ learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a', 'b'], attempts: 2 });
    const hard = mount({ learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a', 'b'], attempts: 11 });
    expect(placard(hard.container).textContent).toBe(placard(clean.container).textContent);
  });
});

describe('the ONE RULE', () => {
  it.each([
    ['no data at all', undefined],
    ['a payload with no lesson', { contentId: 'x' }],
    ['junk everywhere', { lesson: { learner: 4, checkpoints: 'x', cleared: 9, correct: 'lots' } }],
  ])('never throws on %s', (_label, data) => {
    expect(() => render(<LessonScore data={data} logger={spyLogger()} />)).not.toThrow();
  });
});

describe('the model', () => {
  it('is a pure function of the payload', () => {
    const model = scoreModel({ learner: { id: 'ada', name: 'Ada' }, checkpoints: CHECKPOINTS, cleared: ['a'], attempts: 3 });
    expect(model).toMatchObject({ name: 'Ada', id: 'ada', correct: 1, of: 4, attempts: 3 });
  });

  it('reports no learner rather than inventing one', () => {
    expect(scoreModel({ checkpoints: CHECKPOINTS })).toBeNull();
  });
});

describe('the stylesheet', () => {
  it('sets its label register at or above the frame label floor', () => {
    const css = compileSheetOnce(path.join(__dirname, 'LessonScore.scss')).css.replace(/\s+/g, ' ');
    const sizes = [...css.matchAll(/font-size: var\(--label-floor, ([\d.]+)px\)/g)].map((m) => parseFloat(m[1]));
    expect(sizes.length, 'no --label-floor type on the placard').toBeGreaterThan(0);
    sizes.forEach((px) => expect(px).toBeGreaterThanOrEqual(11.52));
  });

  /**
   * 960x540 around a video that must stay watchable. The placard is a badge, not
   * a dashboard: it is capped as a fraction of the frame's measured video width,
   * the same mechanism `WorkPlacard` uses to stay a plate rather than a band.
   */
  it('caps itself against the frame\'s measured video width', () => {
    const css = compileSheetOnce(path.join(__dirname, 'LessonScore.scss')).css.replace(/\s+/g, ' ');
    expect(css).toMatch(/max-width: calc\(var\(--surround-media-w, 100%\) \* 0?\.\d+\)/);
  });
});
