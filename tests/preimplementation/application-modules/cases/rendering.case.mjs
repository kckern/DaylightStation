// Explicit preparation runner only; intentionally outside default test globs.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {wireRequest} from '../drivers/http-wire.mjs';
import {FilesystemStaticImageRepository} from '../../../../backend/src/1_adapters/persistence/files/FilesystemStaticImageRepository.mjs';
import {StaticAssetService} from '../../../../backend/src/3_applications/static-assets/StaticAssetService.mjs';
import {createStaticRouter} from '../../../../backend/src/4_api/v1/routers/static.mjs';
import {initCanvas} from '../../../../backend/src/1_rendering/lib/CanvasFactory.mjs';
import { createGratitudeCardRenderer } from '../../../../backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs';
import { gratitudeCardTheme } from '../../../../backend/src/1_rendering/gratitude/gratitudeCardTheme.mjs';
import { GratitudePrintPresentationService } from '../../../../backend/src/3_applications/gratitude/services/GratitudePrintPresentationService.mjs';
import { AssignItemToUser } from '../../../../backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs';
import { fixture, householdA, stamp, logger } from '../drivers/gratitude.mjs';
const model = {
  gratitude: [{
    id: 'g1',
    text: 'An afternoon together',
    displayName: 'Family A'
  }],
  hopes: [{
    id: 'h1',
    text: 'A thoughtful week',
    displayName: 'Bryn'
  }]
};
test('CASE-GR-RENDER-NATIVE real bundled font, PNG and selected IDs', async () => {
  const font = new URL('../../../../backend/assets/fonts/' + gratitudeCardTheme.fonts.fontPath, import.meta.url);
  assert.ok(fs.statSync(font).size > 0);
  const renderer = createGratitudeCardRenderer({
    getSelectionsForPrint: async () => structuredClone(model)
  });
  const result = await renderer.createCanvas(false);
  assert.equal(result.width, 580);
  assert.ok(result.height >= 450);
  assert.deepEqual(result.selectedIds, {
    gratitude: ['g1'],
    hopes: ['h1']
  });
  const png = result.canvas.toBuffer('image/png');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 580);
  assert.equal(png.readUInt32BE(20), result.height);
});
test('CASE-GR-RENDER-FLIP 180-degree output preserves every pixel and ID', async () => {
  mock.timers.enable({
    apis: ['Date'],
    now: Date.parse(stamp)
  });
  try {
    const renderer = createGratitudeCardRenderer({
      getSelectionsForPrint: async () => structuredClone(model)
    });
    const a = await renderer.createCanvas(false);
    const b = await renderer.createCanvas(true);
    assert.deepEqual(b.selectedIds, a.selectedIds);
    assert.equal(b.width, a.width);
    assert.equal(b.height, a.height);
    const before = a.canvas.getContext('2d').getImageData(0, 0, a.width, a.height).data;
    const after = b.canvas.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    for (let pixel = 0; pixel < a.width * a.height; pixel++) for (let channel = 0; channel < 4; channel++) assert.equal(after[pixel * 4 + channel], before[(a.width * a.height - 1 - pixel) * 4 + channel]);
  } finally {
    mock.timers.reset();
  }
});
test('CASE-GR-RENDER-EMPTY null model stays null, empty categories still render', async () => {
  assert.equal(await createGratitudeCardRenderer({
    getSelectionsForPrint: async () => null
  }).createCanvas(), null);
  const result = await createGratitudeCardRenderer({
    getSelectionsForPrint: async () => ({
      gratitude: [],
      hopes: []
    })
  }).createCanvas();
  assert.deepEqual(result.selectedIds, {
    gratitude: [],
    hopes: []
  });
});
test('CASE-GR-PRESENTATION selections are chosen by application, not renderer', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) await f.service.addSelection(householdA, 'gratitude', 'alex', {
    id: 'o' + i,
    text: 'Item ' + i
  }, stamp);
  const presentation = new GratitudePrintPresentationService({
    gratitude: f.service,
    resolveGroupLabel: id => f.household.resolveDisplayName(id),
    clock: {
      now: () => Date.parse(stamp)
    },
    random: () => 0,
    counts: {
      gratitude: 2,
      hopes: 2
    }
  });
  const output = await presentation.prepare(householdA);
  assert.equal(output.gratitude.length, 2);
  assert.deepEqual(output.hopes, []);
  assert.equal(output.gratitude[0].displayName, 'Family A');
  assert.deepEqual(Object.keys(output.gratitude[0]).sort(), ['displayName', 'id', 'text']);
});
test('CASE-GR-HOMEBOT actual assignment persists once and tells browser not to persist again', async () => {
  const f = fixture();
  const updates = [];
  const events = [];
  const state = {
    flowState: {
      category: 'gratitude',
      items: [{
        id: 'h1',
        text: 'Our home'
      }]
    }
  };
  const usecase = new AssignItemToUser({
    messagingGateway: {
      updateMessage: async (...args) => updates.push(args)
    },
    conversationStateStore: {
      get: async () => state,
      delete: async () => {},
      set: async () => {}
    },
    gratitudeService: f.service,
    householdService: {
      getHouseholdId: () => householdA,
      getMemberDisplayName: async () => 'Family A'
    },
    websocketBroadcast: p => events.push(p),
    logger
  });
  const result = await usecase.execute({
    conversationId: 'synthetic-conversation',
    messageId: 'synthetic-message',
    username: 'alex'
  });
  assert.equal(result.success, true);
  assert.equal((await f.service.getSelections(householdA, 'gratitude')).length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'homebot');
  assert.equal(events[0].action, 'item_added');
  assert.ok(updates.length > 0);
});

function imageFixture(resizeImage=async image=>image) {
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(process.env.PRE_RUN_ROOT),'static-images-'));
  const repository=new FilesystemStaticImageRepository({imgBasePath:directory});
  const service=new StaticAssetService({repository,resizeImage,logger});
  const app=express();app.use('/api/v1/static',createStaticRouter({staticAssetService:service,logger}));
  return {directory,repository,service,write(name,bytes){const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);},
    request:suffix=>wireRequest(app,'GET','/api/v1/static'+suffix)};
}
test('CASE-RESOURCE-AVATAR-PATHS generic avatar URL does not inherit typed user default fallback',async()=>{
  const f=imageFixture(),fallback='<svg xmlns="http://www.w3.org/2000/svg"><title>Default</title></svg>';
  f.write('users/default.svg',fallback);
  const typed=await f.request('/users/missing');assert.equal(typed.status,200);assert.equal(typed.body,fallback);
  const generic=await f.request('/img/users/missing');assert.equal(generic.status,404);
  assert.deepEqual(generic.json(),{error:'Image not found',path:'users/missing'});
  assert.equal((await f.request('/img/users/user')).status,404);
  f.write('users/user.svg',fallback.replace('Default','Generic'));
  const explicit=await f.request('/img/users/user');assert.equal(explicit.status,200);
  assert.match(explicit.body,/Generic/);assert.equal(explicit.headers['content-type'],'image/svg+xml');
  assert.equal(explicit.headers['cache-control'],'public, max-age=86400');
  assert.equal(explicit.headers['access-control-allow-origin'],'*');
  assert.equal(Number(explicit.headers['content-length']),Buffer.byteLength(explicit.body));
});
test('CASE-RESOURCE-IMAGE-PRECEDENCE exact name precedes ordered extension probing',async()=>{
  const f=imageFixture();f.write('users/alex','exact');f.write('users/alex.svg','svg');f.write('users/alex.png','png');
  const exact=await f.request('/img/users/alex');assert.equal(exact.body,'exact');
  assert.equal(exact.headers['content-type'],'application/octet-stream');
  const named=await f.request('/img/users/alex.png');assert.equal(named.body,'png');assert.equal(named.headers['content-type'],'image/png');
  f.write('users/bryn.svg','svg-first');f.write('users/bryn.png','png-second');
  assert.equal((await f.request('/img/users/bryn')).body,'svg-first');
  assert.equal(await f.repository.getImage('image','../../outside-audit'),null);
});
test('CASE-RESOURCE-IMAGE-RESIZE generic raster dimensions and resize failure preserve baseline fallback',async()=>{
  const calls=[],f=imageFixture(async(image,dimensions)=>{calls.push({identity:image.identity,...dimensions});throw new Error('synthetic resize failure');});
  f.write('users/alex.png','synthetic-raster');f.write('users/bryn.svg','synthetic-vector');
  assert.equal((await f.request('/users/alex?w=24')).body,'synthetic-raster');assert.equal(calls.length,0);
  assert.equal((await f.request('/img/users/alex?w=24&h=-1')).body,'synthetic-raster');
  assert.deepEqual(calls,[{identity:'users/alex.png',width:24,height:null}]);
  assert.equal((await f.request('/img/users/alex?w=0&h=invalid')).status,200);assert.equal(calls.length,1);
  assert.equal((await f.request('/img/users/bryn?w=24')).body,'synthetic-vector');assert.equal(calls.length,1);
});
test('CASE-RESOURCE-FONT-OPTIONAL invalid supplied font root does not prevent native canvas creation',async()=>{
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(process.env.PRE_RUN_ROOT),'missing-fonts-'));
  const {canvas}=await initCanvas({width:12,height:16,fontDir:directory,fontFile:'absent.ttf',fontFamily:'Audit Missing Face',
    extraFonts:[{file:'also-absent.ttf',family:'Audit Missing Extra'}]});
  assert.equal(canvas.width,12);assert.equal(canvas.height,16);
  assert.deepEqual([...canvas.toBuffer('image/png').subarray(0,8)],[137,80,78,71,13,10,26,10]);
});
