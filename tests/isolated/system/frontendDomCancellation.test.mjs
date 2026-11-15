import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
it('DOM cancellation handles the internal promise while explicit consumers still receive AbortError', async () => {
  const script = `
    import assert from 'node:assert/strict';
    const { default: environment } = await import('./tests/_infrastructure/frontend-env.mjs');
    const scope = await environment.setup(globalThis);
    const element = document.createElement('div');
    const first = element.animate([{opacity:0},{opacity:1}], {duration:10000});
    let cancelled = false;
    first.oncancel = () => { cancelled = true; };
    first.cancel();
    assert(cancelled);
    assert.equal(first.playState, 'idle');
    const second = element.animate([{opacity:0},{opacity:1}], {duration:10000});
    const observed = second.finished.then(() => 'unexpected success', error => error.name);
    second.cancel();
    assert.equal(await observed, 'AbortError');
    await new Promise(resolve => setImmediate(resolve));
    await scope.teardown(globalThis);
    process.stdout.write('cancellation verified');
  `;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '--eval', script], { cwd: process.cwd(), timeout: 10000 });
  expect(stdout).toBe('cancellation verified');
});
it('DOM teardown drains even when a test has replaced its page timers', async () => {
  const script = `
    const { default: environment } = await import('./tests/_infrastructure/frontend-env.mjs');
    const scope = await environment.setup(globalThis);
    globalThis.setTimeout = () => { throw new Error('page timer must not drive teardown'); };
    await scope.teardown(globalThis);
    process.stdout.write('teardown verified');
  `;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '--eval', script], { cwd: process.cwd(), timeout: 10000 });
  expect(stdout).toBe('teardown verified');
});
