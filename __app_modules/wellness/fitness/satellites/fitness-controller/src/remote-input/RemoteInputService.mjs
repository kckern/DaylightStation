/**
 * Bluetooth remote input, per device (application service).
 *
 * Composes the IRemoteInputSource adapters it is given and turns their
 * normalized events into:
 *  - log-store events: `bt.remote.key` (address, name, code, key, usage), the
 *    low-level record of what arrived whether or not it reached the page;
 *    `bt.remote.unmapped` (input that became no key), `bt.remote.open` /
 *    `bt.remote.gone` (device nodes appearing / going away), `bt.remote.gatt`
 *    (a raw report, debug), `bt.remote.monitor-unavailable`, `bt.remote.helper-exit`;
 *  - the bus topic `bt.remote.key`, so the app can tell two remotes of the same
 *    model apart (a browser KeyboardEvent carries no device identity).
 *
 * Knows no vendor, OS tool or device: which sources exist and how they read is
 * the adapters' business (src/remote-input/adapters/).
 */
import { isRemoteInputSource } from './ports/IRemoteInputSource.mjs';

/**
 * A normalized event -> { log: [level, event, data] | null, bus: payload | null }.
 * The bus payload shape is the `bt.remote.key` contract the app consumes.
 */
export function eventToRecords(e) {
  switch (e?.kind) {
    case 'control': {
      const data = { address: e.address, name: e.name ?? null, code: e.code ?? null, key: e.control,
        usage: e.usage ?? null, state: e.state };
      if (e.raw != null) data.raw = e.raw;
      // Releases and repeats are debug: the press is the record people read.
      return { log: [e.state === 'down' ? 'info' : 'debug', 'bt.remote.key', data], bus: data };
    }
    case 'unrecognized':
      return { log: ['warn', 'bt.remote.unmapped', { address: e.address, report: e.raw }], bus: null };
    case 'report':
      return { log: ['debug', 'bt.remote.gatt', { address: e.address, name: e.name ?? null, att: e.channel, value: e.raw }], bus: null };
    case 'device-open':
      return { log: ['info', 'bt.remote.open', { address: e.address, name: e.name ?? null, node: e.node, kind: e.nodeKind }], bus: null };
    case 'device-gone':
      return { log: ['info', 'bt.remote.gone', { address: e.address, node: e.node }], bus: null };
    case 'unavailable':
      return { log: ['warn', 'bt.remote.monitor-unavailable', { source: e.source }], bus: null };
    case 'source-exit':
      return { log: ['warn', 'bt.remote.helper-exit', { source: e.source, code: e.code, signal: e.signal, restartInMs: e.restartInMs }], bus: null };
    default:
      return { log: null, bus: null };
  }
}

/**
 * Start every source.
 * @param {object} opts
 * @param {import('./ports/IRemoteInputSource.mjs').IRemoteInputSource[]} opts.sources
 * @param {(level:string, event:string, data:object) => void} opts.logEvent
 * @param {(topic:string, payload:object) => void} opts.send
 * @param {object} [opts.logger]
 * @returns {{ stop(): void }}
 */
export function startRemoteInput({ sources = [], logEvent, send, logger = console } = {}) {
  for (const s of sources) {
    if (!isRemoteInputSource(s)) throw new Error('startRemoteInput: every source must implement IRemoteInputSource');
  }
  const onEvent = (e) => {
    const { log, bus } = eventToRecords(e);
    if (log) {
      logEvent?.(...log);
      if (log[0] !== 'debug') logger?.log?.(`🎛️ ${log[1]} ${JSON.stringify(log[2])}`);
    }
    if (bus) send?.('bt.remote.key', bus);
  };
  for (const s of sources) s.start({ onEvent });
  return {
    stop() { for (const s of sources) s.stop(); },
  };
}
