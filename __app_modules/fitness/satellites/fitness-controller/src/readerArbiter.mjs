// Single-reader arbiter. One physical fingerprint reader, several would-be consumers.
// The continuous scan loop is the default owner (kind 'scan'); 'enroll' and 'manage'
// preempt it by aborting the in-flight work via an AbortSignal, then take the reader.
//
// run({ kind, exec, preempts }) -> { ok: true, value } | { ok: false, reason: 'reader-busy' }
//   exec({ signal }) does the actual reader work and resolves with its result.
//   preempts: list of in-flight kinds this kind is allowed to cancel.
export function createReaderArbiter({ logger = console } = {}) {
  let current = null; // { kind, controller, done }

  async function run({ kind, exec, preempts = [] }) {
    if (current) {
      if (!preempts.includes(current.kind)) {
        logger.log?.(`🔐 reader busy (have ${current.kind}, refused ${kind})`);
        return { ok: false, reason: 'reader-busy' };
      }
      const inflight = current;
      logger.log?.(`🔐 ${kind} preempts in-flight ${inflight.kind}`);
      inflight.controller.abort();
      await inflight.done; // wait for the cancelled work to unwind before re-acquiring
    }

    const controller = new AbortController();
    const work = Promise.resolve().then(() => exec({ signal: controller.signal }));
    const done = work.then(() => {}, () => {}); // settled marker, never throws
    current = { kind, controller, done };
    try {
      const value = await work;
      return { ok: true, value };
    } finally {
      current = null;
    }
  }

  return {
    run,
    currentKind() { return current ? current.kind : null; },
  };
}
