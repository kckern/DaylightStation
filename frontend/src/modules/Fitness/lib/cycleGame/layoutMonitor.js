// Pure rolling-window thrash detector. record(now) timestamps a layout/resize
// event; tripped(now) is true once >= threshold events fall within windowMs.
// Clock is passed in (no Date.now) so it's deterministically testable.
export function createThrashDetector({ windowMs = 2000, threshold = 8 } = {}) {
  let stamps = [];
  const prune = (now) => { stamps = stamps.filter((t) => now - t <= windowMs); };
  return {
    record(now) { stamps.push(now); prune(now); return stamps.length; },
    count(now) { prune(now); return stamps.length; },
    tripped(now) { return this.count(now) >= threshold; }
  };
}

export default { createThrashDetector };
