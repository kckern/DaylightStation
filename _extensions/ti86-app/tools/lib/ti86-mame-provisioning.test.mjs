import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTi86MameReleaseInstallers, TI86_MAME_INSTALL_MARKER } from './ti86-mame-provisioning.mjs';
import { readTi86VariableFile } from './ti86-program.mjs';

const DIST = new URL('../../dist/', import.meta.url);

describe('TI-86 MAME release provisioning', () => {
  it('preserves the exact program and String variable bytes from the release', () => {
    const program = readFileSync(new URL('SCHLCALC.86p', DIST));
    const string = readFileSync(new URL('DSUSERS.86s', DIST));
    const progress = readFileSync(new URL('DSPROG.86s', DIST));
    const installers = createTi86MameReleaseInstallers({ transferFiles: [
      { fileName: 'SCHLCALC.86p', bytes: program },
      { fileName: 'DSUSERS.86s', bytes: string },
      { fileName: 'DSPROG.86s', bytes: progress },
    ] });
    expect(installers.map(({ name, type }) => [name, type])).toEqual([
      ['SCHLCALC', 0x12], ['DSUSERS', 0x0C], ['DSPROG', 0x0C],
    ]);
    expect(installers[0].variableData).toEqual(readTi86VariableFile(program).variableData);
    expect(installers[1].variableData).toEqual(readTi86VariableFile(string).variableData);
    expect(installers[2].variableData).toEqual(readTi86VariableFile(progress).variableData);
    expect(installers.every(({ code }) => code.includes(Buffer.from([
      0x3E, 0xA5, 0x32, TI86_MAME_INSTALL_MARKER & 0xFF, TI86_MAME_INSTALL_MARKER >>> 8,
    ])))).toBe(true);
  });
});
