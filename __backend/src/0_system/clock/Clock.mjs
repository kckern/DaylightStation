const DURATION_MS = {
  day: 86400000,
  days: 86400000,
  hour: 3600000,
  hours: 3600000,
  week: 604800000,
  weeks: 604800000,
  month: 2592000000,   // 30 days
  months: 2592000000,
  minute: 60000,
  minutes: 60000,
};

export function parseDuration(str) {
  const match = str.match(/^(\d+)\s*(\w+)$/);
  if (!match) throw new Error(`Invalid duration: ${str}`);
  const [, amount, unit] = match;
  const ms = DURATION_MS[unit.toLowerCase()];
  if (!ms) throw new Error(`Unknown duration unit: ${unit}`);
  return parseInt(amount) * ms;
}

export class Clock {
  #offset = 0;
  #frozen = null;

  now() {
    if (this.#frozen !== null) return new Date(this.#frozen);
    return new Date(Date.now() + this.#offset);
  }

  today() {
    return this.now().toISOString().slice(0, 10);
  }

  freeze(dateOrString) {
    this.#frozen = new Date(dateOrString).getTime();
  }

  advance(duration) {
    const ms = parseDuration(duration);
    if (this.#frozen !== null) {
      this.#frozen += ms;
    } else {
      this.#offset += ms;
    }
  }

  reset() {
    this.#offset = 0;
    this.#frozen = null;
  }

  isFrozen() {
    return this.#frozen !== null;
  }
}
