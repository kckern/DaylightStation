/**
 * VirtualScannerAdapter — a barcode scanner with no barcode and no scanner.
 *
 * Stands in for the ESP32 barcode relay: it publishes exactly the normalized
 * event `createBarcodeRelay` broadcasts (`backend/src/3_applications/hardware/
 * barcodeRelay.mjs`) on the same `barcode-relay` topic, and hands the same
 * payload to the same optional `onScan` callback — which now hands every scan to
 * the shared scan vocabulary (`#composition/modules/scanDispatch.mjs`), School's
 * `sch:` tokens included. Subscribers cannot tell the difference.
 *
 * Note the broadcast payload is `{ source, device, route, code, ts }`: the
 * inbound `type: 'scan'` discriminator belongs to the relay's WS ingest message
 * and is deliberately dropped on re-broadcast. This double emits what the relay
 * emits, not what the relay receives.
 *
 * @module adapters/hardware/scanner
 */
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const RELAY_SOURCE = 'barcode-relay';
const TOPIC = 'barcode-relay';
const ROUTES = Object.freeze(['content', 'nutribot']);

export class VirtualScannerAdapter {
  #eventBus; #onScan; #defaultDevice; #defaultRoute; #timezone; #logger; #clock;
  #cards = new Map();
  #scans = [];

  /**
   * @param {Object} deps
   * @param {Object} deps.eventBus - IEventBus; only `broadcast` is used
   * @param {Function} [deps.onScan] - (payload) => void, e.g. the BarcodeScanService dispatch
   * @param {string} [deps.defaultDevice='virtual-scanner']
   * @param {'content'|'nutribot'} [deps.defaultRoute='content']
   * @param {string} [deps.timezone] - IANA tz for `ts` (household tz by default)
   * @param {Object} [deps.logger=console]
   * @param {() => Date} [deps.clock]
   */
  constructor({
    eventBus,
    onScan = null,
    defaultDevice = 'virtual-scanner',
    defaultRoute = 'content',
    timezone = DEFAULT_TIMEZONE,
    logger = console,
    clock = () => new Date(),
  } = {}) {
    if (!eventBus) {
      throw new InfrastructureError('VirtualScannerAdapter requires eventBus', {
        code: 'MISSING_DEPENDENCY', dependency: 'eventBus',
      });
    }
    if (typeof eventBus.broadcast !== 'function') {
      throw new InfrastructureError('VirtualScannerAdapter requires eventBus.broadcast', {
        code: 'MISSING_DEPENDENCY', dependency: 'eventBus.broadcast',
      });
    }
    this.#eventBus = eventBus;
    this.#onScan = onScan;
    this.#defaultDevice = defaultDevice;
    this.#defaultRoute = ROUTES.includes(defaultRoute) ? defaultRoute : 'content';
    this.#timezone = timezone;
    this.#logger = logger;
    this.#clock = clock;
  }

  /**
   * Emit one scan. Any string is legal — an unknown or garbage code is a real
   * scan and must reach the router, which is what decides it means nothing.
   *
   * @param {string} code
   * @param {Object} [opts]
   * @param {string} [opts.device]
   * @param {'content'|'nutribot'} [opts.route]
   * @returns {Object|null} the broadcast payload, or null for an empty code
   */
  scan(code, { device, route } = {}) {
    const trimmed = typeof code === 'string' ? code.trim() : '';
    if (!trimmed) {
      this.#logger.warn?.('virtual-scanner.ingest.empty', {});
      return null;
    }
    const payload = {
      source: RELAY_SOURCE,
      device: (typeof device === 'string' && device) ? device : this.#defaultDevice,
      route: ROUTES.includes(route) ? route : this.#defaultRoute,
      code: trimmed,
      ts: formatLocalTimestamp(this.#clock(), this.#timezone),
    };

    this.#eventBus.broadcast(TOPIC, payload);
    this.#scans.push(payload);
    this.#logger.info?.('virtual-scanner.scan', { device: payload.device, code: payload.code });

    if (typeof this.#onScan === 'function') {
      try { this.#onScan(payload); }
      catch (err) { this.#logger.warn?.('virtual-scanner.onScan.failed', { error: err.message }); }
    }
    return payload;
  }

  /**
   * Scan the same code twice — the replay a child produces by waving the card
   * past the reader, and the input every idempotency guard has to survive.
   *
   * @param {string} code
   * @param {Object} [opts] - same options as {@link scan}
   * @returns {Array<Object>} both payloads (empty when the code was dropped)
   */
  scanTwice(code, opts = {}) {
    return [this.scan(code, opts), this.scan(code, opts)].filter(Boolean);
  }

  /**
   * @param {string} learnerId
   * @param {string} token - the code printed on the learner's personal card
   */
  registerCard(learnerId, token) {
    const id = typeof learnerId === 'string' ? learnerId.trim() : '';
    const code = typeof token === 'string' ? token.trim() : '';
    if (!id || !code) {
      throw new InfrastructureError('registerCard requires a learnerId and a token', {
        code: 'INVALID_CARD', learnerId, token,
      });
    }
    this.#cards.set(id, code);
  }

  /**
   * @param {string} learnerId
   * @param {Object} [opts] - same options as {@link scan}
   * @returns {Object} the broadcast payload
   */
  scanCard(learnerId, opts = {}) {
    const token = this.#cards.get(learnerId);
    if (!token) {
      throw new InfrastructureError(`no card registered for learner ${learnerId}`, {
        code: 'UNKNOWN_CARD', learnerId,
      });
    }
    return this.scan(token, opts);
  }

  /** @returns {Object<string,string>} learnerId → card token */
  listCards() {
    return Object.fromEntries(this.#cards);
  }

  /** @returns {Array<Object>} emitted payloads in order */
  listScans() {
    return this.#scans.map((s) => ({ ...s }));
  }

  /** @returns {Object|null} */
  lastScan() {
    return this.#scans.length ? { ...this.#scans[this.#scans.length - 1] } : null;
  }
}

export default VirtualScannerAdapter;
