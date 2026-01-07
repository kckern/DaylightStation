import { describe, it, expect, beforeEach } from '@jest/globals';
import { RenphoJumpropeDecoder } from '../../../_extensions/fitness/src/decoders/jumprope.mjs';

describe('RenphoJumpropeDecoder', () => {
  let decoder;

  beforeEach(() => {
    decoder = new RenphoJumpropeDecoder();
  });

  describe('direction-agnostic revolution detection', () => {
    it('counts revolutions when counter increases', () => {
      // First packet establishes baseline
      const result1 = decoder.processPacket(createPacket(0));
      expect(result1.revolutions).toBe(0);

      const result2 = decoder.processPacket(createPacket(5));
      expect(result2.revolutions).toBe(5);

      const result3 = decoder.processPacket(createPacket(8));
      expect(result3.revolutions).toBe(8);
    });

    it('counts revolutions when counter decreases (countdown mode)', () => {
      // Start at 100 (countdown game)
      const result1 = decoder.processPacket(createPacket(100));
      expect(result1.revolutions).toBe(0);

      // Count down
      const result2 = decoder.processPacket(createPacket(98));
      expect(result2.revolutions).toBe(2);

      const result3 = decoder.processPacket(createPacket(95));
      expect(result3.revolutions).toBe(5);
    });

    it('caps large jumps to prevent mode-switch spikes', () => {
      decoder.processPacket(createPacket(10));
      // Simulate mode switch (counter jumps from 10 to 500)
      const result = decoder.processPacket(createPacket(500));
      // Should count as 1, not 490
      expect(result.revolutions).toBe(1);
    });

    it('ignores duplicate values', () => {
      decoder.processPacket(createPacket(5));
      const result1 = decoder.processPacket(createPacket(5));
      const result2 = decoder.processPacket(createPacket(5));
      expect(result1.revolutions).toBe(5);
      expect(result2.revolutions).toBe(5); // No change
    });

    it('resets on disconnect', () => {
      decoder.processPacket(createPacket(50));
      expect(decoder.processPacket(createPacket(55)).revolutions).toBe(5);

      decoder.reset();

      const result = decoder.processPacket(createPacket(10));
      expect(result.revolutions).toBe(0); // Fresh baseline
    });
  });

  describe('formatForWebSocket', () => {
    it('outputs only revolutions and timestamp', () => {
      decoder.processPacket(createPacket(10));
      const ws = decoder.formatForWebSocket({ address: 'AA:BB', name: 'R-Q008' });

      expect(ws.data).toHaveProperty('revolutions');
      expect(ws.data).not.toHaveProperty('rpm');
      expect(ws.data).not.toHaveProperty('avgRPM');
      expect(ws.data).not.toHaveProperty('maxRPM');
      expect(ws.data).not.toHaveProperty('calories');
    });
  });
});

/**
 * Create a mock 0xAD packet with jump count at bytes 14-15
 */
function createPacket(jumpCount) {
  const packet = new Uint8Array(20);
  packet[0] = 0xAD; // Packet type
  packet[1] = 0;    // Sequence
  packet[14] = jumpCount & 0xFF;
  packet[15] = (jumpCount >> 8) & 0xFF;
  return packet;
}
