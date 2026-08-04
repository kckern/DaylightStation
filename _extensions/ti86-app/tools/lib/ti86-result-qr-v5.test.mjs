import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { encodeTi86ResultRecord } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  TI86_RESULT_QR_DATA_CODEWORDS,
  TI86_RESULT_QR_ECC_CODEWORDS,
  TI86_RESULT_QR_MAX_RECORD_BYTES,
  TI86_RESULT_QR_SIZE,
  TI86_RESULT_QR_TOTAL_CODEWORDS,
  createTi86ResultQrV5,
  renderTi86ResultQrV5Assembly,
} from './ti86-result-qr-v5.mjs';

describe('fixed TI-86 on-device result QR reference', () => {
  it('matches the QR library exactly for small, progress, and maximum v0 SCR1 records', () => {
    const fixtures = [
      resultRecord(1, 1, '86A001'),
      encodeTi86ResultRecord({
        schema: 'school.calc.result/v1', kind: 'progress', deviceId: '86A001', sequence: 2, learnerKey: 4,
        artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
        progress: { status: 'completed', position: 23, total: 23 },
      }),
      resultRecord(0xff_fffe, 48, '1234567890ABCDEF'),
    ];
    expect(fixtures.at(-1)).toHaveLength(69);

    for (const record of fixtures) {
      const encoded = createTi86ResultQrV5(record);
      const oracle = QRCode.create(encoded.payload, {
        version: 5, errorCorrectionLevel: 'M', maskPattern: 0,
      });
      expect(oracle.modules.size).toBe(TI86_RESULT_QR_SIZE);
      expect([...encoded.modules]).toEqual([...oracle.modules.data]);
      expect(encoded.dataCodewords).toHaveLength(TI86_RESULT_QR_DATA_CODEWORDS);
      expect(encoded.errorCorrection).toHaveLength(TI86_RESULT_QR_ECC_CODEWORDS * 2);
      expect(encoded.codewords).toHaveLength(TI86_RESULT_QR_TOTAL_CODEWORDS);
      expect(encoded.frame).toHaveLength(1024);
    }
  });

  it('keeps the fixed runtime bound explicit and emits deterministic assembly assets', () => {
    expect(() => createTi86ResultQrV5(Buffer.alloc(TI86_RESULT_QR_MAX_RECORD_BYTES)))
      .not.toThrow();
    expect(() => createTi86ResultQrV5(Buffer.alloc(TI86_RESULT_QR_MAX_RECORD_BYTES + 1)))
      .toThrow(/exceeds 69 bytes/);
    const source = renderTi86ResultQrV5Assembly();
    expect(source).toContain('scqr_reserved_bits:');
    expect(source).toContain('scqr_function_dark_bits:');
    expect(source).toContain('scqr_rs_generator_tail:');
    expect(source).not.toMatch(/(?:deviceId|artifactId|response)/);
  });
});

function resultRecord(sequence, count, deviceId) {
  return encodeTi86ResultRecord({
    schema: 'school.calc.result/v1', kind: 'responses', deviceId, sequence, learnerKey: 4,
    artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
    responses: Array.from({ length: count }, (_, itemIndex) => ({
      itemIndex, given: (itemIndex % 5) + 1,
    })),
    localScore: {
      correct: Math.floor(count / 2), total: count,
      percent: Math.round((Math.floor(count / 2) / count) * 100),
    },
  });
}
