/**
 * The reading rail. Two things are load-bearing and both fail invisibly:
 *
 *   1. THE ONE RULE — the chrome may never be the reason a story does not play.
 *      Every absence below must produce an empty rail, never a throw.
 *   2. Attribution is the whole point. A rail that renders without a learner is
 *      width spent saying nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSurroundRegistry, resetSurroundRegistry } from '../../../Surround/registry.js';
import { registerReadingSurroundModules, READING_SURROUND_MODULES } from './registerReadingSurround.js';

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
  child: vi.fn(function child() { return this; }),
});

const READING = {
  learnerId: 'user_5',
  learnerName: 'Reader',
  subject: 'english',
  title: 'Frog and Toad',
  image: '/media/img/frog.jpg',
  contentId: 'plex:620681',
  count: 1,
  target: 2,
  progressLabel: '1 of 2 stories',
};

/** Renders through the REGISTRY, exactly as `SurroundFrame` resolves it. */
const renderRail = (reading = READING, logger = makeLogger()) => {
  const Module = getSurroundRegistry().get('reading-credit');
  expect(Module).toBeTruthy();
  return render(
    <Module
      position={120} duration={900} playing seeking={false}
      data={{ id: 'reading-session', reading }}
      region={{ module: 'reading-credit', slot: 'right', width: '18%' }}
      logger={logger}
    />,
  );
};

beforeEach(() => { resetSurroundRegistry(); registerReadingSurroundModules(); });
afterEach(() => { resetSurroundRegistry(); });

describe('reading-credit — registration', () => {
  it('is registered under the name the reading definition authors', () => {
    expect(getSurroundRegistry().has('reading-credit')).toBe(true);
    expect(READING_SURROUND_MODULES).toContain('reading-credit');
  });

  it('declares the rail as the slot it was cut for', () => {
    expect(getSurroundRegistry().getMeta('reading-credit').regions).toEqual(['right']);
  });

  it('survives a registry reset, because the registrar is exported and not just a side effect', () => {
    resetSurroundRegistry();
    expect(getSurroundRegistry().has('reading-credit')).toBe(false);
    registerReadingSurroundModules();
    expect(getSurroundRegistry().has('reading-credit')).toBe(true);
  });
});

describe('reading-credit — what it says', () => {
  it('names the child and what the reading counts toward', () => {
    renderRail();
    expect(screen.getByTestId('reading-credit-name')).toHaveTextContent('Reader');
    expect(screen.getByTestId('reading-credit-subject')).toHaveTextContent('English');
  });

  it('draws the obligation as pips, with the finished ones filled', () => {
    renderRail();
    const pips = screen.getByTestId('reading-credit-count');
    expect(pips.querySelectorAll('.reading-pip')).toHaveLength(2);
    expect(pips.querySelectorAll('.reading-pip--done')).toHaveLength(1);
    expect(pips).toHaveAttribute('aria-label', '1 of 2 stories');
  });

  it('shows the COVER and not the title — the pick screen just said it in 6vh type', () => {
    renderRail();
    expect(screen.queryByTestId('reading-credit-title')).toBeNull();
    const cover = screen.getByRole('img', { name: 'Frog and Toad' });
    expect(cover.getAttribute('src')).toBe('/media/img/frog.jpg');
  });

  it('falls back to the title only when there is no cover to draw instead', () => {
    renderRail({ ...READING, image: null });
    expect(screen.getByTestId('reading-credit-title')).toHaveTextContent('Frog and Toad');
  });

  it('accepts the payload nested under `reading` or as the payload itself', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const { container } = render(
      <Module position={0} duration={0} playing={false} seeking={false}
        data={READING} region={{ slot: 'right' }} logger={makeLogger()} />,
    );
    expect(container.querySelector('[data-testid="surround-reading-credit"]')).toBeTruthy();
  });
});

describe('reading-credit — the one rule: it degrades, it never throws', () => {
  it('renders nothing at all without a learner — attribution is the whole point', () => {
    const { container } = renderRail({ ...READING, learnerId: null });
    expect(container.querySelector('[data-testid="surround-reading-credit"]')).toBeNull();
  });

  it('still attributes when the obligation is unreadable', () => {
    renderRail({ ...READING, count: null, target: null, progressLabel: null });
    expect(screen.getByTestId('reading-credit-name')).toHaveTextContent('Reader');
    // No numbers to draw and no sentence to fall back on: the rail says who,
    // and says nothing it cannot support.
    expect(screen.queryByTestId('reading-credit-count')).toBeNull();
  });

  it('shows no subject rather than a guessed one when the household authored none', () => {
    renderRail({ ...READING, subject: null });
    expect(screen.queryByTestId('reading-credit-subject')).toBeNull();
    renderRail({ ...READING, subject: '   ' });
    expect(screen.queryByTestId('reading-credit-subject')).toBeNull();
  });

  it.each([null, undefined, 'nonsense', 42, []])('survives a payload of %p', (data) => {
    const Module = getSurroundRegistry().get('reading-credit');
    expect(() => render(
      <Module position={0} duration={0} playing={false} seeking={false}
        data={data} region={{ slot: 'right' }} logger={makeLogger()} />,
    )).not.toThrow();
  });

  it('does not require a logger — a module rendered bare must still render', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    expect(() => render(
      <Module position={0} duration={0} playing={false} seeking={false}
        data={{ reading: READING }} region={{ slot: 'right' }} />,
    )).not.toThrow();
  });
});

describe('reading-credit — the clock is deliberately unused', () => {
  it('renders identically at every position: the obligation is books, never minutes', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const at = (position) => {
      const { container, unmount } = render(
        <Module position={position} duration={900} playing seeking={false}
          data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
      );
      const html = container.innerHTML;
      unmount();
      return html;
    };
    expect(at(0)).toBe(at(880));
  });
});

describe('the dependency only points one way', () => {
  // `registerLessonSurround.test.jsx` already fails on ANY School import
  // anywhere in the Surround tree, which covers this module too. What it cannot
  // know about is this module's own file landing in the wrong tree.
  const surroundDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../../../Surround',
  );
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  ));

  it('keeps the reading module out of the Surround tree', () => {
    // Name the file, not the count — a walk that reports a number hides which
    // file moved.
    const stray = walk(surroundDir).filter((f) => /ReadingCredit/.test(path.basename(f)));
    expect(stray.map((f) => path.relative(surroundDir, f))).toEqual([]);
  });
});
