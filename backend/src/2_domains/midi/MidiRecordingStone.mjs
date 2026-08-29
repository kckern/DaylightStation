/**
 * MidiRecordingStone — recorder metadata after transport decoding.
 *
 * Each recording embeds a sequencer-specific MIDI meta event (0xFF 0x7F) whose
 * payload is a JSON header `jmxStoneHdr{…}` carrying an SNTP-synced timestamp
 * (`time.unixtime`, `time.localOffset` minutes) plus device/performer metadata.
 * `jmxStoneHdr`, its field names and the JAMCORDER_* error codes below are the
 * recorder's on-the-wire format — they are read as-is, not renamed.
 *
 * Layer: DOMAIN value object (2_domains/midi). Pure — parses a provided
 * buffer, no I/O, no system clock.
 *
 * @module domains/midi/MidiRecordingStone
 */
export class MidiRecordingStone {
  #unixtime; #localOffsetMin; #recorderName; #performerName; #assetUuid; #assetIdx;

  constructor({ unixtime, localOffsetMin, recorderName, performerName, assetUuid, assetIdx }) {
    this.#unixtime = unixtime;
    this.#localOffsetMin = localOffsetMin;
    this.#recorderName = recorderName;
    this.#performerName = performerName;
    this.#assetUuid = assetUuid;
    this.#assetIdx = assetIdx;
    Object.freeze(this);
  }

  get unixtime() { return this.#unixtime; }
  get localOffsetMin() { return this.#localOffsetMin; }
  get recorderName() { return this.#recorderName; }
  get performerName() { return this.#performerName; }
  get assetUuid() { return this.#assetUuid; }
  get assetIdx() { return this.#assetIdx; }

}

export default MidiRecordingStone;
