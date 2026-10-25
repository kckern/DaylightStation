import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const origin = 'https://emulator-native.example.test';
const families = [
  { system: 'gbc', core: 'gb', family: 'gambatte' },
  { system: 'gba', core: 'gba', family: 'mgba' },
  { system: 'genesis', core: 'segaMD', family: 'genesis_plus_gx' },
];
const stockControl = process.env.EMULATOR_NATIVE_STOCK_CONTROL === '1';
const staged = process.env.EMULATOR_NATIVE_ASSET_ROOT;
const coreSource = fileURLToPath(new URL('../../../../__app_modules/games/emulator/browser/core/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test.describe('native checkpoint restore completion', () => {
  test.setTimeout(90000);
  for (const definition of families) for (const legacy of [false, true]) {
    test(`${definition.family} ${legacy ? 'legacy' : 'normal'} verifies restore while paused`, async ({ page, request }) => {
      const libraryResponse = await request.get(`${FRONTEND_URL}/api/v1/emulator/library`);
      expect(libraryResponse.ok()).toBe(true);
      const library = await libraryResponse.json();
      const game = library.games.find(item => item.system === definition.system);
      expect(game, `Configured ROM required for ${definition.system}`).toBeTruthy();
      const variant = legacy ? 'legacy-wasm' : 'wasm';
      const protectedName = `${definition.family}-${variant}.protected-v1.data`;
      const romResponse = await request.get(`${FRONTEND_URL}${game.romUrl}`);
      expect(romResponse.ok()).toBe(true);
      const coreBytes = staged ? fs.readFileSync(path.join(staged, protectedName))
        : await (await request.get(`${FRONTEND_URL}/api/v1/emulator/engine/cores/${definition.family}-${variant}${stockControl ? '' : '.protected-v1'}.data`)).body();
      const provenance = { romHash: hash(await romResponse.body()), core: {
        name: definition.family, bundleHash: hash(coreBytes), variant, format: 1,
      } };
      await page.addInitScript(() => {
        // Headless screen-lock permission is unrelated to native save fidelity.
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => ({ release: async () => {}, addEventListener() {}, removeEventListener() {} }) } });
      });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (['/modules/nativeCheckpoint.js', '/modules/checkpointClient.js'].includes(url.pathname)) {
          return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(coreSource, path.basename(url.pathname)), 'utf8') });
        }
        if (url.pathname === '/') {
          return route.fulfill({ contentType: 'text/html', body: `<div id="game" style="width:640px;height:576px"></div><script type="module">
            import { prepareProtectedAssets, createNativeCheckpointBridge } from '/modules/nativeCheckpoint.js';
            window.makeBridge=createNativeCheckpointBridge;window.provenance=${JSON.stringify(provenance)};
            const assets=await prepareProtectedAssets({provenance:window.provenance,romUrl:${JSON.stringify(game.romUrl)},pathtodata:'/api/v1/emulator/engine/'});
            window.EJS_player='#game';window.EJS_core=${JSON.stringify(definition.core)};window.EJS_gameUrl=assets.romFile;
            window.EJS_pathtodata='/api/v1/emulator/engine/';window.EJS_startOnLoaded=true;window.EJS_threads=false;window.EJS_volume=0;
            window.EJS_disableDatabases=true;window.EJS_forceLegacyCores=${JSON.stringify(legacy)};window.EJS_paths=assets.paths;
            window.EJS_onGameStart=()=>window.started=true;
            const script=document.createElement('script');script.src='/api/v1/emulator/engine/loader.js';document.head.appendChild(script);
          </script>` });
        }
        if (!url.pathname.startsWith('/api/v1/emulator/engine/') && url.pathname !== game.romUrl) return route.abort();
        if (url.pathname.endsWith(`/${protectedName}`)) {
          if (staged) {
            const file = path.join(staged, protectedName);
            return route.fulfill({ contentType: 'application/octet-stream', body: fs.readFileSync(file) });
          }
          if (stockControl) url.pathname = url.pathname.replace('.protected-v1.data', '.data');
        }
        const upstream = await request.fetch(`${FRONTEND_URL}${url.pathname}${url.search}`, { method: route.request().method() });
        return route.fulfill({ response: upstream });
      });
      await page.goto(origin);
      await page.waitForFunction(() => window.started && window.EJS_emulator?.started, null, { timeout: 60000 });
      const contract = await page.evaluate(() => typeof EJS_emulator.gameManager.Module._daylight_checkpoint_contract_version);
      expect(contract, 'The stock load_state return is not a restore acknowledgment').toBe('function');
      const result = await page.evaluate(async () => {
        const emulator = EJS_emulator, gm = emulator.gameManager, module = gm.Module;
        emulator.pause(); gm.clearEJSResetTimer();
        const version = module._daylight_checkpoint_contract_version();
        const enable = module._daylight_enable_checkpoint_protection_v1();
        const restore = module.cwrap('daylight_restore_state_v1', 'number', ['string', 'number']);
        const batteryRestore = module.cwrap('daylight_restore_battery_v1', 'number', ['string', 'number']);
        const ptr = module._daylight_memory_data_v1(2), size = module._daylight_memory_size_v1(2);
        if (!ptr || !size) throw new Error('A real system RAM region is required');
        const expected = module.HEAPU8.slice(ptr, ptr + size);
        const snapshot = gm.getState(); gm.FS.writeFile('/checkpoint-native.state', snapshot);
        const beforeFrames = gm.functions.getFrameNum();
        const index = ptr + size - 1; module.HEAPU8[index] ^= 0x5a;
        const modified = module.HEAPU8[index];
        // Unmanaged legacy restore must not sneak through when the queue later runs.
        gm.functions.loadState('/checkpoint-native.state', 0);
        const unmanagedPending = module._daylight_restore_pending_v1();
        const missing = restore('/missing-checkpoint-native.state', 101);
        const missingId = module._daylight_restore_last_request_v1();
        const stillModified = module.HEAPU8[index];
        gm.FS.writeFile('/corrupt-checkpoint-native.state', new Uint8Array([1, 2, 3]));
        const corrupt = restore('/corrupt-checkpoint-native.state', 102);
        const corruptId = module._daylight_restore_last_request_v1();
        const incompatibleState = new Uint8Array(snapshot); incompatibleState[7] = 255;
        gm.FS.writeFile('/incompatible-native.state', incompatibleState);
        const incompatible = restore('/incompatible-native.state', 106);
        const malformedState = new Uint8Array(snapshot); malformedState.fill(255, 12, 16);
        gm.FS.writeFile('/malformed-native.state', malformedState);
        const malformed = restore('/malformed-native.state', 107);
        const valid = restore('/checkpoint-native.state', 103);
        const validId = module._daylight_restore_last_request_v1();
        const restoredRam = module.HEAPU8.slice(ptr, ptr + size);
        const same = expected.length === restoredRam.length && expected.every((value, i) => value === restoredRam[i]);
        gm.functions.restart();
        const resetBlocked = expected.every((value, i) => value === module.HEAPU8[ptr + i]);
        const bridge = window.makeBridge({ instance: emulator, provenance: window.provenance });
        const bridgeProof = await bridge.restore({ kind: 'state', data: snapshot });
        const afterFrames = gm.functions.getFrameNum();
        const savePtr = module._daylight_memory_data_v1(0), saveSize = module._daylight_memory_size_v1(0);
        const savePath = gm.getSaveFilePath();
        let battery = 0, batteryMatches = false, refreshBlocked = null;
        if (savePtr && saveSize) {
          const expectedSave = module.HEAPU8.slice(savePtr, savePtr + saveSize);
          gm.FS.writeFile(savePath, expectedSave); module.HEAPU8[savePtr + saveSize - 1] ^= 0x5a;
          const modifiedSaveByte = module.HEAPU8[savePtr + saveSize - 1];
          gm.loadSaveFiles();
          refreshBlocked = module.HEAPU8[savePtr + saveSize - 1] === modifiedSaveByte;
          battery = batteryRestore(savePath, 104);
          batteryMatches = expectedSave.every((value, i) => value === module.HEAPU8[savePtr + i]);
        } else {
          gm.FS.writeFile(savePath, new Uint8Array([1, 2, 3])); battery = batteryRestore(savePath, 104);
        }
        gm.FS.writeFile(savePath, new Uint8Array([1, 2, 3]));
        const badBattery = batteryRestore(savePath, 105);
        return { resetBlocked, refreshBlocked, bridgeProof, version, enable, unmanagedPending, incompatible, malformed, missing, missingId, modified, stillModified, corrupt, corruptId,
          valid, validId, same, beforeFrames, afterFrames, saveSize, battery, batteryMatches, badBattery };
      });
      expect(result.resetBlocked).toBe(true);
      expect(result.bridgeProof).toMatchObject({ status: 'ok', verified: true, provenance });
      expect(result.unmanagedPending).toBe(0); expect(result.incompatible).toBe(0); expect(result.malformed).toBe(0);
      expect(result.version).toBe(1); expect(result.enable).toBe(1);
      expect(result.missing).toBe(0); expect(result.missingId).toBe(101);
      expect(result.stillModified).toBe(result.modified);
      expect(result.corrupt).toBe(0); expect(result.corruptId).toBe(102);
      expect(result.valid).toBe(1); expect(result.validId).toBe(103); expect(result.same).toBe(true);
      expect(result.afterFrames).toBe(result.beforeFrames);
      if (game.saveMode === 'battery') expect(result.saveSize).toBeGreaterThan(0);
      if (result.saveSize) { expect(result.refreshBlocked).toBe(true); expect(result.battery).toBe(1); expect(result.batteryMatches).toBe(true); }
      else expect(result.battery).toBe(0);
      expect(result.badBattery).toBe(0);
    });
  }
});
