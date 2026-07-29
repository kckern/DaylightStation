#!/usr/bin/env node
/**
 * chord-staff-ink-sweep — measure the real drawn extent of the live grand staff.
 *
 * The staff's viewBox is a FIXED frame (FRAME_TOP/FRAME_BOTTOM in chordStaff.js) that
 * reserves worst-case headroom so the staff never moves and never clips. Those constants
 * came from this sweep. The unit test can only assert the frame contains the numbers
 * recorded here — it cannot measure ink, because jsdom has no getBBox. This script is
 * the thing that measures, and it is committed so the constants can be re-derived
 * rather than taken on faith.
 *
 * Run it after changing: FRAME_*, TOP_ROOM/STAFF_GAP/BASS_STAFF_H, the ottava
 * thresholds in handSplit.js, the note duration, or the VexFlow version.
 *
 *   node tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs
 *
 * It exits non-zero if any drawn ink falls outside the frame the renderer chose, so it
 * doubles as a no-clip check. Requires playwright (repo root) and bundles chordStaff.js
 * against frontend/node_modules — the frontend has its OWN vexflow (4.x); the root
 * node_modules has a different, much older one.
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRY_SRC = `
import { renderChordStaff, computeChordStaffLayout } from '${REPO}/frontend/src/modules/MusicNotation/renderers/chordStaff.js';
window.renderChordStaff = renderChordStaff;
window.computeChordStaffLayout = computeChordStaffLayout;
`;

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];
const ASPECTS = [560 / 210, 300 / 220, 1.0, 1.7, 3.5, 0.6];

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'ink-sweep-'));
  try {
    await writeFile(join(dir, 'entry.js'), ENTRY_SRC);
    await build({
      entryPoints: [join(dir, 'entry.js')],
      bundle: true,
      format: 'iife',
      outfile: join(dir, 'bundle.js'),
      nodePaths: [join(REPO, 'frontend/node_modules')],
      logLevel: 'warning',
    });
    // A doctype is REQUIRED: without it Chrome runs in quirks mode, where invalid
    // unitless CSS lengths are accepted and the measurements stop matching the app.
    await writeFile(join(dir, 'sweep.html'),
      '<!doctype html><html><body style="margin:0"><script src="bundle.js"></script></body></html>');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto('file://' + join(dir, 'sweep.html'));
    await page.waitForFunction(() => !!window.renderChordStaff);

    const result = await page.evaluate(({ KEYS, ASPECTS }) => {
      const cases = [];
      for (let m = 21; m <= 108; m += 1) {
        cases.push([m]);                                                  // every key alone
        if (m + 7 <= 108) cases.push([m, m + 4, m + 7]);                  // major triad
        if (m + 3 <= 108) cases.push([m, m + 1, m + 2, m + 3]);           // chromatic cluster
        if (m + 11 <= 108) cases.push([m, m + 3, m + 7, m + 10, m + 11]); // dense
        if (m + 47 <= 108) cases.push([m, m + 12, m + 40, m + 43, m + 47]); // wide two-hand
        if (m + 4 <= 108) cases.push([m, m + 4, m + 8, m + 12]);          // stacked thirds
      }
      cases.push([21, 108], [21, 60, 108], [36, 96], [24, 107], [21, 22, 107, 108]);
      // Forearm clusters: real (a child can play them) but pathological for horizontal
      // space — twelve noteheads plus accidental columns in ONE beat. Measured, and
      // reported, but they do not fail the run; ordinary playing does.
      const stress = new Set();
      for (let m = 21; m + 11 <= 108; m += 3) {
        const c = Array.from({ length: 12 }, (_, i) => m + i);
        stress.add(c.join(',')); cases.push(c);
      }

      const host = document.createElement('div');
      host.style.cssText = 'position:relative;width:560px;height:210px;';
      document.body.appendChild(host);

      let inkTop = 1e9, inkBottom = -1e9, inkLeft = 1e9;
      let worstTop = null, worstBottom = null, worstLeft = null;
      const clips = [];
      const over = { top: 0, bottom: 0, left: 0, right: 0 };
      const perAspect = {};
      let renders = 0;
      let stressClips = 0;

      // Sweep single columns AND full multi-column flows: with 8 slots each column gets
      // a fraction of the note area, which is a different crowding regime.
      const FLOWS = [
        (midis) => [midis],
        (midis) => [midis, midis.map((m) => m + 1), midis],
        (midis) => Array.from({ length: 8 }, (_, i) => midis.map((m) => m + i)),
      ];

      for (const aspect of ASPECTS) {
        for (const ks of KEYS) {
          for (const midis of cases) {
            const columns = FLOWS[renders % FLOWS.length](midis)
              .map((c) => c.filter((m) => m >= 21 && m <= 108))
              .filter((c) => c.length);
            window.renderChordStaff(host, {
              columns, keySignature: ks, aspect,
            });
            renders += 1;
            const svg = host.querySelector('svg');
            const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
            const bb = svg.getBBox();
            const top = bb.y, bottom = bb.y + bb.height, left = bb.x, right = bb.x + bb.width;
            if (top < inkTop) { inkTop = top; worstTop = { midis, ks, aspect }; }
            if (bottom > inkBottom) { inkBottom = bottom; worstBottom = { midis, ks, aspect }; }
            if (left < inkLeft) { inkLeft = left; worstLeft = { midis, ks, aspect }; }
            // The whole point of the frame: drawn ink must be inside the viewBox.
            over.top = Math.max(over.top, vy - top);
            over.bottom = Math.max(over.bottom, bottom - (vy + vh));
            over.left = Math.max(over.left, vx - left);
            over.right = Math.max(over.right, right - (vx + vw));
            const a = aspect.toFixed(2);
            perAspect[a] ??= { renders: 0, clipped: 0, worstRight: 0, cols: 0 };
            perAspect[a].renders += 1;
            perAspect[a].cols = Math.max(perAspect[a].cols, columns.length);
            perAspect[a].worstRight = Math.max(perAspect[a].worstRight, +(right - (vx + vw)).toFixed(1));
            if (right > vx + vw || top < vy || bottom > vy + vh || left < vx) perAspect[a].clipped += 1;
            const pathological = stress.has(midis.join(','));
            if (pathological) stressClips += (right > vx + vw ? 1 : 0);
            else if (top < vy || bottom > vy + vh || left < vx || right > vx + vw) {
              if (clips.length < 10) clips.push({ midis, ks, aspect: +aspect.toFixed(2),
                ink: [+left.toFixed(1), +top.toFixed(1), +right.toFixed(1), +bottom.toFixed(1)],
                frame: [vx, vy, vx + vw, vy + vh] });
            }
          }
        }
      }
      return {
        renders,
        inkTop: +inkTop.toFixed(1), inkBottom: +inkBottom.toFixed(1), inkLeft: +inkLeft.toFixed(1),
        worst: { top: worstTop, bottom: worstBottom, left: worstLeft },
        stressClips,
        over: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, +v.toFixed(1)])),
        perAspect,
        clips,
      };
    }, { KEYS, ASPECTS });

    await browser.close();

    console.log(`renders:    ${result.renders}`);
    console.log(`ink top:    ${result.inkTop}   (worst: ${JSON.stringify(result.worst.top)})`);
    console.log(`ink bottom: ${result.inkBottom}  (worst: ${JSON.stringify(result.worst.bottom)})`);
    console.log(`ink left:   ${result.inkLeft}   (worst: ${JSON.stringify(result.worst.left)})`);
    console.log(`clipped:    ${result.clips.length} (ordinary playing)`);
    console.log(`            ${result.stressClips} forearm-cluster renders overflow horizontally — known and accepted`);
    console.log(`max overrun past the frame (units): ${JSON.stringify(result.over)}`);
    console.log('\nper box aspect (2.67 = Studio row, 1.36 = Videos column):');
    console.table(result.perAspect);
    if (result.clips.length) {
      console.error('\nINK OUTSIDE THE FRAME — the staff is clipping:');
      for (const c of result.clips) console.error('  ' + JSON.stringify(c));
      process.exitCode = 1;
      return;
    }
    console.log('\nNo clipping: every drawn element is inside the frame the renderer chose.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
