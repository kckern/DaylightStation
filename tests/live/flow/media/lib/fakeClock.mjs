// A fake clock for long timers (a 30 minute sleep timer, a countdown) without
// waiting them out. Wraps Playwright's `page.clock`.
//
//   const clock = await installFakeClock(page);      // BEFORE the first goto
//   await page.goto('/screen/living-room');
//   ...start a 30 minute sleep timer through the real controls...
//   await clock.advanceMinutes(29);   // not yet
//   await clock.advanceMinutes(1);    // fires
//
// Time keeps flowing naturally between jumps (animations, debounces, network
// timeouts behave); `advance` jumps over `ms`. Playwright's jump fires each
// due timer ONCE; use `tick` (runFor) when a timer must fire as many times as
// it would have in that span (an interval), at the cost of running them all.
export async function installFakeClock(page, { time = Date.now() } = {}) {
  await page.clock.install({ time });
  return {
    /** Jump forward; due timers fire once. */
    advance: (ms) => page.clock.fastForward(ms),
    advanceMinutes: (minutes) => page.clock.fastForward(minutes * 60_000),
    /** Run forward, firing every timer that falls due, in order. */
    tick: (ms) => page.clock.runFor(ms),
    /** The page's current (fake) time, in ms since the epoch. */
    now: () => page.evaluate(() => Date.now()),
  };
}
