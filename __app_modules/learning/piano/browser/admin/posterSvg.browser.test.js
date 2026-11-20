// @vitest-environment node
/**
 * A real OSMD engraving in Chromium through posterSvg → checkSvg, then drawn as
 * an image the way the kiosk shows a poster. jsdom cannot lay OSMD out, so the
 * unit tests use synthetic SVG; this one checks that what VexFlow really emits
 * (attribute order, font lists, escaping) survives the serializer and passes the
 * server's checker, and that the poster renders quickly.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkSvg } from '../../portable/music/svgSafety.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const FIXTURE = path.join(ROOT, '__capabilities/music-notation/browser/__fixtures__/maryHadALittleLamb.musicxml');

// Lyrics with the characters XMLSerializer escapes, and a quoted font list.
const xml = fs.readFileSync(FIXTURE, 'utf8')
  .replace(/<text>[^<]*<\/text>/, '<text>"Ma&amp;ry" &lt;3</text>')
  .replace('<part-list>', '<defaults><lyric-font font-family="&quot;Times New Roman&quot;, serif" font-size="10"/></defaults><part-list>');

const LOGGER_STUB = "const L={};for(const level of ['info','warn','error','debug','sampled'])L[level]=()=>{};L.child=()=>L;export default ()=>L;export const getLogger=()=>L;";

let browser;
let js;

beforeAll(async () => {
  const esbuild = require('esbuild');
  const bundle = await esbuild.build({
    stdin: {
      contents: `
        import { osmdEngrave, extractPerStaffGeometry } from '../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js';
        import { posterCrop, posterSvg } from './posterSvg.js';
        import { checkSvg } from '../../portable/music/svgSafety.mjs';
        window.__poster = async (xml, width) => {
          const host = document.getElementById('host');
          const engraved = await osmdEngrave(host, xml, { flow: 'wrapped', scale: 0.8, width });
          const boxes = extractPerStaffGeometry(engraved.osmd);
          const crop = posterCrop(boxes);
          // A quoted, line-broken font list, as a font fallback chain can come out; Chromium's
          // XMLSerializer would write it with &quot; and &#10;, which the checker refuses.
          host.querySelector('svg text').setAttribute('font-family', '"Times New Roman",\\nserif');
          const poster = posterSvg(host.querySelector('svg'), crop);
          const raw = new XMLSerializer().serializeToString(host.querySelector('svg'));
          const elements = [...new Set([...host.querySelectorAll('svg *')].map((el) => el.localName))].sort();
          return { text: poster.text, bytes: poster.bytes, crop, systems: new Set(boxes.map((b) => b.system)).size,
            check: checkSvg(poster.text), elements, rawHasUse: raw.includes('<use') };
        };
        window.__draw = (text) => new Promise((resolve) => {
          const img = new Image();
          const t0 = performance.now();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            resolve({ ok: true, ms: performance.now() - t0, width: img.naturalWidth, height: img.naturalHeight });
          };
          img.onerror = () => resolve({ ok: false });
          img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
        });`,
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
      },
    }],
  });
  js = bundle.outputFiles[0].text;
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
}, 180000);

afterAll(async () => { await browser?.close(); });

describe('posterSvg on a real OSMD engraving (Chromium)', () => {
  it('passes checkSvg, keeps two systems, and draws as an image', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
    await page.addScriptTag({ content: js });
    const result = await page.evaluate(([x]) => window.__poster(x, 420), [xml]);
    expect(errors).toEqual([]);
    // What VexFlow draws with: no <use>, nothing off the allow-list beyond what the serializer drops.
    expect(result.rawHasUse).toBe(false);
    expect(result.elements.filter((name) => !['g', 'path', 'rect', 'text', 'tspan'].includes(name))).toEqual([]);
    expect(result.systems).toBeGreaterThan(2);
    expect(result.crop.bottom).toBeGreaterThan(0);
    expect(result.check).toEqual({ ok: true });
    expect(checkSvg(result.text)).toEqual({ ok: true }); // the server's copy agrees
    expect(result.text).toContain('data-daylight-poster="generated"');
    expect(result.text).toContain('font-family="Times New Roman, serif"');
    expect(result.text).toContain('>"Ma&amp;ry" &lt;3</text>'); // lyric text keeps its characters
    expect(result.bytes).toBeLessThan(300 * 1024);

    const drawn = await page.evaluate((t) => window.__draw(t), result.text);
    expect(drawn.ok).toBe(true);
    expect(drawn.ms).toBeLessThan(2000);
    await page.close();
  }, 60000);
});
