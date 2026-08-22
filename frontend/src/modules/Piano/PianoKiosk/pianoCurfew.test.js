import { describe, it, expect } from 'vitest';
import { isCurfewActive, CURFEW_DEFAULTS } from './pianoCurfew.js';

const at = (h, m = 0) => new Date(2026, 7, 21, h, m, 0);
const evening = { enabled: true, start: '19:00', end: '06:00' };

describe('isCurfewActive', () => {
  it('is inactive when unset or explicitly disabled', () => {
    expect(isCurfewActive(at(22), null)).toBe(false);
    expect(isCurfewActive(at(22), undefined)).toBe(false);
    expect(isCurfewActive(at(22), { ...evening, enabled: false })).toBe(false);
  });

  it('fails open on a malformed window rather than greying the kiosk forever', () => {
    expect(isCurfewActive(at(22), { enabled: true })).toBe(false);
    expect(isCurfewActive(at(22), { enabled: true, start: 'seven', end: '06:00' })).toBe(false);
    expect(isCurfewActive(at(22), { enabled: true, start: '19:00', end: '19:00' })).toBe(false);
  });

  it('covers the overnight window from the inclusive start to the exclusive end', () => {
    expect(isCurfewActive(at(18, 59), evening)).toBe(false); // one minute before
    expect(isCurfewActive(at(19, 0), evening)).toBe(true);   // inclusive start
    expect(isCurfewActive(at(23, 30), evening)).toBe(true);
    expect(isCurfewActive(at(2), evening)).toBe(true);       // after midnight
    expect(isCurfewActive(at(5, 59), evening)).toBe(true);
    expect(isCurfewActive(at(6, 0), evening)).toBe(false);   // exclusive end
    expect(isCurfewActive(at(12), evening)).toBe(false);     // midday
  });

  it('handles a same-day window too (start < end)', () => {
    const school = { enabled: true, start: '09:00', end: '15:00' };
    expect(isCurfewActive(at(8, 59), school)).toBe(false);
    expect(isCurfewActive(at(12), school)).toBe(true);
    expect(isCurfewActive(at(15), school)).toBe(false);
  });

  // Off by default in code: the household's actual cut-off is config-driven
  // (data/household/piano/config.yml → curfew:), so a piano with no curfew
  // block never greys out.
  it('ships disabled by default', () => {
    expect(CURFEW_DEFAULTS.enabled).toBe(false);
    expect(isCurfewActive(at(22), CURFEW_DEFAULTS)).toBe(false);
  });
});
