import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, cleanup } from '@testing-library/react';
import GemGlyph, { glyphLook, glyphWords, segmentPath, pieClip } from './GemGlyph.jsx';
import { AREA_COLORS, AREA_WORDS } from './AreaIcon.jsx';

afterEach(cleanup);
const streak = (have, need, reach, left = 3) => ({ have, need, reach, left });

describe('GemGlyph', () => {
  it('picks one look per cell', () => {
    expect(glyphLook({ state: 'earned', week: 1 })).toBe('lit');
    expect(glyphLook({ state: 'earned', week: 1, streak: streak(2, 4, 'on-track') })).toBe('lit');
    expect(glyphLook({ state: 'pending', week: 0, streak: streak(0, 5, 'on-track') })).toBe('none');
    expect(glyphLook({ state: 'pending', week: 0, streak: streak(2, 4, 'tight') })).toBe('streak');
    expect(glyphLook({ state: 'pending', week: 0, streak: streak(0, 5, 'out') })).toBe('none');
    expect(glyphLook({ state: 'pending', week: 0, streak: streak(2, 5, 'out') })).toBe('none');
    expect(glyphLook({ state: 'leading', week: 0 })).toBe('holding');
    expect(glyphLook({ state: 'leading', week: 0, streak: streak(2, 4, 'on-track') })).toBe('holding');
    expect(glyphLook({ state: 'pending', week: 0 })).toBe('none');
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

  it('a done segment carries the gem colour inline (a stylesheet rule would beat an attribute)', () => {
    const on = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(2, 4, 'tight') }} color="rgb(43, 179, 163)" />).container;
    const segs = [...on.querySelectorAll('.gem-glyph__seg')];
    expect(segs.map((s) => s.style.stroke)).toEqual(['rgb(43, 179, 163)', 'rgb(43, 179, 163)', '', '']);
    expect(segs.every((s) => !s.hasAttribute('stroke'))).toBe(true);
    expect(on.querySelector('.gem-glyph__ring').classList.contains('is-tight')).toBe(false);
  });

  it('says where a running day-count stands, so on track can be drawn in full and tight faint', () => {
    const on = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(1, 5, 'on-track') }} color="#fff" />).container;
    expect(on.querySelector('.gem-glyph').dataset.reach).toBe('on-track');
    expect(on.querySelector('.gem-icon')).toBeTruthy();
    expect(on.querySelectorAll('.gem-glyph__seg:not(.is-done)')).toHaveLength(4);
    cleanup();
    const tight = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(3, 5, 'tight') }} color="#fff" />).container;
    expect(tight.querySelector('.gem-glyph').dataset.reach).toBe('tight');
    cleanup();
    expect(render(<GemGlyph cell={{ state: 'earned', week: 1 }} color="#fff" />).container.querySelector('.gem-glyph').hasAttribute('data-reach')).toBe(false);
  });

  it('draws nothing for a day-count that is out of reach', () => {
    const out = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(2, 5, 'out') }} color="#fff" />).container;
    expect(out.querySelector('.gem-glyph').dataset.look).toBe('none');
    expect(out.querySelector('svg')).toBeNull();
    expect(out.textContent).toBe('');
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

  it('a lit cell whose other day-count is out of reach is a full gem with no ring', () => {
    const { container } = render(<GemGlyph cell={{ state: 'earned', week: 1, streak: streak(2, 5, 'out') }} color="rgb(43, 179, 163)" />);
    expect(container.querySelector('.gem-glyph').dataset.look).toBe('lit');
    expect(container.querySelector('.gem-glyph__ring')).toBeNull();
    expect(container.querySelector('.gem-glyph').hasAttribute('data-ringed')).toBe(false);
    cleanup();
    const on = render(<GemGlyph cell={{ state: 'earned', week: 1, streak: streak(2, 5, 'on-track') }} color="rgb(43, 179, 163)" />).container;
    expect(on.querySelector('.gem-glyph__ring')).toBeTruthy();
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

  it('badges only a second gem, leaves an unreadable cell blank', () => {
    expect(render(<GemGlyph cell={{ state: 'earned', week: 1 }} color="#fff" />).container.textContent).toBe('');
    cleanup();
    expect(render(<GemGlyph cell={{ state: 'earned', week: 3 }} color="#fff" />).container.textContent).toBe('×3');
    cleanup();
    cleanup();
    // Evidence that could not be read leaves the cell blank: no question mark.
    expect(render(<GemGlyph cell={{ state: 'unknown', week: 0 }} color="#fff" />).container.textContent).toBe('');
  });

  it('says it in words for a screen reader', () => {
    expect(glyphWords({ state: 'pending', week: 0, streak: streak(2, 4, 'on-track', 3) })).toBe('2 of 4 days, on track');
    expect(glyphWords({ state: 'pending', week: 0, streak: streak(2, 4, 'tight', 2) })).toBe('2 of 4 days, every day left');
    expect(glyphWords({ state: 'pending', week: 0, streak: streak(0, 5, 'out', 1) })).toBe('0 of 5 days, out of reach this week');
    expect(glyphWords({ state: 'earned', week: 2 })).toBe('earned, 2 gems');
    expect(glyphWords({ state: 'earned', week: 1, streak: streak(2, 4, 'on-track') })).toBe('earned, and 2 of 4 days, on track');
    expect(glyphWords({ state: 'leading', week: 0 })).toBe('leading');
    // A row that folds a contest with a day-count: the lead is a whole gem, the days are still said.
    expect(glyphLook({ state: 'leading', week: 0, streak: streak(2, 4, 'on-track') })).toBe('holding');
    expect(glyphWords({ state: 'leading', week: 0, streak: streak(2, 4, 'on-track') })).toBe('leading, and 2 of 4 days, on track');
    expect(glyphWords({ state: 'pending', week: 0 })).toBe('not yet');
    expect(glyphWords({ state: 'none' })).toBe('not this week');
  });

  it('a 0-day streak looks none: blank, no ring, no gem', () => {
    const c = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(0, 5, 'tight') }} color="#fff" area="move" />).container;
    expect(c.querySelector('.gem-glyph').dataset.look).toBe('none');
    expect(c.querySelector('svg')).toBeNull();
    expect(c.textContent).toBe('');
  });

  it('a 1-day tight streak draws one filled segment and plain outline for the rest — no tag, no amber class', () => {
    const { container } = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(1, 5, 'tight', 4) }} color="rgb(142, 91, 208)" area="move" />);
    const segs = [...container.querySelectorAll('.gem-glyph__seg')];
    expect(segs).toHaveLength(5);
    expect(segs.filter((x) => x.classList.contains('is-done'))).toHaveLength(1);
    expect(segs[0].style.stroke).toBe('rgb(142, 91, 208)');
    expect(segs.slice(1).every((x) => x.style.stroke === '')).toBe(true);
    expect(container.querySelector('.gem-icon')).toBeTruthy();
    expect(container.querySelector('.is-tight, [class*="amber"], [class*="tag"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('a leading cell is a whole solid gem, no words', () => {
    const { container } = render(<GemGlyph cell={{ state: 'leading', week: 0 }} color="#ff7a2f" area="games" />);
    expect(container.querySelectorAll('.gem-icon')).toHaveLength(1);
    expect(container.querySelector('.gem-glyph__pie')).toBeNull();
    expect(container.textContent).toBe('');
    expect(container.querySelector('.gem-glyph').dataset.look).toBe('holding');
  });

  it('no area icon is drawn on any gem', () => {
    for (const cell of [{ state: 'earned', week: 1 }, { state: 'leading', week: 0 }, { state: 'pending', week: 0, streak: streak(2, 4, 'on-track') }]) {
      expect(render(<GemGlyph cell={cell} color="#fff" area="move" />).container.querySelector('.area-icon')).toBeNull();
      cleanup();
    }
  });

  it('a running day-count is a pie-cut gem: a grey stone under a colour stone clipped to the done days', () => {
    const c = render(<GemGlyph cell={{ state: 'pending', week: 0, streak: streak(2, 5, 'on-track') }} color="#8e5bd0" />).container;
    const pie = c.querySelector('.gem-glyph__pie');
    expect(pie).toBeTruthy();
    expect(pie.querySelector('.gem-glyph__togo .gem-icon')).toBeTruthy();
    const done = pie.querySelector('.gem-glyph__done');
    expect(done.style.clipPath).toBe(pieClip(2 / 5));
    expect(c.querySelectorAll('.gem-glyph__seg')).toHaveLength(5);
  });

  it('an earned gem with a ring is whole, not cut', () => {
    const c = render(<GemGlyph cell={{ state: 'earned', week: 1, streak: streak(2, 4, 'on-track') }} color="#2e9e5b" />).container;
    expect(c.querySelector('.gem-glyph__pie')).toBeNull();
    expect(c.querySelectorAll('.gem-icon')).toHaveLength(1);
  });

  describe('pieClip', () => {
    it('starts at the centre and the top, and sweeps clockwise', () => {
      const pts = pieClip(0.25).replace(/^polygon\(|\)$/g, '').split(', ');
      expect(pts[0]).toBe('50% 50%');
      expect(pts[1]).toBe('50% -25%'); // straight up, radius 75%
      expect(pts.at(-1)).toBe('125% 50%'); // a quarter turn: straight right
    });
    it('a whole turn and nothing are both exact', () => {
      expect(pieClip(1)).toBe('none');
      expect(pieClip(0)).toBe('polygon(50% 50%, 50% 50%, 50% 50%)');
    });
  });

  it('no amber or tag styles in the glyph styles', () => {
    const css = readFileSync(new URL('./GemBoard.scss', import.meta.url), 'utf8');
    const glyphCss = css.slice(css.indexOf('.gem-glyph {'), css.indexOf('// The box a cell opens'));
    expect(glyphCss).not.toMatch(/every-day|__tag|data-tagged/);
    expect(glyphCss).not.toMatch(/255,\s*180,\s*76|#ffb44c|amber/i);
  });

  it('the only opacity on the board is the pending wedges at 0.3', () => {
    const css = readFileSync(new URL('./GemBoard.scss', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    expect(css.match(/opacity\s*:[^;]+;/g)).toEqual(['opacity: 0.3;']);
    expect(css).toMatch(/&__togo\s*\{[^}]*opacity: 0\.3;/);
    expect(css).not.toMatch(/@keyframes|animation\s*:|__ghost/);
  });

  it('area colours mirror the server GEM_AREAS', () => {
    expect(AREA_COLORS).toEqual({ move: '#8e5bd0', school: '#2e9e5b', games: '#ff7a2f' });
    expect(AREA_WORDS).toEqual({ move: 'Move', school: 'School', games: 'Games' });
  });
});
