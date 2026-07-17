/**
 * Household quiet-hours window. Times are "HH:MM" in household-local time.
 * `isWithin` correctly spans midnight for overnight windows (e.g. 21:00 -> 07:00).
 * Start is inclusive, end is exclusive. A degenerate start===end window is never within.
 */
export class QuietHours {
  constructor({ enabled = false, start = '21:00', end = '07:00' } = {}) {
    this.enabled = !!enabled;
    this.start = start;
    this.end = end;
  }

  #toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  isWithin(now) {
    if (!this.enabled) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    const s = this.#toMinutes(this.start);
    const e = this.#toMinutes(this.end);
    if (s === e) return false;                 // degenerate: no window
    if (s < e) return mins >= s && mins < e;   // same-day window
    return mins >= s || mins < e;              // overnight window
  }
}
