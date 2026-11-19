/**
 * ThermalPrinterRegistry - registry of named ThermalPrinterAdapter instances
 *
 * Holds N adapters keyed by location name (e.g. 'upstairs', 'downstairs').
 * One adapter may be flagged as the default; callers that don't specify
 * a name resolve to it.
 *
 * A printer may name fallbacks (`fallback: ['upstairs']`). Resolving it then
 * returns a RoutedThermalPrinter that moves a job the printer never took to
 * the next one in line; callers keep the same surface either way.
 *
 * Pure in-memory — no network I/O, no disk I/O.
 *
 * @module adapters/hardware/thermal-printer
 */

import { IPrinterFleet } from '#apps/printer/ports/IPrinterFleet.mjs';
import { RoutedThermalPrinter } from './RoutedThermalPrinter.mjs';

export class ThermalPrinterRegistry extends IPrinterFleet {
  #printers = new Map();
  #fallbacks = new Map();
  #routed = new Map();
  #defaultName = null;
  #logger;
  #downForMs;

  constructor({ logger = console, downForMs } = {}) {
    super();
    this.#logger = logger;
    this.#downForMs = downForMs;
  }

  /**
   * @param {string} name
   * @param {ThermalPrinterAdapter} adapter
   * @param {{ isDefault?: boolean, fallback?: string[] }} [options]
   */
  register(name, adapter, { isDefault = false, fallback = [] } = {}) {
    if (this.#printers.has(name)) {
      throw new Error(`Printer "${name}" already registered`);
    }
    if (isDefault && this.#defaultName) {
      throw new Error(
        `Cannot register "${name}" as default — "${this.#defaultName}" is already the default`
      );
    }
    this.#printers.set(name, adapter);
    if (Array.isArray(fallback) && fallback.length) this.#fallbacks.set(name, fallback.map(String));
    if (isDefault) this.#defaultName = name;
  }

  has(name) {
    return this.#printers.has(name);
  }

  get(name) {
    const adapter = this.#printers.get(name);
    if (!adapter) throw new Error(`Unknown printer location: "${name}"`);
    return adapter;
  }

  getDefault() {
    if (!this.#defaultName) throw new Error('No default printer configured');
    return this.#printers.get(this.#defaultName);
  }

  /**
   * Resolve a name to an adapter; falls back to default when name is empty.
   * Throws on unknown name.
   */
  resolve(name) {
    const target = name || this.#defaultName;
    if (!target) throw new Error('No default printer configured');
    return this.#withRoute(target);
  }

  /** The printer itself, or its routed form when it names registered fallbacks. */
  #withRoute(name) {
    const adapter = this.get(name);
    const fallbacks = (this.#fallbacks.get(name) ?? []).filter((other) => other !== name && this.#printers.has(other));
    if (!fallbacks.length) return adapter;
    if (!this.#routed.has(name)) {
      this.#routed.set(name, new RoutedThermalPrinter({
        name,
        chain: [name, ...fallbacks].map((link) => ({ name: link, adapter: this.#printers.get(link) })),
        logger: this.#logger,
        ...(this.#downForMs ? { downForMs: this.#downForMs } : {}),
      }));
    }
    return this.#routed.get(name);
  }

  list() {
    return Array.from(this.#printers.entries()).map(([name, adapter]) => ({
      name,
      host: adapter.getHost(),
      port: adapter.getPort(),
      isDefault: name === this.#defaultName,
      fallback: this.#fallbacks.get(name) ?? [],
    }));
  }
}

export default ThermalPrinterRegistry;
