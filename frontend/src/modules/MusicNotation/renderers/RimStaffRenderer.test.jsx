import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RimStaffRenderer, layoutRimCard, rimClefRight, rimStaffExtent } from './RimStaffRenderer.jsx';
import { NOTEHEAD_RX } from './staffGlyphs.jsx';

const TREBLE_AXIS = [60, 62, 64, 65, 67, 69, 71, 72];
const BASS_AXIS = [47, 48, 50, 52, 53, 55, 57, 59];

const svgOf = (c) => c.querySelector('svg.action-staff__rim-svg');
const viewBox = (c) => svgOf(c).getAttribute('viewBox').split(' ').map(Number);
const lineYs = (c) => [...c.querySelectorAll('.action-staff__line')].map((l) => Number(l.getAttribute('y1')));

describe('rimStaffExtent', () => {
  it('spans exactly what the grand-staff treble axis needs: C4 ledger to half a space over the top line', () => {
    const { lo, hi } = rimStaffExtent(TREBLE_AXIS);
    expect(lo).toBe(-3);
    expect(hi).toBe(9);
  });

  it('spans the bass axis from under the bottom line to B3 above the top line', () => {
    const { lo, hi } = rimStaffExtent(BASS_AXIS);
    expect(lo).toBe(-1);
    expect(hi).toBe(10);
  });

  it('is at least as wide and tall as every card on the axis', () => {
    const tokens = [[60, 64, 67], [61, 65], 72, [70]];
    const extent = rimStaffExtent(tokens);
    for (const token of tokens) {
      const card = layoutRimCard([token].flat(), undefined);
      expect(extent.width).toBeGreaterThanOrEqual(card.width);
      expect(extent.lo).toBeLessThanOrEqual(card.lo);
      expect(extent.hi).toBeGreaterThanOrEqual(card.hi);
    }
  });

  it('widens for an accidental and never shrinks below a plain note', () => {
    expect(rimStaffExtent([61], { accidental: 'sharp' }).width).toBeGreaterThan(rimStaffExtent([60]).width);
  });

  it('survives an empty axis', () => {
    expect(rimStaffExtent([])).toEqual(expect.objectContaining({ lo: expect.any(Number), hi: expect.any(Number) }));
  });
});

describe('RimStaffRenderer', () => {
  it('draws five lines one step pair apart in a viewBox cut to the extent', () => {
    const extent = rimStaffExtent(TREBLE_AXIS);
    const { container } = render(<RimStaffRenderer targetPitches={[64]} extent={extent} />);
    const [, , w, h] = viewBox(container);
    expect(w).toBeCloseTo(extent.width);
    expect(h).toBeCloseTo((extent.hi - extent.lo) * 7);
    const ys = lineYs(container).sort((a, b) => a - b);
    expect(ys).toHaveLength(5);
    expect(ys[1] - ys[0]).toBeCloseTo(14);
  });

  it('draws the note with no stem, and a ledger line for middle C', () => {
    const { container } = render(<RimStaffRenderer targetPitches={[60]} extent={rimStaffExtent(TREBLE_AXIS)} />);
    expect(container.querySelectorAll('.action-staff__note')).toHaveLength(1);
    expect(container.querySelector('.action-staff__stem')).toBeNull();
    const ledgers = [...container.querySelectorAll('line:not(.action-staff__line)')];
    expect(ledgers).toHaveLength(1);
  });

  it('draws the clef its first pitch asks for', () => {
    expect(svgOf(render(<RimStaffRenderer targetPitches={[50]} />).container).getAttribute('data-clef')).toBe('bass');
    expect(svgOf(render(<RimStaffRenderer targetPitches={[67]} />).container).getAttribute('data-clef')).toBe('treble');
  });

  it('tints the ink when matched', () => {
    const { container } = render(<RimStaffRenderer targetPitches={[60, 64]} matched />);
    expect(container.querySelectorAll('.action-staff__note--matched')).toHaveLength(2);
  });

  it('spells a black key the way it is told', () => {
    const { container } = render(<RimStaffRenderer targetPitches={[70]} accidental="flat" />);
    expect(container.querySelector('.action-staff__accidental')).toHaveAttribute('data-kind', 'flat');
  });

  describe('held keys', () => {
    const extent = rimStaffExtent(TREBLE_AXIS);

    it('ghosts a held key that lands inside the drawn range', () => {
      const { container } = render(<RimStaffRenderer targetPitches={[60]} activeNotes={[64, 67]} extent={extent} />);
      expect(container.querySelectorAll('ellipse').length).toBe(3);
      expect(container.querySelectorAll('g.action-staff__ghost')).toHaveLength(2);
    });

    it('does not ghost the card\'s own answer', () => {
      const { container } = render(<RimStaffRenderer targetPitches={[60]} activeNotes={[60]} extent={extent} />);
      expect(container.querySelectorAll('.action-staff__ghost')).toHaveLength(0);
    });

    it('points at a held key just past the drawn range instead of drawing it off the card', () => {
      // A5 sits a step above this axis's top — still close enough to say "higher".
      const { container } = render(<RimStaffRenderer targetPitches={[72]} activeNotes={[81]} extent={extent} />);
      const arrow = container.querySelector('.action-staff__ghost--beyond');
      expect(arrow).toHaveAttribute('data-direction', 'above');
      expect(container.querySelectorAll('g.action-staff__ghost')).toHaveLength(0);
    });

    it('says nothing about a key far off this staff', () => {
      const { container } = render(<RimStaffRenderer targetPitches={[72]} activeNotes={[36]} extent={extent} />);
      expect(container.querySelectorAll('.action-staff__ghost')).toHaveLength(0);
    });
  });

  it('keeps every group clear of the clef and inside the extent', () => {
    const tokens = [[60, 62], [61, 63, 66], [70], [47, 49, 52], [72, 74]];
    const extent = rimStaffExtent(tokens, { accidental: 'sharp' });
    for (const token of tokens) {
      const { container } = render(<RimStaffRenderer targetPitches={token} accidental="sharp" extent={extent} />);
      const clef = svgOf(container).getAttribute('data-clef');
      const heads = [...container.querySelectorAll('.action-staff__note')].map((n) => Number(n.getAttribute('cx')));
      expect(Math.min(...heads) - NOTEHEAD_RX).toBeGreaterThanOrEqual(rimClefRight(clef));
      expect(Math.max(...heads) + NOTEHEAD_RX).toBeLessThanOrEqual(extent.width);
    }
  });
});
