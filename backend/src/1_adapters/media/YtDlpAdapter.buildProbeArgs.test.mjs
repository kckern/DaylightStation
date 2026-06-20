import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProbeArgs } from './YtDlpAdapter.mjs';

test('url is the LAST element, passed verbatim (no shell concatenation)', () => {
  const url = 'https://x/$(touch /tmp/PWNED)';
  const argv = buildProbeArgs(url, {});
  assert.equal(argv[argv.length - 1], url);
  // The malicious URL must appear exactly once, as a discrete argv element,
  // never spliced into another element (which would let a shell parse it).
  assert.equal(argv.filter((a) => a === url).length, 1);
});

test('preserves the fixed probe flags before the url', () => {
  const argv = buildProbeArgs('https://example.com/v', {});
  assert.deepEqual(argv, [
    '--js-runtimes', 'node',
    '-J',
    '--no-warnings',
    '--no-playlist',
    'https://example.com/v'
  ]);
});

test('appends opts.args as discrete elements before the url', () => {
  const argv = buildProbeArgs('https://example.com/v', { args: ['--extractor-args', 'generic:x'] });
  assert.deepEqual(argv.slice(-3), ['--extractor-args', 'generic:x', 'https://example.com/v']);
});

test('ignores non-array opts.args', () => {
  const argv = buildProbeArgs('https://example.com/v', { args: 'rm -rf /' });
  assert.equal(argv[argv.length - 1], 'https://example.com/v');
  assert.ok(!argv.includes('rm -rf /'));
});
