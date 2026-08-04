import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import {
  TI86_ACTION_QR_BYTES,
  TI86_ACTION_QR_MODULES,
  encodeTi86SchoolActionQr,
  readTi86SchoolActionQrModule,
} from './Ti86SchoolActionQr.mjs';

const TOKEN = 'sch:23456789ABCDEFGH';

describe('TI-86 School action QR projection', () => {
  it('packs the exact mixed-mode Version-1/EC-L oracle into 63 bytes', () => {
    const packed = encodeTi86SchoolActionQr(TOKEN);
    const oracle = QRCode.create([
      { data: 'sch:', mode: 'byte' },
      { data: TOKEN.slice(4), mode: 'alphanumeric' },
    ], { version: 1, errorCorrectionLevel: 'L' });
    expect(packed).toHaveLength(TI86_ACTION_QR_BYTES);
    expect(TI86_ACTION_QR_MODULES).toBe(21);
    for (let y = 0; y < 21; y += 1) for (let x = 0; x < 21; x += 1) {
      expect(readTi86SchoolActionQrModule(packed, x, y)).toBe(Boolean(oracle.modules.get(x, y)));
    }
    for (let y = 0; y < 21; y += 1) expect(packed[y * 3 + 2] & 0x07).toBe(0);
  });

  it.each([
    'sch:TOO-SHORT',
    'sch:OOOOOOOOOOOOOOOO',
    'SCH:23456789ABCDEFGH',
    'sch:r1:23456789ABCDE',
  ])('rejects payload outside the opaque action profile: %s', (token) => {
    expect(() => encodeTi86SchoolActionQr(token)).toThrow(/opaque/);
  });
});
