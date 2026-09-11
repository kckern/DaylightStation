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

  // The rail carries NO copy of the book. The stage a foot to its right is
  // already showing the same artwork at full size; two of them on one screen
  // was the rail spending its width on the one question the stage answers best.
  it('draws the book nowhere — not as a cover, not as a title', () => {
    const { container } = renderRail();
    expect(screen.queryByTestId('reading-credit-title')).toBeNull();
    expect(container.querySelector('img[src="/media/img/frog.jpg"]')).toBeNull();
  });

  it('still draws nothing of the book when there is no artwork to draw', () => {
    renderRail({ ...READING, image: null });
    expect(screen.queryByTestId('reading-credit-title')).toBeNull();
  });

  // THE QUEUE IS USER-SCOPED, and the rail is where a child sees it: the
  // waiting book wears the face and name of whoever it will be credited to.
  it('shows the book on deck with the face and name of the child it is queued for', () => {
    const { container } = renderRail({
      ...READING,
      onDeck: { title: 'Owl at Home', image: '/media/img/owl.jpg', learnerId: 'user_3', learnerName: 'Sibling' },
    });
    const next = screen.getByTestId('reading-credit-next');
    expect(next).toHaveTextContent('Up next');
    expect(next).toHaveTextContent('Owl at Home');
    expect(next).toHaveTextContent('Sibling');
    expect(next.querySelector('img[src="/media/img/owl.jpg"]')).not.toBeNull();
    expect(next.querySelector('.reading-credit__next-face')).not.toBeNull();
    // The plaque above still names the child reading NOW.
    expect(screen.getByTestId('reading-credit-name')).toHaveTextContent('Reader');
    expect(container.querySelectorAll('.piano-avatar, [data-testid="profile-avatar"]').length).toBeGreaterThanOrEqual(1);
  });

  it('draws no up-next block when nothing is waiting', () => {
    renderRail({ ...READING, onDeck: null });
    expect(screen.queryByTestId('reading-credit-next')).toBeNull();
  });

  // Two facts about two different things. The subject used to sit directly
  // under the portrait, where a caption goes, so the rail read as a child
  // called "English".
  it('leads with the subject as its own mark, and captions the face with the NAME', () => {
    const { container } = renderRail();
    const subject = screen.getByTestId('reading-credit-subject');
    expect(subject).toHaveTextContent('English');
    expect(subject.querySelector('.school-icon')).not.toBeNull();

    const who = container.querySelector('.reading-credit__who');
    expect(who.querySelector('[data-testid="reading-credit-name"]')).toHaveTextContent('Reader');
    // The subject is NOT inside the identity block.
    expect(who.querySelector('[data-testid="reading-credit-subject"]')).toBeNull();
    // And it comes first in the column.
    expect(subject.compareDocumentPosition(who) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  // The clock drives the ring around the portrait and NOTHING ELSE: no
  // countdown, no elapsed/total, no bar. A child may re-listen or wander off,
  // and the obligation is a count of books, never of minutes.
  //
  // It used to drive a conic sweep inside the live pip instead, where one
  // 1.4rem disc was both "one of the day's books" and "how far through this
  // recording" — on a one-book day, a single small circle carrying everything.
  it('spends the clock on the portrait ring alone — no minutes anywhere on the rail', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const at = (position) => {
      const { container, unmount } = render(
        <Module position={position} duration={900} playing seeking={false}
          data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
      );
      const sweep = container.querySelector('.reading-credit__ring-sweep')?.getAttribute('stroke-dashoffset') ?? null;
      const text = container.textContent;
      unmount();
      return { sweep, text };
    };
    const early = at(0);
    const late = at(880);
    expect(early.sweep).not.toBeNull();
    expect(early.sweep).not.toBe(late.sweep);
    // Later in the book is MORE of the ring drawn, not less: the offset shrinks
    // toward zero as the arc closes.
    expect(Number(late.sweep)).toBeLessThan(Number(early.sweep));
    // The words on the rail do not move with the story's clock. (The WALL
    // clock says the time of day and is a different object — J9 — but it too
    // must be unmoved by where we are in the book.)
    expect(early.text).toBe(late.text);
  });

  // The position arrives at 10 Hz but the duration is 0 until the media element
  // has metadata, and a confident zero at the start of a story is a lie a child
  // can see: a ring that is already drawing would say the book had begun to
  // pass before a note of it had played.
  it('draws no ring at all until the duration is known', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const { container } = render(
      <Module position={0} duration={0} playing seeking={false}
        data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
    );
    expect(container.querySelector('.reading-credit__ring')).toBeNull();
    // The pip still says WHICH book, which is the question that does not
    // depend on knowing how long it is.
    expect(container.querySelector('[data-testid="reading-pip-live"]')).not.toBeNull();
  });

  // The two facts are separate objects now, and the pip is the one that must
  // not carry a proportion any more.
  it('leaves the pips counting books, with no sweep of their own', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const { container } = render(
      <Module position={450} duration={900} playing seeking={false}
        data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
    );
    const live = container.querySelector('[data-testid="reading-pip-live"]');
    expect(live).not.toBeNull();
    expect(live.getAttribute('style') ?? '').not.toMatch(/pip-sweep/);
  });

  it('carries a wall clock and a date, and no elapsed or remaining time', () => {
    const { container } = renderRail();
    const clock = container.querySelector('[data-testid="reading-credit-clock"]');
    expect(clock).not.toBeNull();
    // A time of day, a weekday and a date — three lines, none of them a duration.
    expect(clock.querySelector('.reading-credit__time').textContent).toMatch(/^\d{1,2}:\d{2}$/);
    expect(clock.textContent).not.toMatch(/left|remaining|elapsed|min\b/i);
    // And it is the LAST thing on the rail, outside the credit plaque.
    expect(container.querySelector('.reading-credit').lastElementChild).toBe(clock);
  });

  it('marks the pip this story will fill, and only while it is playing', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const render1 = (playing) => {
      const { container, unmount } = render(
        <Module position={100} duration={900} playing={playing} seeking={false}
          data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
      );
      const has = Boolean(container.querySelector('[data-testid="reading-pip-live"]'));
      unmount();
      return has;
    };
    expect(render1(true)).toBe(true);
    // Paused is NOT gone: a duration means a story is loaded.
    expect(render1(false)).toBe(true);
  });

  it('holds the pulse still while paused, without losing the mark or the sweep', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const at = (playing) => {
      const { container, unmount } = render(
        <Module position={450} duration={900} playing={playing} seeking={false}
          data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
      );
      const live = container.querySelector('[data-testid="reading-pip-live"]');
      const out = { held: live.className.includes('reading-pip--held'), sweep: live.getAttribute('style') };
      unmount();
      return out;
    };
    expect(at(true)).toMatchObject({ held: false });
    expect(at(false)).toMatchObject({ held: true });
    // The position is still drawn either way.
    expect(at(false).sweep).toBe(at(true).sweep);
  });

  it('shows no live pip at all before a story is loaded', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const { container } = render(
      <Module position={0} duration={0} playing={false} seeking={false}
        data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
    );
    expect(container.querySelector('[data-testid="reading-pip-live"]')).toBeNull();
  });

  it('pulses without a sweep when the position is not known yet', () => {
    const Module = getSurroundRegistry().get('reading-credit');
    const { container } = render(
      <Module position={0} duration={0} playing seeking={false}
        data={{ reading: READING }} region={{ slot: 'right' }} logger={makeLogger()} />,
    );
    const live = container.querySelector('[data-testid="reading-pip-live"]');
    expect(live).not.toBeNull();
    // A confident zero would be a lie about where we are.
    expect(live.getAttribute('style')).toBeNull();
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
