import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { ChildProcessContentFilterCli } from './ChildProcessContentFilterCli.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'cf-cli-'));
const fake = path.join(dir, 'fake.mjs');
writeFileSync(fake, `const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'sleep') setTimeout(() => {}, 10000);
else if (cmd === 'lines') { process.stderr.write('a\\nb'); setTimeout(() => { process.stderr.write('c\\n  [1/2] va1 visual refined 1–2\\ntail'); }, 20); }
else { console.log(JSON.stringify({ cmd, a, data: process.env.DAYLIGHT_DATA_DIR })); console.error('err line'); process.exit(cmd === 'fail' ? 3 : 0); }`);

describe('ChildProcessContentFilterCli', () => {
  it('runs niced with the env, returns stdout and logs', async () => {
    const cli = new ChildProcessContentFilterCli({ cliPath: fake, env: { DAYLIGHT_DATA_DIR: '/d' } });
    const logPath = path.join(dir, 'logs', 'r.log');
    const r = await cli.run('audit', ['42', '--json'], { logPath });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ cmd: 'audit', a: ['42', '--json'], data: '/d' });
    expect(readFileSync(logPath, 'utf8')).toContain('err line');
  });
  it('reports a failing exit with the stderr tail', async () => {
    const r = await new ChildProcessContentFilterCli({ cliPath: fake, nice: false }).run('fail', []);
    expect(r.code).toBe(3);
    expect(r.stderrTail).toBe('err line');
  });
  it('kills the child on timeout', async () => {
    const r = await new ChildProcessContentFilterCli({ cliPath: fake, nice: false }).run('sleep', [], { timeoutMs: 300 });
    expect(r.code).toBe(1);
    expect(r.stderrTail).toContain('timed out');
  });
  it('calls onLine once per stderr line, joining lines split across chunks, and flushes the last', async () => {
    const lines = [];
    const r = await new ChildProcessContentFilterCli({ cliPath: fake, nice: false }).run('lines', [], { onLine: (l) => lines.push(l) });
    expect(r.code).toBe(0);
    expect(lines).toEqual(['a', 'bc', '  [1/2] va1 visual refined 1–2', 'tail']);
  });
});
