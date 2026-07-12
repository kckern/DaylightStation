/**
 * JamCorderStone — value object parsed from a JamCorder .mid recording.
 *
 * Each recording embeds a sequencer-specific MIDI meta event (0xFF 0x7F) whose
 * payload is a JSON header `jmxStoneHdr{…}` carrying an SNTP-synced timestamp
 * (`time.unixtime`, `time.localOffset` minutes) plus device/performer metadata.
 *
 * Layer: DOMAIN value object (2_domains/jamcorder). Pure — parses a provided
 * buffer, no I/O, no system clock.
 *
 * @module domains/jamcorder/JamCorderStone
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const pad2 = (n) => String(n).padStart(2, '0');

export class JamCorderStone {
  #unixtime; #localOffsetMin; #jamcorderName; #performerName; #assetUuid; #assetIdx;

  constructor({ unixtime, localOffsetMin, jamcorderName, performerName, assetUuid, assetIdx }) {
    this.#unixtime = unixtime;
    this.#localOffsetMin = localOffsetMin;
    this.#jamcorderName = jamcorderName;
    this.#performerName = performerName;
    this.#assetUuid = assetUuid;
    this.#assetIdx = assetIdx;
    Object.freeze(this);
  }

  /**
   * @param {Buffer} buffer - raw .mid bytes
   * @returns {JamCorderStone}
   * @throws {ValidationError} if the jmxStoneHdr is missing or invalid
   */
  static fromMidiBuffer(buffer) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer ?? '');
    const marker = text.indexOf('jmxStoneHdr');
    if (marker === -1) {
      throw new ValidationError('jmxStoneHdr not found in MIDI buffer', { code: 'JAMCORDER_NO_HEADER' });
    }
    const braceStart = text.indexOf('{', marker);
    if (braceStart === -1) {
      throw new ValidationError('jmxStoneHdr JSON start not found', { code: 'JAMCORDER_NO_HEADER' });
    }
    let depth = 0, end = -1;
    for (let i = braceStart; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) {
      throw new ValidationError('jmxStoneHdr JSON not terminated', { code: 'JAMCORDER_BAD_HEADER' });
    }
    let hdr;
    try {
      hdr = JSON.parse(text.slice(braceStart, end + 1));
    } catch (err) {
      throw new ValidationError(`jmxStoneHdr JSON parse failed: ${err.message}`, { code: 'JAMCORDER_BAD_HEADER' });
    }
    const unixtime = hdr?.time?.unixtime;
    const localOffsetMin = hdr?.time?.localOffset;
    if (typeof unixtime !== 'number' || typeof localOffsetMin !== 'number') {
      throw new ValidationError('jmxStoneHdr missing time.unixtime/localOffset', { code: 'JAMCORDER_BAD_HEADER' });
    }
    return new JamCorderStone({
      unixtime,
      localOffsetMin,
      jamcorderName: hdr?.identities?.jamcorderName ?? null,
      performerName: hdr?.identities?.performerName ?? null,
      assetUuid: hdr?.asset?.assetUuid ?? null,
      assetIdx: hdr?.asset?.assetIdx ?? null,
    });
  }

  get unixtime() { return this.#unixtime; }
  get localOffsetMin() { return this.#localOffsetMin; }
  get jamcorderName() { return this.#jamcorderName; }
  get performerName() { return this.#performerName; }
  get assetUuid() { return this.#assetUuid; }
  get assetIdx() { return this.#assetIdx; }

  /**
   * Archive-relative path in local recording time:
   *   "YYYY/YYYY-MM/YYYY-MM-DD HH.MM.SS.mid"
   * Deterministic: shifts the explicit epoch by localOffset and reads UTC parts.
   * @returns {string}
   */
  archiveRelPath() {
    const ms = (this.#unixtime + this.#localOffsetMin * 60) * 1000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = pad2(d.getUTCMonth() + 1);
    const stamp = `${y}-${mo}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}.${pad2(d.getUTCMinutes())}.${pad2(d.getUTCSeconds())}`;
    return `${y}/${y}-${mo}/${stamp}.mid`;
  }
}

export default JamCorderStone;
