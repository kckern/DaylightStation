import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import GemGlyph, { glyphLook, glyphWords } from './GemGlyph.jsx';

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
    expect(glyphWords({ state: 'pending', week: 0 })).toBe('still in reach');
    expect(glyphWords({ state: 'none' })).toBe('not this week');
  });
});
