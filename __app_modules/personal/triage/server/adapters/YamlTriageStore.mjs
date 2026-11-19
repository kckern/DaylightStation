// Per-user triage state: the card queue and a monthly action log. Persisted through
// the injected dataService.user (no direct filesystem access).
const QUEUE = 'apps/triage/queue';
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);
const LOOKBACK_MONTHS = 24;

export function createYamlTriageStore({ dataService, clock = () => Date.now() }) {
  const read = async (rel, u) => (await dataService.user.read(rel, u)) ?? null;
  const write = async (rel, data, u) => {
    if ((await dataService.user.write(rel, data, u)) === false) throw new Error(`triage store write failed: ${rel}`);
  };
  const logPath = (month) => `apps/triage/log/${month}`;
  const months = (fromMs, count) => {
    const d = new Date(fromMs);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    }
    return out;
  };
  const entries = async (u, month) => {
    const rows = await read(logPath(month), u);
    return Array.isArray(rows) ? rows : [];
  };

  // Read-modify-write on a month file must not interleave for the same user.
  const chains = new Map();
  const exclusive = (u, fn) => {
    const run = (chains.get(u) ?? Promise.resolve()).then(fn);
    chains.set(u, run.catch(() => {}));
    return run;
  };

  return {
    async readQueue(u) {
      return (await read(QUEUE, u)) ?? { passId: null, builtAt: null, cards: [] };
    },
    async writeQueue(u, queue) {
      await write(QUEUE, queue, u);
    },
    appendLog(u, entry) {
      return exclusive(u, async () => {
        const month = monthKey(entry.at);
        const rows = await entries(u, month);
        await write(logPath(month), [...rows, entry], u);
        return entry;
      });
    },
    /** Entries (oldest first) with at >= sinceMs. */
    async readLog(u, { sinceMs = 0 } = {}) {
      const now = clock();
      const span = Math.min(LOOKBACK_MONTHS, Math.max(1, Math.ceil((now - sinceMs) / (28 * 86400000)) + 1));
      const out = [];
      for (const m of months(now, span).reverse()) out.push(...(await entries(u, m)));
      return out.filter((e) => e.at >= sinceMs);
    },
    async getEntry(u, entryId) {
      for (const m of months(clock(), LOOKBACK_MONTHS)) {
        const hit = (await entries(u, m)).find((e) => e.id === entryId);
        if (hit) return hit;
      }
      return null;
    },
    markUndone: (u, entryId, at) => exclusive(u, async () => {
      for (const m of months(clock(), LOOKBACK_MONTHS)) {
        const rows = await entries(u, m);
        const i = rows.findIndex((e) => e.id === entryId);
        if (i < 0) continue;
        const next = rows.map((e, j) => (j === i ? { ...e, undoneAt: at } : e));
        await write(logPath(m), next, u);
        return next[i];
      }
      return null;
    }),
  };
}
export default createYamlTriageStore;
