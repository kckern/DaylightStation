// One exclusive lock per username, shared by the triage pass and the owner's answers so
// they never write the card queue at the same time. In-process only (one runtime).
//
// acquire(username, { kind, timeoutMs }) resolves to a release function once every earlier
// holder has released. With timeoutMs, a waiter that is not reached in time rejects with
// code 'TRIAGE_BUSY' (and `holder`: the kind of whoever holds the lock); its turn, when it
// comes, is passed straight on. Timeouts need an injected `after(ms, fn) -> cancel`; without
// one a waiter waits until its turn.
export function createUserLock({ after = null } = {}) {
  const tails = new Map();
  const holders = new Map();

  function acquire(username, { kind = 'answer', timeoutMs = 0 } = {}) {
    const prev = tails.get(username) ?? Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    const tail = prev.then(() => mine);
    tails.set(username, tail);
    tail.then(() => { if (tails.get(username) === tail) tails.delete(username); });

    let timedOut = false;
    let cancel = null;
    const ready = prev.then(() => {
      cancel?.();
      if (timedOut) { release(); return null; }
      holders.set(username, kind);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        if (holders.get(username) === kind) holders.delete(username);
        release();
      };
    });
    if (!(timeoutMs > 0) || typeof after !== 'function') return ready;
    return new Promise((resolve, reject) => {
      cancel = after(timeoutMs, () => {
        timedOut = true;
        reject(Object.assign(new Error('triage busy'), { code: 'TRIAGE_BUSY', holder: holders.get(username) ?? null }));
      });
      ready.then((rel) => { if (rel) resolve(rel); }, reject);
    });
  }

  /** Runs fn while holding the user's lock. */
  async function run(username, fn, opts) {
    const release = await acquire(username, opts);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { acquire, run, holder: (username) => holders.get(username) ?? null };
}

export default createUserLock;
