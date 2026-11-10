/**
 * pickByPriority — try every candidate at once, keep the ladder's ORDER.
 *
 * Walking a cover ladder one rung at a time costs a round trip per miss
 * (Amazon, the winner, was rung three: 2-4 s). Probing all rungs together makes
 * the wait the slowest NEEDED probe rather than the sum of the misses, while
 * the answer is still the lowest-index success — a faster, worse cover never
 * beats a slower, better one that is still in flight.
 *
 * Rules:
 *  - a probe succeeds by resolving to a non-null value; rejecting or resolving
 *    null/undefined/false is a miss;
 *  - the result is the lowest-index success once every lower index has missed;
 *  - a lower index that is still pending is given up on `candidateTimeoutMs`
 *    after the start, but only matters once something below it has succeeded —
 *    with no success at all the wait runs to `deadlineMs`, then `null`.
 *
 * Pure: no I/O of its own. `now` and `sleep` are injectable; `now` has no
 * ambient default (the caller supplies the clock), so elapsedMs is 0 without one.
 *
 * @module domain/pickByPriority
 */
export const CANDIDATE_TIMEOUT_MS = 2500;
export const DEADLINE_MS = 6000;

/**
 * @template C, V
 * @param {C[]} candidates - best first; each may carry a `source` label
 * @param {(candidate: C, index: number) => Promise<V|null>} probe
 * @param {{candidateTimeoutMs?: number, deadlineMs?: number,
 *   now?: () => number, sleep?: (ms: number) => Promise<void>}} [options]
 * @returns {Promise<{index: number, value: V, attempts: number, tried: string[],
 *   failed: number[], elapsedMs: number}|null>}
 */
export function pickByPriority(candidates, probe, {
  candidateTimeoutMs = CANDIDATE_TIMEOUT_MS, deadlineMs = DEADLINE_MS,
  now = () => 0, sleep = null,
} = {}) {
  const list = Array.from(candidates ?? []);
  if (list.length === 0) return Promise.resolve(null);

  const timers = new Set();
  const wait = sleep ?? ((ms) => new Promise((resolve) => {
    const id = setTimeout(() => { timers.delete(id); resolve(); }, ms);
    timers.add(id);
  }));

  const started = now();
  const state = list.map(() => 'pending'); // pending | ok | miss
  const values = new Array(list.length);
  let timeoutPassed = false;

  return new Promise((resolve) => {
    let finished = false;

    const finish = (index) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      timers.clear();
      if (index < 0) { resolve(null); return; }
      const settled = state.map((s, i) => (s === 'pending' ? -1 : i)).filter((i) => i >= 0);
      resolve({
        index,
        value: values[index],
        attempts: settled.length,
        tried: settled.map((i) => list[i]?.source),
        failed: settled.filter((i) => state[i] === 'miss'),
        elapsedMs: now() - started,
      });
    };

    const evaluate = () => {
      if (finished) return;
      const best = state.indexOf('ok');
      for (let i = 0; i < list.length; i += 1) {
        if (state[i] === 'ok') return finish(i);
        if (state[i] === 'pending') {
          // Only a pending rung ABOVE an existing success can time out.
          const blocked = timeoutPassed && best > i;
          if (!blocked) return undefined;
        }
      }
      return finish(-1);
    };

    list.forEach((candidate, i) => {
      let p;
      try { p = Promise.resolve(probe(candidate, i)); } catch (error) { p = Promise.reject(error); }
      p.then(
        (value) => {
          if (value === null || value === undefined || value === false) state[i] = 'miss';
          else { state[i] = 'ok'; values[i] = value; }
          evaluate();
        },
        () => { state[i] = 'miss'; evaluate(); },
      );
    });

    wait(candidateTimeoutMs).then(() => { timeoutPassed = true; evaluate(); });
    wait(deadlineMs).then(() => finish(-1));
  });
}

export default pickByPriority;
