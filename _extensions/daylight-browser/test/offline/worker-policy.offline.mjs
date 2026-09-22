import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { captureInitialPlaybackWindow } from '../../src/operations/libby/bootstrapLoan.mjs';
import { installPageTargetGuards, installPolicy } from '../../src/operations/libby/securityPolicy.mjs';

const webUrl = 'https://dewey-fixture.listen.libbyapp.com/book/';
const tempDirectory = mkdtempSync(join(tmpdir(), 'daylight-browser-worklet-policy-'));
const netLogPath = join(tempDirectory, 'netlog.json');
const removeTempDirectory = () => rmSync(tempDirectory, { recursive: true, force: true });
process.once('exit', removeTempDirectory);
const browser = await chromium.launch({ headless: true, args: [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--no-proxy-server',
  '--enable-blink-features=CSSPaintAPI,CSSLayoutAPI,AnimationWorklet',
  `--log-net-log=${netLogPath}`,
  '--net-log-capture-mode=Everything',
] });
const browserCdp = await browser.newBrowserCDPSession();
const workerTargets = [];
browserCdp.on('Target.targetCreated', ({ targetInfo }) => {
  if (['worker', 'shared_worker', 'service_worker'].includes(targetInfo.type)) workerTargets.push(targetInfo);
});
await browserCdp.send('Target.setDiscoverTargets', { discover: true });

const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
const page = await context.newPage();
const requests = [];
context.on('request', request => requests.push(request.url()));
try {
  // Establish a secure, networkless fixture document so Chromium exposes its
  // secure-context worklet APIs. The production guard itself is used here;
  // installPolicy installs the same script before real provider navigation.
  await context.addInitScript(installPageTargetGuards);
  await context.route(webUrl, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>fixture</p>' }));
  await page.goto(webUrl);
  await context.unroute(webUrl);
  const phaseController = await installPolicy(context, page, webUrl);
  await page.setContent(`
    <button aria-label="Play">Play</button>
    <iframe srcdoc="<p>child</p>"></iframe>
    <script>
      document.querySelector('button').onclick = () => {
        const source = 'fetch("https://foreign.invalid/shared-worker-egress")';
        new SharedWorker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      };
    </script>
  `);

  const realmState = await page.evaluate(() => {
    const iframeWindow = document.querySelector('iframe').contentWindow;
    const check = target => {
      const descriptor = Object.getOwnPropertyDescriptor(target, 'SharedWorker');
      let threw = false;
      try { new target.SharedWorker('blob:escape'); } catch { threw = true; }
      return { threw, configurable: descriptor?.configurable, writable: descriptor?.writable };
    };
    const checkAudio = (target, offline = false) => {
      const context = offline ? new target.OfflineAudioContext(1, 128, 44100) : new target.AudioContext();
      const worklet = context.audioWorklet;
      const descriptor = Object.getOwnPropertyDescriptor(target.BaseAudioContext.prototype, 'audioWorklet');
      let directThrew = false;
      let blobThrew = false;
      try { worklet.addModule('https://direct-audioworklet.invalid/module.js'); } catch { directThrew = true; }
      const source = 'import "https://blob-audioworklet.invalid/import.js"';
      try { worklet.addModule(target.URL.createObjectURL(new target.Blob([source], { type: 'text/javascript' }))); }
      catch { blobThrew = true; }
      if (!offline) void context.close();
      return { directThrew, blobThrew, configurable: descriptor?.configurable,
        addModuleConfigurable: Object.getOwnPropertyDescriptor(worklet, 'addModule')?.configurable };
    };
    const checkPageWorklets = target => {
      const exposed = [];
      for (const [label, container] of [['CSS', target.CSS], ['window', target]]) {
        for (const name of ['paintWorklet', 'layoutWorklet', 'animationWorklet']) {
          if (!container || !(name in container)) continue;
          const loader = container[name];
          const descriptor = Object.getOwnPropertyDescriptor(container, name);
          let directThrew = false;
          let blobThrew = false;
          let getterRecoveryThrew = false;
          let methodRecoveryThrew = false;
          try { loader.addModule(`https://${name.toLowerCase()}-direct.invalid/module.js`); } catch { directThrew = true; }
          const source = `import "https://${name.toLowerCase()}-blob.invalid/import.js"`;
          try { loader.addModule(target.URL.createObjectURL(new target.Blob([source], { type: 'text/javascript' }))); }
          catch { blobThrew = true; }
          try { descriptor.get.call(container).addModule('https://getter-recovery.invalid/module.js'); }
          catch { getterRecoveryThrew = true; }
          const method = Object.getOwnPropertyDescriptor(loader, 'addModule')?.value;
          try { method.call(loader, 'https://method-recovery.invalid/module.js'); } catch { methodRecoveryThrew = true; }
          exposed.push({ surface: `${label}.${name}`, directThrew, blobThrew, getterRecoveryThrew,
            methodRecoveryThrew, configurable: descriptor?.configurable });
        }
      }
      return exposed;
    };
    const audio = new Audio();
    const playResult = audio.play();
    void playResult.catch(() => {});
    const popup = window.open('about:blank', 'guard-probe');
    const popupAudio = popup ? checkAudio(popup) : null;
    const popupWorklets = popup ? checkPageWorklets(popup) : null;
    popup?.close();
    return { top: check(window), child: check(iframeWindow), topAudio: checkAudio(window),
      childAudio: checkAudio(iframeWindow), topOfflineAudio: checkAudio(window, true),
      childOfflineAudio: checkAudio(iframeWindow, true), popupAudio,
      topWorklets: checkPageWorklets(window), childWorklets: checkPageWorklets(iframeWindow), popupWorklets,
      htmlAudio: audio instanceof HTMLAudioElement,
      playType: typeof audio.play, playPromise: typeof playResult?.then === 'function',
      cssSupports: CSS.supports('display', 'block'), fetchType: typeof fetch, xhrType: typeof XMLHttpRequest };
  });
  const expectedPageWorklets = ['paintWorklet', 'layoutWorklet', 'animationWorklet'].map(name => ({
    surface: `CSS.${name}`, directThrew: true, blobThrew: true,
    getterRecoveryThrew: true, methodRecoveryThrew: true, configurable: false,
  }));
  assert.deepEqual(realmState, {
    top: { threw: true, configurable: false, writable: false },
    child: { threw: true, configurable: false, writable: false },
    topAudio: { directThrew: true, blobThrew: true, configurable: false, addModuleConfigurable: false },
    childAudio: { directThrew: true, blobThrew: true, configurable: false, addModuleConfigurable: false },
    topOfflineAudio: { directThrew: true, blobThrew: true, configurable: false, addModuleConfigurable: false },
    childOfflineAudio: { directThrew: true, blobThrew: true, configurable: false, addModuleConfigurable: false },
    popupAudio: { directThrew: true, blobThrew: true, configurable: false, addModuleConfigurable: false },
    topWorklets: expectedPageWorklets, childWorklets: expectedPageWorklets, popupWorklets: expectedPageWorklets,
    htmlAudio: true, playType: 'function', playPromise: true,
    cssSupports: true, fetchType: 'function', xhrType: 'function',
  });

  await assert.rejects(captureInitialPlaybackWindow(page, context, [{
    key: 'one', index: 0, contentLength: 1, upstreamUrl: `${webUrl}part.mp3`, headers: {},
  }], webUrl, { phaseController, timeoutMs: 250, observationMs: 50 }), { code: 'BROWSER_TIMEOUT' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(workerTargets, []);
  assert.equal(requests.some(url => url.includes('foreign.invalid')), false);
} finally {
  await context.close();
  await browserCdp.detach();
  await browser.close();
}
const netLog = readFileSync(netLogPath, 'utf8');
assert.equal(netLog.includes('direct-audioworklet.invalid'), false);
assert.equal(netLog.includes('blob-audioworklet.invalid'), false);
for (const host of ['paintworklet-direct.invalid', 'paintworklet-blob.invalid',
  'layoutworklet-direct.invalid', 'layoutworklet-blob.invalid',
  'animationworklet-direct.invalid', 'animationworklet-blob.invalid',
  'getter-recovery.invalid', 'method-recovery.invalid']) assert.equal(netLog.includes(host), false);
removeTempDirectory();
process.off('exit', removeTempDirectory);
