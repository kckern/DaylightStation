/**
 * Adapter: input reports a remote sends over Bluetooth LE that the kernel
 * drops (a HID report its own report map does not declare). Runs
 * remote_keys_helper.py in `gatt` mode, which reads ATT notifications off the
 * BlueZ HCI monitor channel (like btmon) and maps connection handles to
 * addresses with `hcitool con`; only remotes the kernel already lists are read.
 *
 * Each report is decoded by the report decoder configured for that remote's
 * address (input.yml `report_decoder`, given via setDecoders) — no device is
 * known here. A report with no decoder is still passed on as `report`.
 */
import { IRemoteInputSource } from '../ports/IRemoteInputSource.mjs';
import { runHelper, upperAddress } from './helperProcess.mjs';
import { normalizeDecoder, decodeReport, diffStates, hexBytes, holdAxesUnderButtons } from '../reportDecoder.mjs';

const hex4 = (n) => `0x${Number(n).toString(16).padStart(4, '0')}`;

export class BluezGattReportSource extends IRemoteInputSource {
  #runHelper; #spawn; #logger; #handle = null;
  #decoders = new Map();   // ADDRESS -> normalized decoder
  #state = new Map();      // ADDRESS -> last decoded state

  constructor({ runHelper: run = runHelper, spawn, logger = console, decoders = [] } = {}) {
    super();
    this.id = 'gatt';
    this.#runHelper = run; this.#spawn = spawn; this.#logger = logger;
    this.setDecoders(decoders);
  }

  /**
   * Replace the decoder table. Entries are inventory controllers
   * ({ address, report_decoder }); invalid ones are skipped.
   * @returns {number} how many decoders are now loaded
   */
  setDecoders(entries) {
    const next = new Map();
    for (const e of Array.isArray(entries) ? entries : []) {
      const d = normalizeDecoder(e);
      if (d) next.set(d.address, d);
    }
    this.#decoders = next;
    for (const a of [...this.#state.keys()]) if (!next.has(a)) this.#state.delete(a);
    return next.size;
  }

  get decoderCount() { return this.#decoders.size; }

  /** One helper line (gatt mode) -> normalized events. */
  handleLine(m) {
    if (m?.type === 'monitor-unavailable') return [{ kind: 'unavailable', source: this.id }];
    const address = upperAddress(m?.address);
    if (m?.type !== 'gatt' || !address) return [];
    const name = m.name || null;
    const channel = hex4(m.att);
    const out = [{ kind: 'report', source: this.id, address, name, channel, raw: m.value }];
    const dec = this.#decoders.get(address);
    if (!dec || dec.channel !== Number(m.att)) return out;
    const decoded = decodeReport(dec, hexBytes(m.value));
    if (!decoded) return out;
    const before = this.#state.get(address);
    // A remote whose button reports hide the stick keeps the stick as it was.
    const now = holdAxesUnderButtons(dec, before, decoded);
    this.#state.set(address, now);
    for (const { control, state } of diffStates(before, now)) {
      out.push({ kind: 'control', source: this.id, address, name, control, state,
        code: null, usage: `gatt:${channel}`, raw: m.value });
    }
    return out;
  }

  start({ onEvent }) {
    this.#handle = this.#runHelper({
      mode: 'gatt', spawn: this.#spawn, logger: this.#logger,
      onStart: () => this.#state.clear(),
      onLine: (m) => { for (const e of this.handleLine(m)) onEvent(e); },
      onExit: (info) => onEvent({ kind: 'source-exit', source: this.id, ...info }),
    });
  }

  stop() {
    this.#handle?.stop();
    this.#handle = null;
  }
}

export default BluezGattReportSource;
