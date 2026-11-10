import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import GemGlyph, { glyphLook, glyphWords, segmentPath } from './GemGlyph.jsx';

afterEach(cleanup);
const streak = (have, need, reach, left = 3) => ({ have, need, reach, left });

describe('GemGlyph', () => {
  it('picks one look per cell', () => {
    expect(glyphLook({ state: 'earned', week: 1 })).toBe('lit');
    expect(glyphLook({ state: 'earned', week: 1, streak: streak(2, 4, 'on-track') })).toBe('lit');
    expect(glyphLook({ state: 'pending', week: 0, streak: streak(2, 4, 'tight') })).toBe('streak');
    expect(glyphLook({ state: 'pending', week: 0, streak: streak(0, 5, 'out') })).toBe('out');
    expect(glyphLook({ state: 'leading', week: 0 })).toBe('holding');
    expect(glyphLook({ state: 'pending', week: 0 })).toBe('open');
    expect(glyphLook({ state: 'unknown' })).toBe('unknown');
    expect(glyphLook({ state: 'disabled' })).toBe('off');
    expect(glyphLook({ state: 'none' })).toBe('none');
    expect(glyphLook(undefined)).toBe('none');
  });

  it('draws one ring segment per day needed, the done ones filled, and no numerals', () => {
    const { container } = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(1, 4, 'on-track') }} color="#2bb3a3" />);
    expect(container.querySelectorAll('.gem-glyph__seg')).toHaveLength(4);
    expect(container.querySelectorAll('.gem-glyph__seg.is-done')).toHaveLength(1);
    expect(container.querySelector('.gem-glyph').dataset.look).toBe('streak');
    expect(container.textContent).toBe('');
  });

  it('a done segment carries the gem colour inline (a stylesheet rule would beat an attribute); out of reach it does not', () => {
    const on = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(2, 4, 'tight') }} color="rgb(43, 179, 163)" />).container;
    const segs = [...on.querySelectorAll('.gem-glyph__seg')];
    expect(segs.map((s) => s.style.stroke)).toEqual(['rgb(43, 179, 163)', 'rgb(43, 179, 163)', '', '']);
    expect(segs.every((s) => !s.hasAttribute('stroke'))).toBe(true);
    expect(on.querySelector('.gem-glyph__ring').classList.contains('is-tight')).toBe(true);
    cleanup();
    const out = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(2, 5, 'out') }} color="rgb(43, 179, 163)" />).container;
    expect([...out.querySelectorAll('.gem-glyph__seg')].map((s) => s.style.stroke)).toEqual(['', '', '', '', '']);
    expect(out.querySelectorAll('.gem-glyph__seg.is-done')).toHaveLength(2);
  });

  it('leaves a clear gap between segments, and one day needed is still a near-full circle', () => {
    const arc = (d) => { const [, x1, y1, , , , , large, , x2, y2] = d.split(' '); return { x1: +x1, y1: +y1, x2: +x2, y2: +y2, large }; };
    const one = arc(segmentPath(0, 1));
    expect(one.large).toBe('1');
    expect(Math.hypot(one.x1 - one.x2, one.y1 - one.y2)).toBeLessThan(7); // the two ends sit 20° apart on r=17
    // Seven days: the gap between neighbours (20° ≈ 5.9) is wider than the round caps (3.2) and each arc is still longer than it.
    const a = arc(segmentPath(0, 7));
    const b = arc(segmentPath(1, 7));
    expect(Math.hypot(a.x2 - b.x1, a.y2 - b.y1)).toBeGreaterThan(5.5);
    expect(Math.hypot(a.x1 - a.x2, a.y1 - a.y2)).toBeGreaterThan(8);
    expect(a.large).toBe('0');
  });

  it('a lit cell whose day-count is out of reach still shows the days done: the ring itself says out', () => {
    const { container } = render(<GemGlyph cell={{ state: 'earned', week: 1, streak: streak(2, 5, 'out') }} color="rgb(43, 179, 163)" />);
    expect(container.querySelector('.gem-glyph').dataset.look).toBe('lit');
    expect(container.querySelector('.gem-glyph__ring').classList.contains('is-out')).toBe(true);
    expect(container.querySelectorAll('.gem-glyph__seg.is-done')).toHaveLength(2);
    expect([...container.querySelectorAll('.gem-glyph__seg')].every((s) => s.style.stroke === '')).toBe(true);
    cleanup();
    const on = render(<GemGlyph cell={{ state: 'earned', week: 1, streak: streak(2, 5, 'on-track') }} color="rgb(43, 179, 163)" />).container;
    expect(on.querySelector('.gem-glyph__ring').classList.contains('is-out')).toBe(false);
  });

  it('the ring takes the colour of the rule whose days it counts, else the row’s', () => {
    const parts = [{ ruleId: 'book-finished', color: 'rgb(9, 9, 9)' }, { ruleId: 'reader-week', color: 'rgb(1, 2, 3)' }];
    const cell = { state: 'earned', week: 1, streak: { ...streak(1, 4, 'on-track'), ruleId: 'reader-week' }, parts };
    const own = render(<GemGlyph cell={cell} color="rgb(7, 7, 7)" />).container;
    expect(own.querySelector('.gem-glyph__seg.is-done').style.stroke).toBe('rgb(1, 2, 3)');
    cleanup();
    const bare = render(<GemGlyph cell={{ ...cell, parts: [{ ruleId: 'reader-week' }] }} color="rgb(7, 7, 7)" />).container;
    expect(bare.querySelector('.gem-glyph__seg.is-done').style.stroke).toBe('rgb(7, 7, 7)');
  });

  it('badges only a second gem, drops the gem when out of reach, dashes a held contest', () => {
    expect(render(<GemGlyph cell={{ state: 'earned', week: 1 }} color="#fff" />).container.textContent).toBe('');
    cleanup();
    expect(render(<GemGlyph cell={{ state: 'earned', week: 3 }} color="#fff" />).container.textContent).toBe('×3');
    cleanup();
    const out = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(1, 5, 'out') }} color="#fff" />).container;
    expect(out.querySelector('.gem-icon')).toBeNull();
    expect(out.querySelectorAll('.gem-glyph__seg')).toHaveLength(5);
    cleanup();
    const held = render(<GemGlyph cell={{ state: 'leading', week: 0 }} color="#fff" />).container;
    expect(held.querySelector('.gem-glyph__hold')).toBeTruthy();
  });

  it('says it in words for a screen reader', () => {
    expect(glyphWords({ state: 'pending', week: 0, streak: streak(2, 4, 'on-track', 3) })).toBe('2 of 4 days, on track');
    expect(glyphWords({ state: 'pending', week: 0, streak: streak(2, 4, 'tight', 2) })).toBe('2 of 4 days, needs every day left');
    expect(glyphWords({ state: 'pending', week: 0, streak: streak(0, 5, 'out', 1) })).toBe('0 of 5 days, out of reach this week');
    expect(glyphWords({ state: 'earned', week: 2 })).toBe('earned, 2 gems');
    expect(glyphWords({ state: 'earned', week: 1, streak: streak(2, 4, 'on-track') })).toBe('earned, and 2 of 4 days, on track');
    expect(glyphWords({ state: 'leading', week: 0 })).toBe('leading');
    // A row that folds a contest with a day-count: the ring is drawn, the lead is still said.
    expect(glyphLook({ state: 'leading', week: 0, streak: streak(2, 4, 'on-track') })).toBe('streak');
    expect(glyphWords({ state: 'leading', week: 0, streak: streak(2, 4, 'on-track') })).toBe('leading, and 2 of 4 days, on track');
    expect(glyphWords({ state: 'pending', week: 0 })).toBe('still in reach');
    expect(glyphWords({ state: 'none' })).toBe('not this week');
  });
});
