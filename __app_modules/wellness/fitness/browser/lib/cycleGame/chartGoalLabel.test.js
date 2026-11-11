import { describe, it, expect } from 'vitest';
import { goalLabelLeft } from './chartGoalLabel.js';

// Plot 480 px wide; the goal line at y=24; label 80x26 just under the line
// (top 26); the default anchor puts its right edge at 95% (456 px).
const label = { w: 80, h: 26, top: 26 };
const base = { label, plotW: 480, anchorRight: 456, gapPx: 8 };
const tag = (x, y, w = 100, h = 34) => ({ x, y, w, h });

describe('goalLabelLeft', () => {
  it('sits at its anchor when no tag is near the goal line', () => {
    expect(goalLabelLeft({ ...base, tags: [tag(450, 160), tag(300, 90)] })).toBe(456 - 80);
  });

  it('slides left of a leader tag that reaches the goal line at the right edge (the 1.50 km / 960 m collision)', () => {
    // Leader at the plot's right edge (x=451), centred on the line (y=24): tag spans 401..501 x, 7..41 y.
    const left = goalLabelLeft({ ...base, tags: [tag(451, 24)] });
    expect(left + 80).toBeLessThanOrEqual(401 - 8); // right edge clear of the tag by the gap
    expect(left).toBe(401 - 8 - 80);
  });

  it('ignores a tag at the right edge that is well below the line', () => {
    expect(goalLabelLeft({ ...base, tags: [tag(451, 120)] })).toBe(376);
  });

  it('clears every tag in the band, right to left, when several stack near the finish', () => {
    // Two tags in the label's band: one at the edge, one further left. The
    // label ends up left of BOTH, not wedged between them.
    const left = goalLabelLeft({ ...base, tags: [tag(451, 24), tag(330, 40)] });
    expect(left + 80).toBeLessThanOrEqual(330 - 50 - 8);
  });

  it('does not slide past a tag it would not touch after an earlier push', () => {
    // After the edge tag pushes the label to 313..393, a tag at x=150 (100..200) is clear: no further move.
    expect(goalLabelLeft({ ...base, tags: [tag(451, 24), tag(150, 24)] })).toBe(313);
  });

  it('never leaves the plot: the y-axis label keeps its room', () => {
    // A tag as wide as the whole band pushes the label off the left edge: it stops at minLeft.
    const left = goalLabelLeft({ ...base, minLeft: 60, tags: [tag(240, 24, 600, 34)] });
    expect(left).toBe(60);
  });

  it('is a no-op before the label has been measured (unknown size covers nothing)', () => {
    expect(goalLabelLeft({ ...base, label: { w: 0, h: 0, top: 26 }, tags: [tag(451, 24)] })).toBe(456);
  });
});
