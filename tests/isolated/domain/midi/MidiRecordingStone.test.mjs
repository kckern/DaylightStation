import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  archiveRelPathForStone,
  parseMidiRecordingStone,
} from '#domains/midi/MidiRecordingStoneCodec.mjs';

const FIXTURE = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2001.mid', import.meta.url));

describe('MidiRecordingStone', () => {
  it('parses the embedded jmxStoneHdr timestamp + metadata', () => {
    const s = parseMidiRecordingStone(FIXTURE);
    expect(s.unixtime).toBe(978488260);
    expect(s.localOffsetMin).toBe(-480);
    expect(s.recorderName).toBe('Test Piano');
    expect(s.performerName).toBe('Test Performer');
    expect(s.assetUuid).toBe('00000000-0000-4000-8000-0000000000a5');
    expect(s.assetIdx).toBe(5);
  });

  it('derives the local-time archive rel path', () => {
    const s = parseMidiRecordingStone(FIXTURE);
    expect(archiveRelPathForStone(s)).toBe('2001/2001-01/2001-01-02 18.17.40.mid');
  });

  it('throws when the buffer has no jmxStoneHdr', () => {
    expect(() => parseMidiRecordingStone(Buffer.from('MThd not a jamcorder file'))).toThrow();
  });
});
