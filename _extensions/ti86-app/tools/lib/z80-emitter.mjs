/** Tiny label-aware byte emitter for the fixed Z80 subset used by hardware probes. */
export class Z80Emitter {
  #origin; #bytes = []; #labels = new Map(); #fixups = [];

  constructor({ origin }) {
    if (!Number.isInteger(origin) || origin < 0 || origin > 0xFFFF) throw new Error('invalid Z80 origin');
    this.#origin = origin;
  }

  get address() { return this.#origin + this.#bytes.length; }
  get length() { return this.#bytes.length; }

  label(name) {
    if (this.#labels.has(name)) throw new Error(`duplicate Z80 label '${name}'`);
    this.#labels.set(name, this.address);
  }

  emit(...values) {
    for (const value of values.flat()) {
      if (!Number.isInteger(value) || value < 0 || value > 0xFF) throw new Error(`invalid Z80 byte ${value}`);
      this.#bytes.push(value);
    }
  }

  word(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new Error(`invalid Z80 word ${value}`);
    this.emit(value & 0xFF, value >>> 8);
  }

  wordLabel(name) {
    this.#fixups.push({ offset: this.#bytes.length, name });
    this.emit(0, 0);
  }

  call(address) { this.emit(0xCD); this.word(address); }
  jump(name) { this.emit(0xC3); this.wordLabel(name); }
  jumpZero(name) { this.emit(0xCA); this.wordLabel(name); }
  jumpNotZero(name) { this.emit(0xC2); this.wordLabel(name); }

  finish() {
    const output = Buffer.from(this.#bytes);
    for (const { offset, name } of this.#fixups) {
      const address = this.#labels.get(name);
      if (address === undefined) throw new Error(`unknown Z80 label '${name}'`);
      output.writeUInt16LE(address, offset);
    }
    return output;
  }
}

export default Z80Emitter;
