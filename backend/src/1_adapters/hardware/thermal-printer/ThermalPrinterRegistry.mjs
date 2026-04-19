/**
 * ThermalPrinterRegistry - registry of named ThermalPrinterAdapter instances
 *
 * Holds N adapters keyed by location name (e.g. 'upstairs', 'downstairs').
 * One adapter may be flagged as the default; callers that don't specify
 * a name resolve to it.
 *
 * Pure in-memory — no network I/O, no disk I/O.
 *
 * @module adapters/hardware/thermal-printer
 */

export class ThermalPrinterRegistry {
  #printers = new Map();
  #defaultName = null;

  /**
   * @param {string} name
   * @param {ThermalPrinterAdapter} adapter
   * @param {{ isDefault?: boolean }} [options]
   */
  register(name, adapter, { isDefault = false } = {}) {
    if (this.#printers.has(name)) {
      throw new Error(`Printer "${name}" already registered`);
    }
    if (isDefault && this.#defaultName) {
      throw new Error(
        `Cannot register "${name}" as default — "${this.#defaultName}" is already the default`
      );
    }
    this.#printers.set(name, adapter);
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
    if (!name) return this.getDefault();
    return this.get(name);
  }

  list() {
    return Array.from(this.#printers.entries()).map(([name, adapter]) => ({
      name,
      host: adapter.getHost(),
      port: adapter.getPort(),
      isDefault: name === this.#defaultName,
    }));
  }
}

export default ThermalPrinterRegistry;
