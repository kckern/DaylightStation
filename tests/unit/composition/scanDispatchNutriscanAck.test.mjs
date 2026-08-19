/**
 * A refused scan says so.
 *
 * `handleNutrition`'s `swallow` branch used to return without ever calling
 * `refreshPrompt` — the one path where nothing happened was the one path
 * that said nothing. The user got a scanner beep, no change on the Telegram
 * prompt, and no way to tell a dead feature from a bad code.
 *
 * @see backend/src/5_composition/modules/scanDispatch.mjs
 * @see backend/src/3_applications/nutribot/lib/routeNutribotScan.mjs
 */
import { describe, it, expect } from 'vitest';
import { swallowNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

describe('swallowNotice', () => {
  it('explains a disabled scanner in words a person at the fridge can act on', () => {
    expect(swallowNotice('nutriscan-disabled'))
      .toBe('scanning is off — the fridge sheet is not configured');
  });

  it('explains a scanner with no scale', () => {
    expect(swallowNotice('no-scale-id')).toBe('no scale for this scanner');
  });

  // An unknown reason must still produce SOMETHING. Silence is the bug.
  it('never returns empty for an unrecognised reason', () => {
    expect(swallowNotice('some-new-reason')).toBeTruthy();
  });
});
