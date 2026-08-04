import { describe, expect, it } from 'vitest';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';
import { parseTi86StringFile } from './inspect-ti86-string.mjs';

describe('TI-86 String file inspector', () => {
  it('extracts the calculator String length word and exact record bytes', () => {
    const record = Buffer.from('SCI1-test', 'ascii');
    const file = createTi86StringFile({ name: 'DSINFO', record });
    const parsed = parseTi86StringFile(file);
    expect(parsed.name).toBe('DSINFO');
    expect(parsed.type).toBe(0x0C);
    expect(parsed.variableData.subarray(2)).toEqual(record);
  });
});

