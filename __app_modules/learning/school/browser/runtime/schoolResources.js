export const schoolResourceKey = key => JSON.stringify(key);
export const schoolResourceEmpty = data => data == null
  || (Array.isArray(data) && data.length === 0)
  || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);

const initial = () => ({ state: 'loading', data: null, refreshing: false, stale: false, error: null, lastSuccessAt: null });

/** An explicit-lifetime store. Keys must include surface, learner and effective query identity. */
export function createSchoolResourceStore({ maxEntries = 128 } = {}) {
  const entries = new Map();
  const limit = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 128;
  let touched = 0;
  function prune(protectedEntry = null) {
    while (entries.size > limit) {
      let oldest;
      for (const entry of entries.values()) {
        if (entry === protectedEntry || entry.listeners.size || entry.pending || entry.controller) continue;
        if (!oldest || entry.touched < oldest.touched) oldest = entry;
      }
      if (!oldest) break;
      entries.delete(schoolResourceKey(oldest.key));
    }
  }
  function entryFor(key) {
    const id = schoolResourceKey(key);
    if (!entries.has(id)) entries.set(id, { key, snapshot: initial(), listeners: new Set(), generation: 0 });
    const entry = entries.get(id);
    entry.touched = ++touched;
    prune(entry);
    return entry;
  }
  function publish(entry, snapshot) {
    entry.snapshot = snapshot;
    entry.listeners.forEach(listener => listener());
  }
  function cancel(key) {
    const entry = entryFor(key);
    entry.generation += 1;
    entry.controller?.abort();
    entry.controller = null;
    entry.pending = null;
  }
  function read(key, load, {
    fresh = false, policy = 'current', isEmpty = schoolResourceEmpty, notFoundAs = 'error', nullAs = 'empty',
  } = {}) {
    const entry = entryFor(key);
    if (entry.pending && !fresh) return entry.pending;
    entry.controller?.abort();
    const generation = ++entry.generation;
    const controller = new AbortController();
    entry.controller = controller;
    entry.load = load;
    entry.options = { policy, isEmpty, notFoundAs, nullAs };
    const prior = entry.snapshot;
    // 'replace' is for reads whose former payload must disappear while refreshing.
    const useful = policy !== 'replace' && prior.lastSuccessAt != null && prior.data != null;
    publish(entry, useful
      ? { ...prior, refreshing: true, stale: true }
      : { ...initial(), lastSuccessAt: policy === 'replace' ? null : prior.lastSuccessAt });
    let cancelRead;
    const aborted = new Promise(resolve => { cancelRead = () => resolve({ ok: false, status: 0, data: null, error: { kind: 'aborted' } }); });
    controller.signal.addEventListener('abort', cancelRead, { once: true });
    let operation;
    try { operation = Promise.resolve(load({ signal: controller.signal, fresh })); }
    catch { operation = Promise.reject(new Error('resource-loader-failed')); }
    const started = Promise.race([operation, aborted]).then(result => {
      if (entry.generation !== generation) return entry.snapshot;
      if (!result?.ok) {
        if (result?.status === 404 && notFoundAs !== 'error') {
          publish(entry, { ...initial(), state: notFoundAs });
        } else {
          const error = { status: result?.status ?? 0, kind: result?.error?.kind ?? (result?.status ? 'http' : 'network') };
          publish(entry, useful
            ? { ...prior, refreshing: false, stale: true, error }
            : { ...initial(), state: 'error', error });
        }
      } else {
        const data = result.data;
        publish(entry, {
          state: data === null ? nullAs : isEmpty(data) ? 'empty' : 'ready', data,
          refreshing: false, stale: false, error: null, lastSuccessAt: Date.now(),
        });
      }
      return entry.snapshot;
    }).catch(() => {
      if (entry.generation !== generation) return entry.snapshot;
      const error = { status: 0, kind: 'exception' };
      publish(entry, useful
        ? { ...prior, refreshing: false, stale: true, error }
        : { ...initial(), state: 'error', error });
      return entry.snapshot;
    }).finally(() => {
      controller.signal.removeEventListener('abort', cancelRead);
      if (entry.generation === generation) {
        entry.pending = null;
        entry.controller = null;
      }
      prune();
    });
    entry.pending = started;
    return started;
  }
  function invalidate(scope = () => true) {
    const matches = typeof scope === 'function' ? scope : key => Array.isArray(scope) && Array.isArray(key)
      ? scope.every((part, i) => schoolResourceKey(part) === schoolResourceKey(key[i]))
      : schoolResourceKey(scope) === schoolResourceKey(key);
    for (const entry of entries.values()) {
      if (!matches(entry.key)) continue;
      cancel(entry.key);
      publish(entry, { ...entry.snapshot, refreshing: false, stale: entry.snapshot.lastSuccessAt != null });
      if (entry.listeners.size && entry.load) read(entry.key, entry.load, { ...entry.options, fresh: true });
    }
  }
  return {
    get size() { return entries.size; },
    getSnapshot: key => entryFor(key).snapshot,
    subscribe(key, listener) {
      const entry = entryFor(key);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        if (!entry.listeners.size) cancel(key);
        prune();
      };
    },
    read, invalidate, cancel,
  };
}
