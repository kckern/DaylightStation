// CheckpointMap.test.jsx — the lesson's stop-map, as the chrome around a gated
// video. Mount style mirrors `Surround/modules/WorkPlacard.test.jsx`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass-embedded';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import CheckpointMap, { mapModel } from './CheckpointMap.jsx';
import { deriveCheckpointGate } from '../useCheckpointGate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Compile the sheet once per file — see WorkPlacard.test.jsx for why.
const __sassCache = new Map();
const compileSheetOnce = (file) => {
  if (!__sassCache.has(file)) __sassCache.set(file, sass.compile(file));
  return __sassCache.get(file);
};

const spyLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
});

const CHECKPOINTS = [
  { id: 'cp-a', at: 60 },
  { id: 'cp-b', at: 300 },
  { id: 'cp-c', at: 540 },
  { id: 'cp-d', at: 900 },
];

const payload = (lesson) => ({ contentId: 'lesson-1', lesson });

const mount = (lesson, clock = {}, logger = spyLogger()) => render(
  <CheckpointMap
    data={payload(lesson)}
    position={clock.position ?? 0}
    duration={clock.duration ?? 1200}
    playing={clock.playing ?? true}
    seeking={false}
    region={{ slot: 'bottom' }}
    logger={logger}
  />,
);

const nodes = (container) => [...container.querySelectorAll('[data-testid="lesson-checkpoint-node"]')];
const states = (container) => nodes(container).map((n) => n.dataset.state);

describe('the map', () => {
  it('draws one node per checkpoint: cleared, current, locked', () => {
    const { container } = mount({
      checkpoints: CHECKPOINTS, cleared: ['cp-a'], approaching: false,
    }, { position: 120 });
    expect(states(container)).toEqual(['cleared', 'current', 'locked', 'locked']);
  });

  it('pulses the current node only while `approaching` says so', () => {
    const calm = mount({ checkpoints: CHECKPOINTS, cleared: [], approaching: false }, { position: 10 });
    expect(nodes(calm.container).some((n) => n.dataset.approaching === 'true')).toBe(false);

    const warn = mount({ checkpoints: CHECKPOINTS, cleared: [], approaching: true }, { position: 56 });
    const pulsing = nodes(warn.container).filter((n) => n.dataset.approaching === 'true');
    expect(pulsing).toHaveLength(1);
    expect(pulsing[0].dataset.state).toBe('current');
  });

  /**
   * The rewind case the gate hook documents: a child answers, rewinds, and
   * crosses the same second again. That checkpoint is CLEARED, and a cleared
   * node is never the current one — the map must not draw ✓ and a pulse on the
   * same mark.
   */
  it('never makes a cleared checkpoint current, even with the playhead behind it', () => {
    const { container } = mount({
      checkpoints: CHECKPOINTS, cleared: ['cp-a', 'cp-b'], approaching: true,
    }, { position: 30 });
    expect(states(container)).toEqual(['cleared', 'cleared', 'current', 'locked']);
    const pulsing = nodes(container).filter((n) => n.dataset.approaching === 'true');
    expect(pulsing).toHaveLength(1);
    expect(pulsing[0].dataset.at).toBe('540');
  });

  /**
   * The map and the GATE must name the same next stop. `seekCeiling` is the
   * authority's word for "the first checkpoint still owed"; the map's `current`
   * node is the same fact drawn. Asserted against the authority rather than
   * against a literal, so a drift in either derivation fails here.
   */
  it('agrees with the gate authority about which checkpoint is next', () => {
    const cleared = ['cp-a', 'cp-c'];
    const { verdict } = deriveCheckpointGate({ position: 100, checkpoints: CHECKPOINTS, clearedIds: cleared });
    const { container } = mount({ checkpoints: CHECKPOINTS, cleared }, { position: 100 });
    const current = nodes(container).find((n) => n.dataset.state === 'current');
    expect(Number(current.dataset.at)).toBe(verdict.seekCeiling);
  });

  it('places nodes and the cursor on the lesson clock', () => {
    const { container } = mount({ checkpoints: CHECKPOINTS, cleared: [] }, { position: 300, duration: 1200 });
    const at = nodes(container).map((n) => n.style.getPropertyValue('--lesson-node-at').trim());
    expect(at).toEqual(['0.05', '0.25', '0.45', '0.75']);
    const cursor = container.querySelector('[data-testid="lesson-checkpoint-cursor"]');
    expect(cursor.style.getPropertyValue('--lesson-map-position').trim()).toBe('0.25');
  });

  /**
   * No duration yet (the element has not reported one). The map still says how
   * many stops there are and which is next — it just cannot say WHERE, so it
   * spaces them evenly and draws no cursor rather than pinning every node at
   * zero, which would read as four stops in the first frame of the lesson.
   */
  it('falls back to even spacing and no cursor when the clock has no duration', () => {
    const { container } = mount({ checkpoints: CHECKPOINTS, cleared: [] }, { position: 0, duration: 0 });
    const root = container.querySelector('[data-testid="lesson-checkpoint-map"]');
    expect(root.dataset.scaled).toBe('false');
    expect(container.querySelector('[data-testid="lesson-checkpoint-cursor"]')).toBeNull();
    const at = nodes(container).map((n) => n.style.getPropertyValue('--lesson-node-at').trim());
    expect(at).toEqual(['0.2', '0.4', '0.6', '0.8']);
  });
});

describe('when the list is unusable — the ONE RULE', () => {
  it('generates no box at all when the list never arrived, and warns', () => {
    const logger = spyLogger();
    const { container } = mount({ checkpoints: null, cleared: [] }, {}, logger);
    expect(container.innerHTML).toBe('');
    expect(logger.warn).toHaveBeenCalledWith('school.surround.map.unusable', expect.objectContaining({ reason: 'no-list' }));
  });

  /**
   * An EMPTY list is not a failure: it is an ungated lesson, which the gate hook
   * treats as "no gate". Nothing will stop, so there is nothing to warn about —
   * the map renders nothing and says so at DEBUG, not at WARN. That difference
   * is the whole answer to "a map of nothing is not a map that failed to load":
   * the child sees the same nothing, and the log store tells the two apart.
   */
  it('renders nothing for an ungated lesson, and does NOT warn', () => {
    const logger = spyLogger();
    const { container } = mount({ checkpoints: [], cleared: [] }, {}, logger);
    expect(container.innerHTML).toBe('');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('school.surround.map.ungated', expect.anything());
  });

  it('warns with counts when a list arrived but nothing in it can be placed', () => {
    const logger = spyLogger();
    const { container } = mount({ checkpoints: [{ id: 'x' }, { at: 'soon' }], cleared: [] }, {}, logger);
    expect(container.innerHTML).toBe('');
    expect(logger.warn).toHaveBeenCalledWith('school.surround.map.unusable', expect.objectContaining({
      reason: 'unplaceable', authored: 2, placeable: 0,
    }));
  });

  it('draws the checkpoints it CAN place and drops the ones it cannot', () => {
    const { container } = mount({
      checkpoints: [{ id: 'a', at: 60 }, { id: 'b' }, { id: 'c', at: 600 }], cleared: [],
    });
    expect(nodes(container)).toHaveLength(2);
  });

  it.each([
    ['no data at all', undefined],
    ['a payload with no lesson', { contentId: 'x' }],
    ['a string where the list should be', { lesson: { checkpoints: 'four' } }],
    ['junk entries', { lesson: { checkpoints: [null, 7, 'x'], cleared: 3 } }],
  ])('never throws on %s', (_label, data) => {
    expect(() => render(
      <CheckpointMap data={data} position={NaN} duration={NaN} logger={spyLogger()} />,
    )).not.toThrow();
  });
});

describe('the model', () => {
  it('is a pure function of the list, the clearances and the clock', () => {
    const model = mapModel({
      checkpoints: CHECKPOINTS, clearedIds: ['cp-a'], position: 240, duration: 1200, approaching: true,
    });
    expect(model.state).toBe('ready');
    expect(model.progress).toBeCloseTo(0.2);
    expect(model.nodes.map((n) => n.state)).toEqual(['cleared', 'current', 'locked', 'locked']);
    expect(model.nodes[1].pulse).toBe(true);
  });

  it('derives `cp-<at>` ids exactly as the gate authority does', () => {
    const model = mapModel({ checkpoints: [{ at: 312 }], clearedIds: ['cp-312'], duration: 600 });
    expect(model.nodes[0].state).toBe('cleared');
  });
});

describe('the stylesheet', () => {
  it('scopes the pulse to the approaching node, not to every node', () => {
    const css = compileSheetOnce(path.join(__dirname, 'CheckpointMap.scss')).css.replace(/\s+/g, ' ');
    expect(css).toContain('@keyframes lesson-checkpoint-pulse');
    const animated = css.match(/([^{}]*)\{[^{}]*animation:[^{}]*lesson-checkpoint-pulse[^{}]*\}/);
    expect(animated, 'nothing runs the pulse animation').not.toBeNull();
    // Sass drops the quotes an attribute selector is authored with, so the
    // compiled form is `[data-approaching=true]`. The invariant is the SCOPE,
    // not the quoting.
    expect(animated[1]).toMatch(/\[data-approaching=("?)true\1\]/);
  });

  /**
   * 960x540, read from a sofa. The node labels are the frame's tracked-label
   * register and must not be set below its floor.
   */
  it('sets its type at or above the frame label floor', () => {
    const css = compileSheetOnce(path.join(__dirname, 'CheckpointMap.scss')).css.replace(/\s+/g, ' ');
    const sizes = [...css.matchAll(/font-size: var\(--label-floor, ([\d.]+)px\)/g)].map((m) => parseFloat(m[1]));
    expect(sizes.length, 'no --label-floor type on the map').toBeGreaterThan(0);
    sizes.forEach((px) => expect(px).toBeGreaterThanOrEqual(11.52));
  });

  /**
   * The cursor crawls: over a 20-minute lesson on a 960px screen it advances
   * well under a pixel a second. `left`/`width` are pixel-snapped by the engine,
   * which is what made the concert band's playhead stand still and then jump
   * (SegmentMap, design wave 5). Both the cursor and the fill move as transforms.
   */
  it('moves the cursor and the fill as transforms, never as left/width', () => {
    const css = compileSheetOnce(path.join(__dirname, 'CheckpointMap.scss')).css.replace(/\s+/g, ' ');
    const rule = (sel) => css.match(new RegExp(`\\${sel} \\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.lesson-checkpoint-map__cursor')).toMatch(/transform: translateX\(calc\(var\(--lesson-map-position,? ?0?\)/);
    expect(rule('.lesson-checkpoint-map__fill')).toMatch(/transform: scaleX\(var\(--lesson-map-position,? ?0?\)/);
  });
});
