import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
  verifyTi86Program,
} from './lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');

describe('SchoolCalc runtime UI renderer probe', () => {
  it('assembles into a bounded TI-86 program without full-screen frame payloads', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-ui-renderer-probe.mjs')], {
      cwd: path.resolve(EXTENSION, '..', '..'),
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCUIPRB.86p'));
    const { name, code } = verifyTi86Program(file, { expectedName: 'SCUIPRB' });
    expect(name).toBe('SCUIPRB');
    expect(TI86_ASM_EXEC_RAM + code.length).toBeLessThanOrEqual(TI86_VIDEO_RAM);
    expect(code.length).toBeLessThan(7 * 1024);
    expect(code.includes(Buffer.alloc(1024, 0))).toBe(false);
    expect(code.includes(Buffer.from('Mixed-case reader text\0', 'ascii'))).toBe(true);
  });
});
