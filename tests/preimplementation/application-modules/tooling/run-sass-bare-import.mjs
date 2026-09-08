/** Disposable control for the one nonstandard bare Sass sibling import. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { root } from './census.mjs';

if (!process.env.PRE_TOOLCHAIN_ROOT) throw new Error('Explicit toolchain root required');
const require = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'frontend/package.json'));
const sass = require('sass-embedded');
const source = path.join(root, 'frontend/src/modules/Fitness/widgets/CycleGame');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-sass-bare-import-'));
try {
  for (const name of ['CycleSpeedometer.scss', '_cgTokens.scss']) fs.copyFileSync(path.join(source, name), path.join(temp, name));
  const entry = path.join(temp, 'CycleSpeedometer.scss');
  const baseline = sass.compile(entry);
  assert.match(baseline.css, /cycle-speedometer/);
  fs.renameSync(path.join(temp, '_cgTokens.scss'), path.join(temp, '_cgTokens.moved'));
  assert.throws(() => sass.compile(entry), /Can't find stylesheet to import/);
  fs.renameSync(path.join(temp, '_cgTokens.moved'), path.join(temp, '_cgTokens.scss'));
  const restored = sass.compile(entry);
  assert.equal(restored.css, baseline.css);
  process.stdout.write(JSON.stringify({ passed: true, control: 'SASS-BARE-SIBLING', compiler: sass.info }) + '\n');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
