import { describe, it, expect, beforeEach } from 'vitest';
import { checkOverlayPaint, paintsAbove } from './overlayPaintCheck.js';

/**
 * The real FitnessPlayer tree: the overlay lives INSIDE the video host, the
 * warning scrim is a LATER SIBLING of that host. Styles are the live ones.
 */
function mount({ hostStyle = 'position:absolute', contentStyle = 'position:relative;z-index:1' } = {}) {
  document.body.innerHTML = `
    <div class="fitness-player-content" style="${contentStyle}">
      <div class="fitness-player-video-host" style="${hostStyle}">
        <div class="fitness-video-shell" style="position:relative">
          <div class="governance-progress-overlay" style="position:absolute;z-index:60">
            <div class="governance-life-meter" style="position:absolute"></div>
            <div class="governance-progress-overlay__chip"></div>
          </div>
          <div class="video-player" style="position:absolute"></div>
        </div>
      </div>
      <div class="governance-warning-scrim" style="position:absolute;z-index:5"></div>
    </div>`;
  const $ = (sel) => document.querySelector(sel);
  return {
    meter: $('.governance-life-meter'),
    chip: $('.governance-progress-overlay__chip'),
    scrim: $('.governance-warning-scrim'),
    video: $('.video-player'),
  };
}

describe('overlayPaintCheck', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('the live layout paints the meter and chip above the scrim, undimmed', () => {
    const { meter, chip, scrim, video } = mount();
    expect(paintsAbove(scrim, video)).toBe(true); // the scrim does cover the video
    const result = checkOverlayPaint({ meter, chip }, scrim);
    expect(result.dimmed).toBe(false);
    expect(result.targets.meter).toEqual({ coveredByScrim: false, filters: [] });
  });

  it('flags the overlay as covered when the video host traps it in a lower stacking context', () => {
    const { meter, chip, scrim } = mount({ hostStyle: 'position:absolute;z-index:0' });
    const result = checkOverlayPaint({ meter, chip }, scrim);
    expect(result.dimmed).toBe(true);
    expect(result.targets.meter.coveredByScrim).toBe(true);
    expect(result.targets.chip.coveredByScrim).toBe(true);
  });

  it('flags a filter on an ancestor (the locked-state grayscale)', () => {
    const { meter, chip } = mount({ contentStyle: 'position:relative;z-index:1;filter:grayscale(1) brightness(0.6)' });
    const result = checkOverlayPaint({ meter, chip }, null);
    expect(result.dimmed).toBe(true);
    expect(result.targets.chip.filters[0]).toMatchObject({ element: 'fitness-player-content' });
  });

  it('ignores a missing target', () => {
    const { meter, scrim } = mount();
    expect(checkOverlayPaint({ meter, chip: null }, scrim).targets).not.toHaveProperty('chip');
  });
});
