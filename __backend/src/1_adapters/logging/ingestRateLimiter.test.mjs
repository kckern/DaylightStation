import { describe, it, expect } from 'vitest';
import { createIngestRateLimiter, ingestRateKey } from './ingestRateLimiter.mjs';

const evt = (over = {}) => ({
  event: 'bridge.socket-error',
  level: 'error',
  context: { app: 'piano-kiosk', component: 'piano-bridge-notes', ip: '172.18.0.88', userAgent: 'Mac/Chrome151' },
  ...over,
});

/** A clock the test drives, so nothing sleeps. */
const clock = (start = 0) => { let t = start; return { now: () => t, advance: (ms) => { t += ms; } }; };

describe('ingestRateLimiter', () => {
  it('passes a burst intact — a real incident must arrive whole', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 30, refillPerMinute: 3, now: c.now });
    const allowed = Array.from({ length: 30 }, () => rl.check(evt()).allow).filter(Boolean).length;
    expect(allowed).toBe(30);
  });

  it('clips an indefinite drip to the sustained rate', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 30, refillPerMinute: 3, now: c.now });
    for (let i = 0; i < 30; i += 1) rl.check(evt());       // spend the burst
    let allowed = 0;
    // The observed flood: ~16/min for an hour.
    for (let minute = 0; minute < 60; minute += 1) {
      for (let i = 0; i < 16; i += 1) {
        c.advance(3_750);
        if (rl.check(evt()).allow) allowed += 1;
      }
    }
    // ~3/min sustained instead of 960/hr.
    expect(allowed).toBeGreaterThan(150);
    expect(allowed).toBeLessThan(220);
  });

  it('reports what it suppressed instead of leaving a silent gap', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 2, refillPerMinute: 1, summaryIntervalMs: 60_000, now: c.now });
    rl.check(evt()); rl.check(evt());
    const first = rl.check(evt());
    expect(first.allow).toBe(false);
    expect(first.summary).toMatchObject({
      event: 'log.ingest.throttled',
      level: 'warn',
      data: { throttledEvent: 'bridge.socket-error', throttledLevel: 'error', phase: 'throttling' },
    });
    // The summary carries the client, so a flood is traceable to its origin.
    expect(first.summary.context).toMatchObject({ ip: '172.18.0.88', component: 'piano-bridge-notes' });
  });

  it('does not emit a summary on every suppressed event', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 1, refillPerMinute: 1, summaryIntervalMs: 60_000, now: c.now });
    rl.check(evt());
    const summaries = Array.from({ length: 50 }, () => rl.check(evt()).summary).filter(Boolean);
    expect(summaries).toHaveLength(1);
  });

  it('announces throttling immediately, then the remainder on recovery', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 1, refillPerMinute: 60, summaryIntervalMs: 1_000, now: c.now });
    rl.check(evt());                                     // spends the only token
    // The FIRST suppression reports at once — you want to know throttling began
    // without waiting out a summary interval.
    expect(rl.check(evt()).summary).toMatchObject({ data: { phase: 'throttling', suppressed: 1 } });
    rl.check(evt()); rl.check(evt());                    // 2 more, silently counted
    c.advance(2_000);                                    // refill AND past the interval
    const back = rl.check(evt());
    expect(back.allow).toBe(true);
    expect(back.summary).toMatchObject({ data: { phase: 'recovered', suppressed: 2 } });
  });

  it('bounds TOTAL output — summaries must not replace the flood they describe', () => {
    // Regression: gating only the throttling summary and not the recovery one
    // turned a 16/min flood into ~12/min of summaries about it. A steady drip
    // against a slow refill makes the bucket flap, so every recovery emitted.
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 30, refillPerMinute: 3, summaryIntervalMs: 60_000, now: c.now });
    let allowed = 0; let summaries = 0;
    for (let i = 0; i < 16 * 60; i += 1) {           // 16/min for an hour
      c.advance(3_750);
      const r = rl.check(evt());
      if (r.allow) allowed += 1;
      if (r.summary) summaries += 1;
    }
    // Roughly one summary per minute per key, never one per recovery.
    expect(summaries).toBeLessThanOrEqual(65);
    // And the two together must stay far under the 960 the flood would produce.
    expect(allowed + summaries).toBeLessThan(300);
  });

  it('carries a suppressed count forward rather than dropping it when not yet due', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 1, refillPerMinute: 60, summaryIntervalMs: 60_000, now: c.now });
    rl.check(evt());
    expect(rl.check(evt()).summary).toMatchObject({ data: { suppressed: 1 } });  // first, at once
    rl.check(evt()); rl.check(evt());               // 2 more, not yet due
    c.advance(2_000);
    expect(rl.check(evt()).summary).toBeNull();     // recovered but not due — held
    c.advance(70_000);                              // now past the interval
    const late = rl.check(evt());
    // The held 2 were not lost; they surface in the first due summary after.
    expect(late.summary).toMatchObject({ data: { phase: 'recovered', suppressed: 2 } });
  });

  it('ISOLATES clients: a flooding laptop cannot silence the tablet', () => {
    // The failure this guards against is worse than the noise it replaces —
    // a shared per-event bucket would turn one broken client into blindness
    // about the same failure on every other client.
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 5, refillPerMinute: 1, now: c.now });
    const laptop = evt();
    const tablet = evt({ context: { ...evt().context, userAgent: 'Android/Tablet', ip: '10.0.0.245' } });
    for (let i = 0; i < 50; i += 1) rl.check(laptop);
    expect(rl.check(laptop).allow).toBe(false);
    expect(rl.check(tablet).allow).toBe(true);
  });

  it('separates distinct events and levels from the same client', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ capacity: 1, refillPerMinute: 1, now: c.now });
    rl.check(evt());
    expect(rl.check(evt()).allow).toBe(false);
    expect(rl.check(evt({ event: 'bridge.closed' })).allow).toBe(true);
    expect(rl.check(evt({ level: 'warn' })).allow).toBe(true);
  });

  it('bounds memory rather than growing a bucket per client forever', () => {
    const c = clock();
    const rl = createIngestRateLimiter({ maxBuckets: 10, now: c.now });
    for (let i = 0; i < 100; i += 1) {
      c.advance(1);
      rl.check(evt({ context: { ...evt().context, ip: `10.0.0.${i}` } }));
    }
    expect(rl.size()).toBeLessThanOrEqual(10);
  });

  it('builds a key from client and event identity', () => {
    const a = ingestRateKey(evt());
    expect(ingestRateKey(evt())).toBe(a);
    expect(ingestRateKey(evt({ event: 'other' }))).not.toBe(a);
    expect(ingestRateKey(evt({ context: { ...evt().context, ip: '10.0.0.9' } }))).not.toBe(a);
  });
});
