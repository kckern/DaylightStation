import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { compile } from 'sass';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../../../../frontend/', import.meta.url));
const bundle = (await build({
  stdin: { resolveDir: frontend, loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import ExerciseNotation from './src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseNotation.jsx';
    const root = createRoot(document.getElementById('root'));
    const instance = {key:'C',meter:'4/4',ordering:'strict',events:[60,62,64,65].map(midi=>({notes:[{midi,hand:'right'}]}))};
    window.paintNotation = (held=[], eventIndex=1, alternate=false) => root.render(<ExerciseNotation
      instance={alternate ? { ...instance, events:[{notes:[{midi:60,hand:'right'}]},{notes:[{midi:48,hand:'left'}]},{notes:[{midi:62}]},{notes:[{midi:50}]}] } : instance}
      eventIndex={eventIndex} activeNotes={new Map(held.map(midi=>[midi,{}]))} />);
    window.paintNotation();
  ` },
  bundle: true, write: false, jsx: 'automatic',
  plugins: [{ name: 'omit-style-imports', setup(b) { b.onLoad({ filter: /\.(s?css)$/ }, () => ({ contents: '', loader: 'js' })); } }],
})).outputFiles[0].text;
const css = compile(`${frontend}/src/modules/Piano/PianoKiosk/modes/Exercises/Exercises.scss`).css;

test('engraved exercise retains the historical cursor and held-note feedback', async ({ page }) => {
  await page.setContent(`<style>${css} #root {width:1000px;height:400px;background:#f5f0e8}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle });
  const cursor = page.locator('.exercise-notation__cursor');
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveCSS('fill', 'rgba(255, 200, 60, 0.3)');
  await expect(cursor).toHaveCSS('stroke', 'rgba(200, 150, 0, 0.5)');
  const groups = page.locator('.abcjs-note');
  await expect(groups.nth(0)).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await expect(groups.nth(1)).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await expect(groups.nth(1).locator('.abcjs-notehead')).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await expect(groups.nth(2)).toHaveCSS('fill', 'rgb(120, 66, 22)');
  const boxes = await page.evaluate(() => {
    const rect = s => { const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom}; };
    return { cursor:rect('.exercise-notation__cursor'), note:rect('.abcjs-note.exercise-note-next .abcjs-notehead') };
  });
  expect(boxes.cursor.x).toBeLessThan(boxes.note.x);
  expect(boxes.cursor.right).toBeGreaterThan(boxes.note.right);
  expect(boxes.cursor.y).toBeLessThan(boxes.note.y);
  expect(boxes.cursor.bottom).toBeGreaterThan(boxes.note.bottom);
  await page.screenshot({ path: '/tmp/exercise-notation-restored-cursor.png' });
  await page.evaluate(() => window.paintNotation([62]));
  await expect(groups.nth(1)).toHaveCSS('fill', 'rgb(0, 150, 70)');
  await page.evaluate(() => window.paintNotation([63]));
  await expect(groups.nth(1)).toHaveCSS('fill', 'rgb(200, 40, 40)');
  await expect(page.locator('.exercise-notation__ghost [data-midi="63"]')).toBeVisible();
  await expect(page.locator('.exercise-notation__ghost ellipse')).toHaveCSS('fill', 'rgba(0, 0, 0, 0.45)');
  await page.screenshot({ path: '/tmp/exercise-notation-wrong-note.png' });
  await page.evaluate(() => window.paintNotation([]));
  await expect(page.locator('.exercise-notation__ghost')).toHaveCount(0);
  await expect(groups.nth(1)).toHaveCSS('fill', 'rgb(0, 0, 0)');
});

test('alternating hands and handless notes follow source events across ABC rests', async ({ page }) => {
  await page.setContent(`<style>${css} #root {width:1000px;height:600px;background:#f5f0e8}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.paintNotation([48], 1, true));
  await expect(page.locator('.abcjs-note.abcjs-v1').nth(0)).toHaveCSS('fill', 'rgb(0, 150, 70)');
  await expect(page.locator('.abcjs-note.abcjs-v0').nth(1)).toHaveCSS('fill', 'rgb(120, 66, 22)');
  await expect(page.locator('.exercise-notation__cursor')).toHaveCount(1);
  await page.evaluate(() => window.paintNotation([62], 2, true));
  await expect(page.locator('.abcjs-note.abcjs-v0').nth(1)).toHaveCSS('fill', 'rgb(0, 150, 70)');
  await expect(page.locator('.abcjs-note.abcjs-v1').nth(0)).toHaveCSS('fill', 'rgb(0, 0, 0)');
  await page.evaluate(() => window.paintNotation([50], 3, true));
  await expect(page.locator('.abcjs-note.abcjs-v1').nth(1)).toHaveCSS('fill', 'rgb(0, 150, 70)');
  await expect(page.locator('.exercise-notation__cursor')).toHaveCount(1);
});
