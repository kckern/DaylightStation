import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createEmulatorRouter } from '../../__app_modules/games/emulator/server/api/emulator.mjs';
import { EmulatorCheckpointService } from '../../__app_modules/games/emulator/server/application/EmulatorCheckpointService.mjs';
import { FilesystemEmulatorCheckpointRepository } from '../../__app_modules/games/emulator/server/adapters/FilesystemEmulatorCheckpointRepository.mjs';
import { FilesystemEmulatorSaveRepository } from '../../__app_modules/games/emulator/server/adapters/FilesystemEmulatorSaveRepository.mjs';
import { FilesystemEmulatorAssetRepository } from '../../__app_modules/games/emulator/server/adapters/FilesystemEmulatorAssetRepository.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceUrl = relative => `/@fs/${path.join(repoRoot, relative)}`;
const entry = '/__fixture/main.js';
const resource = bytes => ({ size: bytes.length, open: () => Readable.from([bytes]) });

/** Real frontend, API, filesystem and WASM; production access is GET-only assets. */
export async function createEmulatorConsoleFixture({ frontendUrl, upstream, protectedAssetRoot } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-real-console-'));
  const games = new Map(), assets = new Map();
  const readUpstream = async asset => {
    const response = await upstream.get(`${frontendUrl}${asset}`);
    if (!response.ok()) throw new Error(`Required emulator fixture asset failed: ${asset} (${response.status()})`);
    return { bytes: await response.body(), type: response.headers()['content-type'] || 'application/octet-stream' };
  };
  const library = JSON.parse((await readUpstream('/api/v1/emulator/library')).bytes.toString());
  const original = library.games.find(game => game.system === 'gbc' && game.saveMode === 'battery');
  if (!original?.romUrl) throw new Error('A configured Game Boy Color battery ROM is required');
  const rom = (await readUpstream(original.romUrl)).bytes;
  for (const variant of ['wasm', 'legacy-wasm']) {
    const name = `gambatte-${variant}.protected-v1.data`;
    const asset = protectedAssetRoot ? { bytes: fs.readFileSync(path.join(protectedAssetRoot, name)), type: 'application/octet-stream' }
      : await readUpstream(`/api/v1/emulator/engine/cores/${name}`);
    assets.set(`cores/${name}`, asset);
  }
  const repository = new FilesystemEmulatorCheckpointRepository({ emulationDir: root });
  const service = new EmulatorCheckpointService({ checkpointRepository: repository,
    saveRepository: new FilesystemEmulatorSaveRepository({ emulationDir: root }), makeId: randomUUID,
    assetRepository: {
      getRomResource: () => resource(rom),
      getEngineResource: name => { const asset = assets.get(name); if (!asset) throw new Error(`Unprepared core asset: ${name}`); return resource(asset.bytes); },
      getResourceDigest: FilesystemEmulatorAssetRepository.prototype.getResourceDigest,
    },
    loadConfig: () => ({ systems: { gbc: { core: 'gb' } }, games: [...games.values()] }),
  });
  const main = `
    import React, {useCallback, useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {EmulatorConsole} from ${JSON.stringify(sourceUrl('__app_modules/games/emulator/browser/EmulatorConsole.jsx'))};
    import {createSaveClient} from ${JSON.stringify(sourceUrl('__app_modules/games/emulator/browser/core/saveClient.js'))};
    const id=new URL(location.href).searchParams.get('game');
    const response=await fetch('/__fixture/config/'+encodeURIComponent(id));
    if(!response.ok)throw Error('Unknown fixture game');
    const game=await response.json(), client=createSaveClient();
    const persistence={userId:'test_user',persist:true,saveMode:game.saveMode,checkpoint:{key:{system:game.system,gameId:game.id,user:'test_user'},client,journal:client.journal}};
    const gate={mode:'open',isPlayable:()=>true,getStatus:()=>({state:'playing'}),onChange:()=>()=>{}};
    function Fixture(){
      const [open,setOpen]=useState(true),[state,setState]=useState('paused'),guard=useRef(null);
      const register=useCallback(value=>{guard.current=value},[]);
      const closed=useCallback(()=>{setOpen(false);setState('paused')},[]);
      const changed=useCallback(value=>setState(value),[]);
      const style={position:'fixed',bottom:8,right:8,zIndex:3000};
      return React.createElement('div',{style:{width:'100%',height:'100%'}},
        open?React.createElement(EmulatorConsole,{game,persistence,engineConfig:{core:'gb',pathtodata:'/api/v1/emulator/engine/'},governanceGate:gate,
          autosaveSeconds:0,showInputActivity:false,onExit:closed,onExitGuardReady:register,onArcadeGameSessionStateChange:changed}):
          React.createElement('button',{style,onClick:()=>{setState('paused');setOpen(true)}},'Open game'),
        open&&React.createElement('button',{style,onClick:async()=>{const result=await guard.current?.();if(!result||result.status==='ok')closed()}},'Close host'),
        React.createElement('output',{'data-testid':'session-state',style:{position:'fixed',top:8,left:120,zIndex:3000,color:'white'}},open?state:'closed'));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `;
  const vite = await createViteServer({ configFile: path.join(repoRoot, 'frontend/vite.config.js'), root: path.join(repoRoot, 'frontend'), mode: 'test',
    cacheDir: path.join(root, 'vite-cache'),
    server: { middlewareMode: true, hmr: false, fs: { allow: [repoRoot, root] } }, appType: 'custom',
    optimizeDeps: { entries: [], include: ['react', 'react-dom/client', 'react/jsx-runtime', '@mantine/core', '@mantine/hooks'] },
    plugins: [{ name: 'emulator-real-console-fixture', resolveId: id => id === entry ? entry : null, load: id => id === entry ? main : null }],
  });
  const app = express();
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/', async (req, res, next) => {
    try { res.type('html').send(await vite.transformIndexHtml(req.originalUrl, '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;background:black}</style></head><body><div id="root"></div><script type="module" src="/__fixture/main.js"></script></body></html>')); }
    catch (error) { next(error); }
  });
  app.get('/__fixture/config/:id', (req, res) => { const game = games.get(req.params.id); if (!game) return res.sendStatus(404); res.json(game); });
  app.use('/api/v1/emulator/engine', async (req, res, next) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
      const assetId = req.path.replace(/^\//, '');
      if (!assets.has(assetId)) assets.set(assetId, await readUpstream(`/api/v1/emulator/engine/${assetId}`));
      const asset = assets.get(assetId); res.type(asset.type).send(asset.bytes);
    } catch (error) {
      // Missing optional reports/localizations must retain their 404 semantics.
      if (error.message.includes('(404)')) return res.sendStatus(404);
      next(error);
    }
  });
  app.get('/api/v1/emulator/rom/gbc/:id', (req, res) => { if (!games.has(req.params.id)) return res.sendStatus(404); res.type('application/octet-stream').send(rom); });
  app.use('/api/v1/emulator', createEmulatorRouter({ emulatorResources: {}, emulatorLibrary: { getLibrary: () => ({ games: [...games.values()] }) }, checkpointService: service }));
  app.use('/api', (_req, res) => res.sendStatus(404));
  app.use(vite.middlewares);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const key = game => ({ system: game.system, gameId: game.id, user: 'test_user' });
  return {
    registerGame({ saveMode = 'battery', states = null } = {}) {
      const id = `example-${randomUUID()}`;
      const game = { id, system: 'gbc', title: 'Example Quest', saveMode, states, romUrl: `/api/v1/emulator/rom/gbc/${id}`,
        native: { width: 160, height: 144 }, presentation: { hotspots: [{ id: 'logo', action: 'exit', label: 'Bezel exit', region: { x: 4, y: 20, width: 8, height: 8 } }] } };
      games.set(id, game); return { ...game, url: `${address}/?game=${id}` };
    },
    read: game => repository.read(key(game)), history: game => repository.history(key(game)),
    async importCorrupt(game) {
      const description = await service.read(key(game));
      return service.import(key(game), { expectedRevision: description.head?.revision ?? null, provenance: description.provenance,
        captureId: randomUUID(), sessionId: randomUUID(), sequence: 1, snapshot: Buffer.from([1, 2, 3]), battery: Buffer.alloc(32768) });
    },
    async close() {
      await vite.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      await upstream.dispose(); fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
