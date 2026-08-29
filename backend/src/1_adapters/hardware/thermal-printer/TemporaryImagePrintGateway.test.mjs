import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TemporaryImagePrintGateway } from './TemporaryImagePrintGateway.mjs';

describe('TemporaryImagePrintGateway', () => {
  it('owns and cleans the temporary path around the path-based driver call', async () => {
    const expectedPath = path.join(os.tmpdir(), 'gratitude_card_987654321.png');
    const createImagePrint = vi.fn((filePath, options) => ({ filePath, options }));
    const print = vi.fn(async (job) => {
      expect(fs.readFileSync(job.filePath)).toEqual(Buffer.from('png'));
      return { verified: true };
    });
    const gateway = new TemporaryImagePrintGateway({ clock: () => 987654321 });
    await expect(gateway.print({ createImagePrint, print }, { buffer: Buffer.from('png'), width: 10 }))
      .resolves.toEqual({ verified: true });
    expect(createImagePrint).toHaveBeenCalledWith(expectedPath, { width: 10 });
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
