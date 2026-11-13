// Proves the harness makes no sound: plays a few seconds of a round in a muted
// browser and reports how many audio contexts and <audio> plays the page made.
//   BASE_URL=http://127.0.0.1:5196 node tests/_scratch/skyline-invaders-harness/check-muted.mjs
import { firefox } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5196';
const browser = await firefox.launch({ firefoxUserPrefs: { 'media.volume_scale': '0.0' } });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  window.__audio = { contexts: 0, plays: 0 };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Real = window[name];
    if (Real) window[name] = function Counted(...args) { window.__audio.contexts += 1; return new Real(...args); };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function counted(...args) { window.__audio.plays += 1; return play.apply(this, args); };
});
await page.clock.install();
await page.goto(`${BASE}/shell.html?pose=camera-denied`);
await page.waitForSelector('[data-phase="lobby"]', { timeout: 30000 });
await page.clock.pauseAt(new Date(Date.now() + 2000));
await page.getByRole('button', { name: /^Start/ }).first().click();
await page.clock.runFor(3200);
await page.waitForSelector('[data-phase="playing"]');
for (let i = 0; i < 4; i += 1) { await page.keyboard.press('Space'); await page.clock.runFor(1000); }
const report = await page.evaluate(() => ({ ...window.__audio, stubCues: window.__si.cues.length }));
await browser.close();
console.log(JSON.stringify(report));
process.exitCode = report.contexts === 0 && report.plays === 0 && report.stubCues > 0 ? 0 : 1;
