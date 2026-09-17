import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SvgStaffRenderer } from './SvgStaffRenderer.jsx';
import { SvgSequenceStaff } from './SvgSequenceStaff.jsx';
import { GHOST_INK } from './staffGlyphs.jsx';

/**
 * ONE GHOST, TWO ENGRAVERS.
 *
 * A held key that is not the asked-for one is drawn at the pitch it landed on,
 * and a child meets both renderers within one game: the ordered staff in the
 * exercise run, the single-simultaneity staff on every addressed board's rim.
 * They drew that same fact two different ways — a filled translucent head on
 * one, a hollow dashed outline on the other — for a month, because each owned
 * its own paint.
 *
 * This pins the shared value rather than either copy of it, so a renderer that
 * forks the house style fails here instead of on a tablet.
 */
const ghostOf = (container) =>
  container.querySelector('.action-staff__ghost ellipse')
  ?? container.querySelector('.sequence-note-wrong-ghost');

const paint = (el) => ({
  fill: el.getAttribute('fill'),
  stroke: el.getAttribute('stroke'),
  strokeWidth: el.getAttribute('stroke-width'),
  dash: el.getAttribute('stroke-dasharray'),
});

describe('the house ghost', () => {
  const surfaces = [
    ['the board rim (single simultaneity)', () => render(
      <SvgStaffRenderer targetPitches={[64]} activeNotes={[60]} />,
    )],
    ['the exercise run (ordered sequence)', () => render(
      <SvgSequenceStaff notes={[{ midi: 64 }]} cursorIndex={0} activeNotes={new Map([[60, { velocity: 1 }]])} />,
    )],
  ];

  it.each(surfaces)('is drawn as filled semi-opaque ink on %s', (_label, mount) => {
    const ghost = ghostOf(mount().container);
    expect(ghost).toBeTruthy();
    expect(paint(ghost)).toEqual({
      fill: GHOST_INK.head.fill,
      stroke: 'none',
      strokeWidth: null,
      dash: null,
    });
  });

  /**
   * A WASH, NOT A DRAWN NOTE. The head carried a 60%-black outline around its
   * translucent fill, which at a card's size is a hard edge — the picture of a
   * real notehead, for a mark whose entire job is to be read as "not that".
   * Fill only. Nothing here may give a ghost an edge back.
   */
  it.each(surfaces)('carries no border and no stem on %s', (_label, mount) => {
    const { container } = mount();
    const ghost = ghostOf(container);
    expect(ghost.getAttribute('stroke')).toBe('none');
    expect(ghost.getAttribute('stroke-width')).toBeNull();
    // A ghost group draws its head and its ledgers; a stem would be a line
    // running off the head, which is the other half of "not a drawn note".
    const group = ghost.closest('g');
    expect(group.querySelectorAll('line[class*="stem"]')).toHaveLength(0);
  });

  it('is never an outline: the shared ink declares a fill and no stroke of any kind', () => {
    expect(GHOST_INK.head.fill).not.toBe('none');
    expect(GHOST_INK.head.stroke).toBe('none');
    expect(GHOST_INK.head).not.toHaveProperty('strokeWidth');
    expect(GHOST_INK.head).not.toHaveProperty('strokeDasharray');
    expect(GHOST_INK.ledger).not.toHaveProperty('strokeDasharray');
  });
});
