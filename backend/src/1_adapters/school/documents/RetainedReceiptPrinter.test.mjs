import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RetainedReceiptPrinter } from './RetainedReceiptPrinter.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe('RetainedReceiptPrinter', () => {
  it('reports dispatched-but-unverified bytes as printed and logs one correlated claim', async () => {
    let scratchPath;
    const targetLogger = logger();
    const printer = {
      print: vi.fn(async (job) => {
        scratchPath = job.items[0].path;
        expect(job.jobName).toBe('school-result-receipt/ses_1/original');
        expect(fs.existsSync(scratchPath)).toBe(true);
        return {
          dispatched: true,
          verified: false,
          verification: 'unreadable',
          faults: null,
          printerState: { answered: 0, error: 'Connection timeout' },
        };
      }),
    };
    const retained = new RetainedReceiptPrinter({ printer, logger: targetLogger });

    await expect(retained.print({
      bytes: Buffer.from('png'),
      representation: { mediaType: 'image/png', width: 384, height: 200 },
      jobName: 'school-result-receipt/ses_1/original',
    })).resolves.toMatchObject({
      printed: true,
      confirmed: false,
      faulted: false,
      reason: 'unverified',
      dispatched: true,
      statusAnswered: 0,
      statusError: 'Connection timeout',
    });
    expect(targetLogger.warn).toHaveBeenCalledWith(
      'school.receipt.artifact-print',
      expect.objectContaining({ jobName: 'school-result-receipt/ses_1/original', printed: true }),
    );
    expect(fs.existsSync(scratchPath)).toBe(false);
  });
});
