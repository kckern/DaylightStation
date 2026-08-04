import { describe, expect, it } from 'vitest';
import {
  TI86_OUTPUT_RECEIPT_BYTES,
  decodeTi86OutputReceipt,
  encodeTi86OutputReceipt,
  isTi86OutputReceiptCurrent,
  isTi86OutputReported,
  markTi86OutputReceipt,
} from './ti86-output-receipt.mjs';

describe('TI-86 QR optical-output receipts', () => {
  it('records reported DSQ ordinals without modifying delivery state', () => {
    const receipt = encodeTi86OutputReceipt({ baseSequence: 41, reportedIndexes: [0, 4, 169] });
    expect(receipt).toHaveLength(TI86_OUTPUT_RECEIPT_BYTES);
    expect(decodeTi86OutputReceipt(receipt)).toEqual({ baseSequence: 41, reportedIndexes: [0, 4, 169] });
    expect(isTi86OutputReported(receipt, { baseSequence: 41, index: 4 })).toBe(true);
    expect(isTi86OutputReported(receipt, { baseSequence: 41, index: 5 })).toBe(false);
  });

  it('resets stale or corrupt receipts rather than treating them as an acknowledgement', () => {
    const receipt = markTi86OutputReceipt(null, { baseSequence: 41, index: 2 });
    expect(isTi86OutputReceiptCurrent(receipt, { baseSequence: 41, queueLength: 3 })).toBe(true);
    expect(isTi86OutputReceiptCurrent(receipt, { baseSequence: 44, queueLength: 1 })).toBe(false);
    const corrupt = Buffer.from(receipt);
    corrupt[11] ^= 1;
    expect(isTi86OutputReceiptCurrent(corrupt, { baseSequence: 41, queueLength: 3 })).toBe(false);
    expect(markTi86OutputReceipt(corrupt, { baseSequence: 44, index: 0 }))
      .toEqual(encodeTi86OutputReceipt({ baseSequence: 44, reportedIndexes: [0] }));
  });
});
