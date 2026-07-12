import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JamCorderStone } from '#domains/jamcorder/JamCorderStone.mjs';

const FIXTURE = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));

describe('JamCorderStone', () => {
  it('parses the embedded jmxStoneHdr timestamp + metadata', () => {
    const s = JamCorderStone.fromMidiBuffer(FIXTURE);
    expect(s.unixtime).toBe(1767406660);
    expect(s.localOffsetMin).toBe(-480);
    expect(s.jamcorderName).toBe('Living Room Baby Grand');
    expect(s.performerName).toBe('Kern Family');
    expect(s.assetUuid).toBe('aa7eef01-73e8-f1cf-a823-3072c39d53cf');
    expect(s.assetIdx).toBe(5);
  });

  it('derives the local-time archive rel path', () => {
    const s = JamCorderStone.fromMidiBuffer(FIXTURE);
    expect(s.archiveRelPath()).toBe('2026/2026-01/2026-01-02 18.17.40.mid');
  });

  it('throws when the buffer has no jmxStoneHdr', () => {
    expect(() => JamCorderStone.fromMidiBuffer(Buffer.from('MThd not a jamcorder file'))).toThrow();
  });
});
