#!/usr/bin/env node
/**
 * Isolated real-component/browser geometry and mat interaction checks.
 * No backend or hardware connection: all context data is synthetic and every
 * network request is confined to this ephemeral loopback fixture server.
 * Run: node tests/_infrastructure/harnesses/fitness-mat-hearts.mjs [chromium|firefox]
 * Requires the selected Playwright browser to be installed.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendRequire = createRequire(join(repo, 'frontend/package.json'));
const sass = frontendRequire('sass-embedded');
const engine = process.argv[2] || 'chromium';
assert.ok(['chromium', 'firefox'].includes(engine), 'Select chromium or firefox');

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './frontend/src/Apps/FitnessApp.scss';
import FitnessUsersList from './frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx';
import { FixtureContext } from './frontend/src/context/FitnessContext.jsx';
import { STRAP_COLORS } from './shared/contracts/fitness/strapColors.mjs';
const root = createRoot(document.getElementById('root'));
window.renderFixture = ({ count = 3, width = 345, color = 'red', inactive = false, mat = false, zoom = 1 }) => {
  const devices = Array.from({ length: count }, (_, i) => ({
    id: 'user_' + i, profileId: 'user_' + i, deviceId: String(101 + i), type: 'heart_rate', heartRate: 123 + i,
    name: 'Long Participant Name ' + i, isActive: !inactive, lastSeen: Date.now()
  }));
  const context = {
    connected: true, fitnessDevices: new Map(devices.map(d => [d.deviceId, d])), allDevices: devices,
    activeHeartRateParticipants: devices, rpmDevices: [], equipmentDevices: [],
    deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
    hrColorMap: Object.fromEntries(devices.map(d => [d.deviceId, color])), zones: [], zoneProfiles: [],
    deviceAssignments: [], zoneProgressIndex: new Map(), userCollections: { all: [] }, deviceOwnership: {},
    pressureMatActivities: mat ? { mat: { equipmentId: 'mat', matId: 'mat', online: !inactive,
      active: !inactive, engaged: true, seenThisSession: true, sessionSteps: 41, sessionStomps: 8,
      stepsPerMinute: inactive ? 0 : 4, lastSeenAt: Date.now() } } : {},
    getDisplayName: id => ({ displayName: 'Long Participant Name ' + id, source: 'fixture' }),
    fitnessSessionInstance: { getEquipmentUser: () => null },
  };
  flushSync(() => root.render(<MantineProvider><FixtureContext.Provider value={context}>
    <div style={{ width, height: 750, zoom, background: '#080808' }}>
      <div className="fitness-sidebar-container"><div className="fitness-sidebar-devices">
        <FitnessUsersList />
      </div></div>
    </div>
  </FixtureContext.Provider></MantineProvider>));
};
window.strapColors = Object.keys(STRAP_COLORS);
window.renderFixture({});
`;

const bundle = await build({
  stdin: { contents: entry, loader: 'jsx', resolveDir: repo, sourcefile: 'fitness-fixture.jsx' },
  bundle: true, write: false, outdir: '/fixture', format: 'iife',
  nodePaths: [join(repo, 'frontend/node_modules')],
  alias: { '@': join(repo, 'frontend/src'), react: join(repo, 'frontend/node_modules/react'), 'react-dom': join(repo, 'frontend/node_modules/react-dom') },
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.MODE': '"test"' },
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
  logLevel: 'silent',
  plugins: [{ name: 'isolated-fitness', setup(builder) {
    builder.onResolve({ filter: /FitnessContext\.jsx$/ }, () => ({ path: 'fixture-context', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: "import React from 'react'; export const FixtureContext = React.createContext({}); export const useFitnessContext = () => React.useContext(FixtureContext);",
      resolveDir: join(repo, 'frontend'),
    }));
    builder.onResolve({ filter: /logging\/Logger\.js$/ }, () => ({ path: 'fixture-logger', namespace: 'logger' }));
    builder.onLoad({ filter: /.*/, namespace: 'logger' }, () => ({ contents:
      'const noop = () => {}; const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop }; export default () => logger; export const getLogger = () => logger;' }));
    builder.onLoad({ filter: /\.scss$/ }, async ({ path }) => ({
      contents: (await sass.compileAsync(path, { logger: sass.Logger.silent, loadPaths: [join(repo, 'frontend/node_modules')] })).css,
      loader: 'css', resolveDir: dirname(path),
    }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(js); }
  else if (req.url === '/bundle.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body style="margin:0;background:#111"><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  else { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#444"/></svg>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await ({ chromium, firefox })[engine].launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1.25, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.renderFixture === 'function');
  const colors = await page.evaluate(() => window.strapColors);
  let checked = 0;
  for (const count of [1, 2, 3, 4, 6]) {
    for (const width of [250, 345, 420]) {
      for (const color of colors) {
        const inactive = checked % 2 === 1;
        await page.evaluate(options => window.renderFixture(options), { count, width, color, inactive, mat: true, zoom: checked % 3 === 0 ? 1.25 : 1 });
        await page.waitForFunction(n => document.querySelectorAll('.fitness-heart-icon svg').length === n, count);
        // Let layout effects and FlipMove complete before measuring final geometry.
        await page.waitForFunction(() => [...document.querySelectorAll('.device-wrapper')].every(el => !el.style.transform && (!el.style.opacity || el.style.opacity === '1')));
        const failures = await page.evaluate(() => {
          const failures = [];
          const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
          document.querySelectorAll('.fitness-heart-icon svg').forEach(svg => {
            const rect = svg.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0)) failures.push('SVG has no visible dimensions');
            // Compare painted geometry in the SAME viewport coordinate space.
            // getBBox() includes ancestor CSS zoom in Firefox, unlike Chromium,
            // so comparing that directly with an unzoomed viewBox is misleading.
            svg.querySelectorAll('path').forEach(path => {
              if (getComputedStyle(path).fill !== 'none' && !inside(path.getBoundingClientRect(), rect)) failures.push({ kind: 'heart ink outside SVG', ink: path.getBoundingClientRect().toJSON(), rect: rect.toJSON() });
            });
            for (let ancestor = svg.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
              const style = getComputedStyle(ancestor);
              if (ancestor.matches('.device-icon, .fitness-device') || /(hidden|clip|auto|scroll)/.test(style.overflow)) {
                if (!inside(rect, ancestor.getBoundingClientRect())) failures.push('heart outside ' + ancestor.className);
              }
            }
            const card = svg.closest('.fitness-device');
            if (!inside(card.querySelector('.device-value').getBoundingClientRect(), card.getBoundingClientRect())) failures.push('BPM outside card');
          });
          return failures;
        });
        assert.deepEqual(failures, [], JSON.stringify({ engine, count, width, color, inactive, failures }));
        checked++;
      }
    }
  }
  // Actual FlipMove insertion after hearts exist, no click required.
  await page.evaluate(() => window.renderFixture({ count: 3, mat: false }));
  await page.getByRole('button', { name: /step mat:/i }).waitFor({ state: 'detached' });
  await page.evaluate(() => window.renderFixture({ count: 3, mat: true }));
  const mat = page.getByRole('button', { name: /step mat:.*41 steps, 8 stomps/i });
  await mat.waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  await mat.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await mat.evaluate(el => el === document.activeElement), true);
  await page.waitForFunction(() => [...document.querySelectorAll('.step-mat-list-item, .device-wrapper')].every(el => getComputedStyle(el).opacity === '1' && !el.style.transform));
  await page.screenshot({ path: `/tmp/fitness-mat-hearts-${engine}.png` });
  assert.deepEqual(errors, [], 'Browser errors/ref warnings');
  process.stdout.write(JSON.stringify({ engine, checked, dynamicInsertion: true, keyboard: true, errors }) + '\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
