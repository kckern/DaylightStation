// @vitest-environment node
/**
 * Jev crops from a real OSMD engraving in Chromium: cropPlan + renderCrops for a
 * barline inside a system and one at a system break. jsdom has no canvas and
 * cannot lay OSMD out, so the unit tests stop at the plan; this one checks the
 * pictures Jev would see: size inside its 280-1568 px limits, ink on them, two
 * strips at the break, and the red marker over the right barline.
 *
 * Set JEV_CROPS_DIR to keep the PNGs for a look.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const FIXTURE = path.join(ROOT, '__capabilities/music-notation/browser/__fixtures__/maryHadALittleLamb.musicxml');
const xml = fs.readFileSync(FIXTURE, 'utf8');
const OUT_DIR = process.env.JEV_CROPS_DIR || null;

const LOGGER_STUB = "const L={};for(const level of ['info','warn','error','debug','sampled'])L[level]=()=>{};L.child=()=>L;export default ()=>L;export const getLogger=()=>L;";

let browser;
let js;

beforeAll(async () => {
  const esbuild = require('esbuild');
  const bundle = await esbuild.build({
    stdin: {
      contents: `
        import { osmdRender, buildMeasures, extractMeasureBounds } from '../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js';
        import { cropPlan, cropCanvasSize, renderCrops } from './jevCrops.js';

        const blobToBase64 = (blob) => new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(blob);
        });
        const decode = (blob) => new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(blob);
        });

        /** Red marker pixels and dark ink in a PNG: counts and the marker's mean x. */
        async function inspect(blob) {
          const img = await decode(blob);
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let red = 0; let redX = 0; let redMaxY = 0; let ink = 0;
          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            const x = (i / 4) % canvas.width;
            const y = Math.floor(i / 4 / canvas.width);
            if (r > 200 && g < 90 && b < 90) { red += 1; redX += x; redMaxY = Math.max(redMaxY, y); }
            else if (r < 100 && g < 100 && b < 100) ink += 1;
          }
          return { width: canvas.width, height: canvas.height, red, redX: red ? redX / red : null, redMaxY, ink };
        }

        window.__crops = async (xml, width) => {
          const host = document.getElementById('host');
          const result = await osmdRender(host, xml, { flow: 'wrapped', scale: 0.8, width });
          const measures = buildMeasures(result.steps);
          const bounds = extractMeasureBounds(result.osmd);
          const box = (k) => bounds[measures[k].index];
          // Two bars share a system when their staff boxes overlap vertically.
          const sameSystem = (a, b) => box(a).top < box(b).bottom && box(b).top < box(a).bottom;
          let systems = 1;
          let mid = null; let brk = null;
          for (let k = 0; k < measures.length - 1; k += 1) {
            const same = sameSystem(k, k + 1);
            if (!same) systems += 1;
            if (same && mid == null && k > 0) mid = k;
            if (!same && brk == null) brk = k;
          }
          const plans = new Map([[mid, cropPlan(measures, bounds, mid)], [brk, cropPlan(measures, bounds, brk)]]);
          const pngs = await renderCrops(host.querySelector('svg'), plans);
          const out = {};
          for (const [k, plan] of plans) {
            const size = cropCanvasSize(plan.width, plan.height);
            out[k] = {
              plan,
              expectedMarkerX: size.offsetX + plan.marker.x * size.scale,
              expectedMarkerY: size.offsetY + plan.marker.y * size.scale,
              png: await blobToBase64(pngs.get(k)),
              seen: await inspect(pngs.get(k)),
            };
          }
          return { systems, measures: measures.length, mid, brk, out };
        };`,
      resolveDir: HERE,
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [{
      name: 'stub-logger',
      setup(build) {
        build.onLoad({ filter: /lib\/logging\/Logger\.js$/ }, () => ({ contents: LOGGER_STUB, loader: 'js' }));
        // The page has no API; jevCrops only needs buildHeaders for the request it is not making here.
        build.onLoad({ filter: /frontend\/src\/lib\/api\.mjs$/ }, () => ({ contents: 'export const buildHeaders = () => ({});', loader: 'js' }));
      },
    }],
  });
  js = bundle.outputFiles[0].text;
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
}, 180000);

afterAll(async () => { await browser?.close(); });

const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

describe('Jev crops from a real OSMD engraving (Chromium)', () => {
  it('stay in Jev\'s size range, show ink, split at a system break and mark the right barline', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
    await page.addScriptTag({ content: js });
    const result = await page.evaluate(([x]) => window.__crops(x, 420), [xml]);
    expect(errors).toEqual([]);
    expect(result.systems).toBeGreaterThanOrEqual(3);
    expect(result.mid).not.toBeNull();
    expect(result.brk).not.toBeNull();

    for (const [label, k, strips] of [['mid-system', result.mid, 1], ['system-break', result.brk, 2]]) {
      const crop = result.out[k];
      const buf = Buffer.from(crop.png, 'base64');
      if (OUT_DIR) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, `${label}-after-bar-${k}.png`), buf);
      }
      const { width, height } = pngSize(buf);
      expect(Math.min(width, height), label).toBeGreaterThanOrEqual(280);
      expect(Math.max(width, height), label).toBeLessThanOrEqual(1568);
      expect(crop.plan.strips, label).toHaveLength(strips);
      expect(crop.seen.ink, `${label}: ink`).toBeGreaterThan(500);
      // The marker is drawn where the plan says, above the staff's top line.
      expect(crop.seen.red, `${label}: marker pixels`).toBeGreaterThan(40);
      expect(Math.abs(crop.seen.redX - crop.expectedMarkerX), `${label}: marker x`).toBeLessThan(3);
      expect(crop.seen.redMaxY, `${label}: marker sits above the staff`).toBeLessThanOrEqual(crop.expectedMarkerY);
    }
    await page.close();
  }, 90000);
});
