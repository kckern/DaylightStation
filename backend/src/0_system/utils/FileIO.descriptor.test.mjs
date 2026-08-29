// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { writeToFileDescriptor } from './FileIO.mjs';

describe('writeToFileDescriptor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('continues partial writes until every byte is written', () => {
    const received = [];
    vi.spyOn(fs, 'writeSync').mockImplementation((_fd, buffer, offset, length) => {
      const count = Math.min(2, length);
      received.push(Buffer.from(buffer.subarray(offset, offset + count)));
      return count;
    });

    const content = 'A🙂BC';
    expect(writeToFileDescriptor(17, content)).toBe(Buffer.byteLength(content));
    expect(Buffer.concat(received).toString('utf8')).toBe(content);
    expect(fs.writeSync).toHaveBeenCalledTimes(4);
  });

  it('throws when a descriptor write makes no progress', () => {
    vi.spyOn(fs, 'writeSync')
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(0);

    expect(() => writeToFileDescriptor(17, 'record')).toThrow(/made no progress at byte 2 of 6/);
    expect(fs.writeSync).toHaveBeenCalledTimes(2);
  });
});
