/**
 * Single-owner arbiter for the one physical fingerprint reader.
 *
 * The U.are.U reader is claimed exclusively by libfprint, so the garage box can
 * run only ONE identify scan at a time. Two callers compete for it: the
 * always-armed EMERGENCY scan (re-armed continuously by the backend) and
 * on-demand FOREGROUND unlocks (dance_party etc.). Without arbitration the box
 * spawned a rival helper per request; the loser failed instantly (reader busy)
 * so foreground unlocks died before the user could press.
 *
 * Policy: at most one scan runs. A FOREGROUND request PREEMPTS an in-flight
 * EMERGENCY scan (abort it, wait for the reader to release, then run). Anything
 * else that arrives while a scan is in flight gets { matched:false,
 * reason:'reader-busy' } — the backend re-arms emergency on its own loop.
 *
 * @param {object} deps
 * @param {(uuids: string[], opts: { signal: AbortSignal }) => Promise<{matched:boolean, uuid?:string, reason?:string}>} deps.runScan
 *   Runs ONE identify against the uuids. MUST resolve when `signal` aborts.
 * @param {{ log?: Function }} [deps.logger]
 */
export function createReaderArbiter({ runScan, logger = console }) {
  // The in-flight scan, or null when the reader is idle.
  // { kind:'emergency'|'foreground', controller:AbortController, done:Promise }
  let current = null;

  async function submit({ kind, uuids }) {
    if (current) {
      const preemptable = kind === 'foreground' && current.kind === 'emergency';
      if (!preemptable) {
        logger.log?.(`🔐 reader busy (have ${current.kind}, refused ${kind})`);
        return { matched: false, reason: 'reader-busy' };
      }
      // Preempt the in-flight emergency scan and wait for it to fully release the
      // reader before claiming it — reopening while still claimed fails.
      const inflight = current;
      logger.log?.(`🔐 ${kind} preempts in-flight ${inflight.kind} scan`);
      inflight.controller.abort();
      await inflight.done;
    }

    const controller = new AbortController();
    // Invoke runScan synchronously (not via a deferred microtask) so the scan
    // claims the reader — and registers itself — before submit() yields. A later
    // preempt that awaits `done` then sees the real in-flight scan.
    const scan = (async () => runScan(uuids, { signal: controller.signal }))();
    // `done` settles when the scan finishes (success/abort/error) so a later
    // preempt can await release; swallow rejection so it never escapes unhandled.
    const done = scan.then(() => {}, () => {});
    current = { kind, controller, done };
    try {
      return await scan;
    } finally {
      current = null;
    }
  }

  return {
    submit,
    /** @returns {string|null} kind of the in-flight scan, or null when idle. */
    currentKind() { return current?.kind ?? null; },
  };
}
