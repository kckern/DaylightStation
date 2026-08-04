import { describe, expect, it } from 'vitest';
import { encodeTi86ResultRecord } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  classifySchoolQrPayload,
  createSchoolCalcQrFrame,
  TI86_FRAME_BYTES,
} from './schoolcalc-qr.mjs';

describe('SchoolCalc TI-86 QR design-system generator', () => {
  it('renders an opaque School action token as a doubled Version-1 QR', () => {
    const frame = createSchoolCalcQrFrame('sch:2K7QVM4X9HRJTBNP');
    expect(frame).toMatchObject({
      kind: 'action',
      version: 1,
      errorCorrectionLevel: 'L',
      moduleCount: 21,
      moduleScale: 2,
      occupiedPixels: 58,
    });
    expect(frame.bytes).toHaveLength(TI86_FRAME_BYTES);
    expect(frame.rows).toHaveLength(64);
    expect(frame.rows.every((row) => [...row].length === 128)).toBe(true);
  });

  it('fits 238 ordered A-E responses in the proven 61px Version-9/M profile', () => {
    const record = {
      schema: 'school.calc.result/v1',
      kind: 'responses',
      deviceId: '86A001',
      learnerKey: 4,
      sequence: 18,
      artifactId: 'sc:ti86:ABC234DEFG',
      moduleIndex: 0,
      responses: Array.from({ length: 238 }, (_, itemIndex) => ({
        itemIndex,
        given: (itemIndex % 5) + 1,
      })),
      localScore: { correct: 48, total: 238, percent: 20 },
    };
    const bytes = encodeTi86ResultRecord(record);
    const payload = encodeTi86ResultRecord(record, { qrText: true });
    const frame = createSchoolCalcQrFrame(payload);
    expect(bytes).toHaveLength(154);
    expect(payload).toHaveLength(254);
    expect(frame).toMatchObject({
      kind: 'result',
      version: 9,
      errorCorrectionLevel: 'M',
      moduleCount: 53,
      moduleScale: 1,
      occupiedPixels: 61,
    });
  });

  it('rejects payloads outside the School scan vocabulary', () => {
    expect(classifySchoolQrPayload('sch:2K7QVM4X9HRJTBNP')).toBe('action');
    expect(() => classifySchoolQrPayload('go:screen:media:1')).toThrow(/start with sch:/);
    expect(() => classifySchoolQrPayload('sch:PRINT:WORKSHEET')).toThrow(/neither/);
  });
});
