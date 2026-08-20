import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => { const t = m.text(); if (/lyric|libretto|rail\.density/.test(t)) console.log('CONSOLE:', t.slice(0, 160)); });
await p.goto('http://localhost:3111/play/plex:6918', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(12000);
// Seek into a texted number: "Comfort ye" starts ~25s in Part One.
await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.currentTime = 60; v.play?.(); } });
await p.waitForTimeout(8000);
await p.screenshot({ path: '/tmp/lyric.png' });
const q = async (sel) => p.locator(sel).count();
console.log('lyric rail:', await q('[data-testid="surround-lyric-rail"]'));
console.log('programme rail:', await q('[data-testid="surround-rail"]'));
console.log('heading:', (await p.textContent('[data-testid="surround-libretto-heading"]').catch(() => null)));
const box = await p.locator('[data-testid="surround-libretto-text"]').first();
if (await box.count()) {
  const bb = await box.boundingBox();
  console.log('text box height:', bb && Math.round(bb.height), 'width:', bb && Math.round(bb.width));
  console.log('text:', ((await box.textContent()) || '').replace(/\s+/g, ' ').slice(0, 110));
} else console.log('text box: ABSENT');
console.log('rail segments drawn:', await q('.surround-segment-map [class*="segment"]'));
await b.close();
