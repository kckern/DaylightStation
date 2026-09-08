// Explicit preparation runner only; intentionally outside default test globs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {wireRequest as dispatchWireRequest} from '../drivers/http-wire.mjs';
import express from 'express';
import cors from 'cors';
import { fixture, householdA, householdB, stamp, candidateDriver, logger } from '../drivers/gratitude.mjs';
import { loadGratitudeImplementation } from '../drivers/gratitude-target.mjs';
const { createApiRouter, GratitudeFeedAdapter, TemporaryImagePrintGateway, DataService, ConfigService, YamlGratitudeDatastore, GratitudeService, YamlAdminConfigStore, YamlConfigFileService, createAdminConfigRouter } = await loadGratitudeImplementation();
const item = {
  id: 'option-a',
  text: 'Time together'
};
const postOption = f => f.request('POST', '/options/gratitude', {
  body: {
    text: item.text
  }
});
const select = f => f.request('POST', '/selections/gratitude', {
  body: {
    userId: 'alex',
    item
  }
});

for (const [label, stored] of [['null', null], ['object', {unexpected: true}]])
  test('CASE-GR-FEED-NONARRAY-' + label + ' absent or non-array source produces no bundle', async () => {
    const adapter = new GratitudeFeedAdapter({dataService: {household: {read: () => stored}}, logger});
    assert.deepEqual(await adapter.fetchItems({}, 'ignored-user'), []);
  });
test('CASE-GR-FEED-EMPTY an empty stored array produces an empty bundle, not no bundle', async () => {
  const adapter = new GratitudeFeedAdapter({dataService: {household: {read: () => []}}, logger});
  const result = await adapter.fetchItems({}, 'ignored-user');
  assert.equal(result.length, 1);
  assert.equal(result[0].body, '');
  assert.deepEqual(result[0].meta.items, []);
  assert.equal(result[0].tier, 'compass');
  assert.equal(result[0].priority, 5);
  assert.ok(Number.isFinite(Date.parse(result[0].timestamp)));
});
test('CASE-GR-FEED-BADROW a picked null row fails the bundle instead of being silently filtered', async () => {
  const warnings = [];
  const adapter = new GratitudeFeedAdapter({dataService: {household: {read: () => [null]}},
    logger: {warn: (...args) => warnings.push(args)}});
  assert.deepEqual(await adapter.fetchItems({}, 'ignored-user'), []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'gratitude.adapter.error');
});
test('CASE-GR-FEED-LIMIT truthiness and negative slicing preserve existing query behavior', async () => {
  const rows = [1, 2, 3, 4].map(n => ({item: {text: 'item-' + n}, datetime: stamp}));
  const adapter = new GratitudeFeedAdapter({dataService: {household: {read: () => rows}}, logger});
  const zero = await adapter.fetchItems({limit: 0, priority: 0, tier: ''}, 'ignored-user');
  assert.equal(zero[0].meta.items.length, 3);
  assert.equal(zero[0].priority, 5);
  assert.equal(zero[0].tier, 'compass');
  const negative = await adapter.fetchItems({limit: -2}, 'ignored-user');
  assert.equal(negative[0].meta.items.length, 2);
  assert.deepEqual(rows.map(r => r.item.text), ['item-1', 'item-2', 'item-3', 'item-4']);
});

/** Actual Express/Node response serialization over an in-memory duplex, never a socket. */
async function wireRequest(f, method, suffix, {withCors = false} = {}) {
  const app = express();
  // This is the observed middleware arrangement's projection, not importing app.mjs.
  if (withCors) app.use(cors());
  app.use('/api/v1', createApiRouter({safeConfig: {}, routers: {gratitude: f.productRouter}, logger}));
  return dispatchWireRequest(app, method, '/api/v1/gratitude' + suffix);
}

test('CASE-GR-WIRE-HEAD bootstrap retains JSON headers and suppresses response body', {timeout: 5000}, async () => {
  const f = fixture();
  const result = await wireRequest(f, 'HEAD', '/bootstrap');
  assert.equal(result.status, 200);
  assert.match(result.headers['content-type'], /^application\/json/);
  assert.ok(Number(result.headers['content-length']) > 0);
  assert.equal(result.body, '');
});
test('CASE-GR-WIRE-HEAD-EVENT HEAD still executes the side-effecting new handler', {timeout: 5000}, async () => {
  const f = fixture();
  const result = await wireRequest(f, 'HEAD', '/new?text=Synthetic%20gratitude');
  assert.equal(result.status, 200);
  assert.equal(result.body, '');
  assert.equal(f.broadcasts.length, 1);
});
test('CASE-GR-WIRE-OPTIONS router fallback declares GET and HEAD without executing GET', {timeout: 5000}, async () => {
  const f = fixture();
  const result = await wireRequest(f, 'OPTIONS', '/new');
  assert.equal(result.status, 200);
  assert.deepEqual(String(result.headers.allow).split(/,\s*/).sort(), ['GET', 'HEAD']);
  assert.equal(f.broadcasts.length, 0);
});
test('CASE-GR-WIRE-CORS global default preflight responds before router effects', {timeout: 5000}, async () => {
  const f = fixture();
  const result = await wireRequest(f, 'OPTIONS', '/new', {withCors: true});
  assert.equal(result.status, 204);
  assert.equal(result.headers['access-control-allow-origin'], '*');
  assert.equal(result.body, '');
  assert.equal(f.broadcasts.length, 0);
});
test('CASE-GR-WIRE-METHOD unsupported PUT falls through without route effects', {timeout: 5000}, async () => {
  const f = fixture();
  const result = await wireRequest(f, 'PUT', '/new');
  assert.equal(result.status, 404);
  assert.equal(f.broadcasts.length, 0);
  assert.equal(f.writes.length, 0);
});
test('CASE-GR-HTTP-01 bootstrap ignores req.householdId and preserves query/default projection', async () => {
  const f = fixture();
  const a = await f.request('GET', '/bootstrap');
  assert.equal(a.status, 200);
  assert.equal(a.body._household, householdA);
  assert.deepEqual(Object.keys(a.body).sort(), ['_household', 'discarded', 'options', 'selections', 'users']);
  assert.deepEqual(a.body.users, [{
    id: 'alex',
    name: 'Alex',
    group_label: 'Family A'
  }, {
    id: 'bryn',
    name: 'Bryn',
    group_label: null
  }]);
  const b = await f.request('GET', '/bootstrap', {
    query: {
      household: householdB
    }
  });
  assert.equal(b.body._household, householdB);
  assert.equal(b.body.users[0].id, 'visitor');
});
test('CASE-GR-HTTP-02 users preserve names, group labels and order', async () => {
  const f = fixture();
  const r = await f.request('GET', '/users');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.users.map(x => x.name), ['Alex', 'Bryn']);
  assert.equal(f.household.resolveDisplayName('alex'), 'Family A');
  assert.equal(f.household.resolveDisplayName(null), 'Unknown');
});
test('CASE-GR-HTTP-03 empty options return both categories', async () => {
  const r = await fixture().request('GET', '/options');
  assert.deepEqual(r.body, {
    options: {
      gratitude: [],
      hopes: []
    },
    _household: householdA
  });
});
test('CASE-GR-HTTP-04 option category normalization and invalid category', async () => {
  const f = fixture();
  const r = await f.request('GET', '/options/GRATITUDE');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  assert.deepEqual((await f.request('GET', '/options/other')).body, {
    error: 'Invalid category'
  });
});
test('CASE-GR-HTTP-05 option creation trims text and persists dotted YAML key', async () => {
  const f = fixture();
  const r = await f.request('POST', '/options/gratitude', {
    body: {
      text: '  Time together  '
    }
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.item.text, item.text);
  assert.ok(r.body.item.id);
  assert.equal(f.writes.at(-1).path, 'gratitude/options.gratitude.yml');
  assert.deepEqual((await f.request('GET', '/options/gratitude')).body.items, [r.body.item]);
});
for (const [label, text] of [['absent', undefined], ['null', null], ['empty', ''], ['number', 2]]) test('CASE-GR-VALID-OPTION-' + label, async () => {
  const f = fixture();
  const r = await f.request('POST', '/options/gratitude', {
    body: {
      text
    }
  });
  assert.equal(r.status, 400);
  assert.equal(f.writes.length, 0);
});
test('CASE-GR-HTTP-06 selections serialize their public DTO', async () => {
  const f = fixture();
  await select(f);
  const r = await f.request('GET', '/selections/gratitude');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.deepEqual(r.body.items[0].item, item);
  assert.equal(r.body.items[0].userId, 'alex');
});
test('CASE-GR-SELECTION-HISTORY newly selected item persists its empty print history before any print', async () => {
  const f = fixture();
  await select(f);
  assert.deepEqual(f.dataService.household.read('gratitude/selections.gratitude.yml')[0].printed, []);
});
test('CASE-GR-HTTP-07 select transfers options, rejects duplicate without writing', async () => {
  const f = fixture();
  await f.store.addOption(householdA, 'gratitude', item);
  const r = await select(f);
  assert.equal(r.status, 201);
  assert.deepEqual(await f.store.getOptions(householdA, 'gratitude'), []);
  const writes = f.writes.length;
  const duplicate = await select(f);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'Item already selected by this user');
  assert.equal(f.writes.length, writes);
});
test('CASE-GR-HTTP-08 delete returns removed selection then 404', async () => {
  const f = fixture();
  const r = await select(f);
  const id = r.body.selection.id;
  assert.equal((await f.request('DELETE', '/selections/gratitude/' + id)).body.removed.id, id);
  assert.equal((await f.request('DELETE', '/selections/gratitude/' + id)).status, 404);
  assert.deepEqual((await f.request('GET', '/selections/gratitude')).body.items, []);
});
test('CASE-GR-HTTP-09 discarded read is separate from options recycling', async () => {
  const f = fixture();
  await f.store.addDiscarded(householdA, 'gratitude', item);
  assert.deepEqual((await f.request('GET', '/discarded/gratitude')).body.items, [item]);
});
test('CASE-GR-HTTP-10 discard transfers option and keeps plain item shape', async () => {
  const f = fixture();
  await f.store.addOption(householdA, 'gratitude', item);
  const r = await f.request('POST', '/discarded/gratitude', {
    body: {
      item
    }
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.item, item);
  assert.deepEqual(await f.store.getOptions(householdA, 'gratitude'), []);
  assert.equal((await f.request('POST', '/discarded/gratitude', {
    body: {}
  })).status, 400);
});
test('CASE-GR-RECYCLE getOptions recycles discarded and writes, despite GET', async () => {
  const f = fixture();
  await f.store.addDiscarded(householdA, 'gratitude', item);
  const n = f.writes.length;
  const r = await f.request('GET', '/options/gratitude');
  assert.deepEqual(r.body.items, [item]);
  assert.ok(f.writes.length > n);
  assert.deepEqual(await f.store.getDiscarded(householdA, 'gratitude'), []);
});
test('CASE-GR-HTTP-11 snapshot writes actual YAML under the synthetic root', async () => {
  const f = fixture();
  await select(f);
  const r = await f.request('POST', '/snapshot/save');
  assert.equal(r.status, 201);
  assert.ok(r.body.id);
  assert.ok(r.body.file.endsWith(r.body.id));
  assert.ok(fs.existsSync(path.join(f.directory, householdA, 'gratitude/snapshots', r.body.file + '.yml')));
});
test('CASE-GR-HTTP-12 snapshot list starts empty then lists saved identity', async () => {
  const f = fixture();
  assert.deepEqual((await f.request('GET', '/snapshot/list')).body.snapshots, []);
  const saved = await f.request('POST', '/snapshot/save');
  const listed = await f.request('GET', '/snapshot/list');
  assert.equal(listed.body.snapshots.length, 1);
  assert.equal(listed.body.snapshots[0].id, saved.body.id);
});
test('CASE-GR-HTTP-13 snapshot name restore preserves records; unknown ID currently falls back to latest', async () => {
  const f = fixture();
  await select(f);
  const saved = await f.request('POST', '/snapshot/save');
  const id = (await f.request('GET', '/selections/gratitude')).body.items[0].id;
  await f.request('DELETE', '/selections/gratitude/' + id);
  const restored = await f.request('POST', '/snapshot/restore', {
    body: {
      name: saved.body.file + '.yml'
    }
  });
  assert.equal(restored.status, 200);
  assert.equal((await f.request('GET', '/selections/gratitude')).body.items[0].id, id);
  assert.equal((await f.request('POST', '/snapshot/restore', {
    body: {
      id: 'missing-id'
    }
  })).body.id, saved.body.id);
});
test('CASE-GR-SNAPSHOT-EMPTY no snapshots produces error, never success', async () => {
  const r = await fixture().request('POST', '/snapshot/restore', {
    body: {}
  });
  assert.equal(r.status, 404);
  assert.ok(r.body.error);
});
test('CASE-GR-HTTP-14 custom item publishes exactly once with stable topic and shape', async () => {
  const f = fixture();
  const bad = await f.request('GET', '/new');
  assert.equal(bad.status, 400);
  assert.equal(f.broadcasts.length, 0);
  const r = await f.request('GET', '/new', {
    query: {
      text: '  Hello  '
    }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.item, {
    id: 123456,
    text: 'Hello'
  });
  assert.deepEqual(f.broadcasts, [{
    topic: 'gratitude',
    item: r.body.item,
    timestamp: stamp,
    type: 'gratitude_item',
    isCustom: true
  }]);
  assert.equal(f.writes.length, 0);
});
test('CASE-GR-HTTP-15 print projection resolves group label', async () => {
  const f = fixture();
  await select(f);
  const r = await f.request('GET', '/print');
  assert.equal(r.body.gratitude[0].displayName, 'Family A');
  assert.equal(r.body.gratitude[0].printCount, 0);
  assert.deepEqual(r.body.hopes, []);
});
test('CASE-GR-HTTP-16 marking records history and reports requested count including unknown IDs', async () => {
  const f = fixture();
  const selected = (await select(f)).body.selection;
  const r = await f.request('POST', '/print/mark', {
    body: {
      category: 'gratitude',
      selectionIds: [selected.id, 'unknown']
    }
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.marked, 2);
  const stored = f.dataService.household.read('gratitude/selections.gratitude.yml');
  assert.equal(stored[0].printed.length, 1);
  assert.equal((await f.request('POST', '/print/mark', {
    body: {
      category: 'gratitude',
      selectionIds: []
    }
  })).body.marked, 0);
});
test('CASE-GR-HTTP-17 preview headers and default orientation', async () => {
  const f = fixture();
  const r = await f.request('GET', '/card');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.headers['content-length'], r.body.length);
  assert.equal(r.headers['content-disposition'], 'inline; filename="gratitude-card.png"');
  assert.deepEqual(f.effects, [['render', false]]);
  await f.request('GET', '/card', {
    query: {
      upsidedown: 'true'
    }
  });
  assert.equal(f.effects.at(-1)[1], true);
});
for (const [name, value, success] of [['true', true, true], ['verified', {
  verified: true
}, true], ['false', false, false], ['truthy', {}, false], ['unverified', {
  verified: false
}, false]]) test('CASE-GR-HTTP-18-' + name + ' print marks only on confirmed success', async () => {
  const f = fixture({
    printerOutcome: value
  });
  const selected = (await select(f)).body.selection;
  f.selectedIds.gratitude = [selected.id];
  const r = await f.request('GET', '/card/print/audit-printer');
  assert.equal(r.status, 200);
  assert.equal(r.body.success, success);
  assert.deepEqual(r.body.printed.gratitude, success ? [selected.id] : []);
  assert.equal(f.dataService.household.read('gratitude/selections.gratitude.yml')[0].printed.length, success ? 1 : 0);
  assert.deepEqual(f.effects[0], ['resolve', 'audit-printer']);
  assert.deepEqual(f.effects[1], ['render', true]);
});
test('CASE-GR-PRINT-NOLOCATION optional printer location and false flip work', async () => {
  const f = fixture();
  await f.request('GET', '/card/print', {
    query: {
      upsidedown: 'false'
    }
  });
  assert.deepEqual(f.effects.slice(0, 2), [['resolve', undefined], ['render', false]]);
});
test('CASE-GR-PRINT-NOTFOUND printer lookup refuses before rendering', async () => {
  const f = fixture({
    missingPrinter: true
  });
  const r = await f.request('GET', '/card/print/unknown');
  assert.equal(r.status, 404);
  assert.deepEqual(f.effects, [['resolve', 'unknown']]);
  assert.equal(f.writes.length, 0);
});
test('CASE-GR-PRINT-UNCONFIGURED missing renderer returns 501', async () => {
  const f = fixture({
    renderer: false
  });
  assert.equal((await f.request('GET', '/card')).status, 501);
  assert.equal((await f.request('GET', '/card/print')).status, 501);
  assert.deepEqual(f.effects, []);
});
test('CASE-GR-ACCESS mapped route denies anonymously and insufficient roles, unmapped remains open', async () => {
  const f = fixture({
    access: {
      roles: {
        allowed: {
          apps: ['gratitude']
        }
      },
      appRoutes: {
        gratitude: ['gratitude/*']
      }
    }
  });
  assert.equal((await f.request('GET', '/users')).status, 401);
  assert.equal((await f.request('GET', '/users', {
    user: {
      id: 'alex'
    }
  })).status, 403);
  assert.equal((await f.request('GET', '/users', {
    roles: ['allowed']
  })).status, 200);
  assert.equal((await fixture().request('GET', '/users')).status, 200);
});
test('CASE-GR-FEED legacy shapes remain accepted and capped at three', async () => {
  const data = [{
    item: {
      text: 'nested'
    },
    userId: 'alex'
  }, {
    item: 'string',
    userId: 'bryn'
  }, {
    text: 'top-level'
  }];
  let requested;
  const adapter = new GratitudeFeedAdapter({
    dataService: {
      household: {
        read(p) {
          requested = p;
          return data;
        }
      }
    },
    userService: {
      resolveGroupLabel: id => id.toUpperCase()
    },
    logger
  });
  const result = await adapter.fetchItems({
    limit: 9
  });
  assert.equal(requested, 'gratitude/selections.gratitude.yml');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].meta.items.map(x => x.text).sort(), ['nested', 'string', 'top-level']);
  assert.equal(result[0].meta.items.length, 3);
});
test('CASE-GR-FEED-FAILURE read error degrades to empty feed', async () => {
  const adapter = new GratitudeFeedAdapter({
    dataService: {
      household: {
        read() {
          throw new Error('synthetic');
        }
      }
    },
    logger
  });
  assert.deepEqual(await adapter.fetchItems({}), []);
});
for (const fails of [false, true]) test('CASE-GR-TEMP-CLEANUP-' + fails, async () => {
  let observed;
  const gateway = new TemporaryImagePrintGateway({
    clock: () => 1234
  });
  const printer = {
    createImagePrint(p) {
      observed = p;
      assert.ok(fs.existsSync(p));
      return p;
    },
    async print() {
      if (fails) throw new Error('synthetic print failure');
      return true;
    }
  };
  const promise = gateway.print(printer, {
    buffer: Buffer.from('image'),
    width: 10,
    height: 20
  });
  if (fails) await assert.rejects(promise, /synthetic print failure/);else assert.equal(await promise, true);
  assert.equal(fs.existsSync(observed), false);
});
test('CASE-CANDIDATE-REFUSAL target selection never falls back to baseline', () => {
  if ((process.env.PRE_TARGET || 'baseline') === 'candidate') assert.ok(candidateDriver());
  else assert.throws(candidateDriver, /CANDIDATE_NOT_IMPLEMENTED/);
});

function diskFixture(folderName='household-a'){
  const directory=fs.mkdtempSync(path.join(fs.realpathSync(process.env.PRE_RUN_ROOT),'real-storage-'));
  const config=new ConfigService({system:{dataDir:directory,defaultHouseholdId:householdA},households:{[householdA]:{_folderName:folderName,users:['alex'],head:'alex',apps:{gratitude:{unknown:'preserved',display:{options_per_page:3}}}},[householdB]:{_folderName:'household-b',users:['bryn'],head:'bryn'}}});
  const data=new DataService({configService:config});
  const store=new YamlGratitudeDatastore({dataService:data,logger});
  return {directory,config,data,store,service:new GratitudeService({store})};
}
test('CASE-GR-DISK-PATHS real config and DataService preserve household folders and dotted suffixes',()=>{
  const {directory,data}=diskFixture();
  assert.equal(data.household.resolvePath('gratitude/selections.gratitude'),path.join(directory,'household-a/gratitude/selections.gratitude'));
  assert.equal(data.household.resolvePath('gratitude/selections.gratitude.yml',householdB),path.join(directory,'household-b/gratitude/selections.gratitude.yml'));
  assert.equal(data.household.resolvePath('gratitude/config'),path.join(directory,'household-a/gratitude/config.yml'));
  assert.throws(()=>data.household.resolvePath('gratitude/config','absent'),/Household not found/);
});
test('CASE-GR-DISK-SELECTION real persisted YAML round-trips the plain selected record',async()=>{
  const {data,service}=diskFixture();const option=await service.addOption(householdA,'gratitude','Real synthetic YAML');
  const selected=await service.addSelection(householdA,'gratitude','alex',option,stamp);
  assert.deepEqual(data.household.read('gratitude/selections.gratitude.yml',householdA),[{id:selected.id,userId:'alex',item:{id:option.id,text:option.text},datetime:stamp,printed:[]}]);
  assert.deepEqual(data.household.read('gratitude/options.gratitude.yml',householdA),[]);
  assert.equal(data.household.read('gratitude/selections.gratitude.yml',householdB),null);
});
test('CASE-GR-DISK-FRESH DataService rereads edited bytes without a value cache',()=>{
  const {data}=diskFixture();assert.equal(data.household.write('gratitude/options.hopes.yml',[{id:'a',text:'Before'}]),true);
  const target=data.household.resolvePath('gratitude/options.hopes.yml');
  assert.equal(data.household.read('gratitude/options.hopes.yml')[0].text,'Before');
  fs.writeFileSync(target,'- id: b\n  text: After\n');
  assert.deepEqual(data.household.read('gratitude/options.hopes.yml'),[{id:'b',text:'After'}]);
});
test('CASE-GR-DISK-READ-ERROR missing or malformed YAML retains null fallback',()=>{
  const {data}=diskFixture();assert.equal(data.household.read('gratitude/missing.yml'),null);
  const target=data.household.resolvePath('gratitude/bad.yml');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'value: [unterminated');
  assert.equal(data.household.read('gratitude/bad.yml'),null);
});
test('CASE-GR-DISK-WRITE-ERROR filesystem write failure returns false without replacing its target',()=>{
  const {data}=diskFixture();const target=data.household.resolvePath('gratitude/directory.yml');fs.mkdirSync(target,{recursive:true});
  assert.equal(data.household.write('gratitude/directory.yml',{synthetic:true}),false);
  assert.ok(fs.statSync(target).isDirectory());
});
test('CASE-GR-CONFIG-RELOAD actual config reload updates the served snapshot and retains unknown keys',()=>{
  const {config,data}=diskFixture();const before=config.getHouseholdAppConfig(householdA,'gratitude');assert.equal(before.display.options_per_page,3);
  const changed={unknown:'preserved',display:{options_per_page:5}};data.household.write('gratitude/config.yml',changed);
  assert.equal(config.getHouseholdAppConfig(householdA,'gratitude').display.options_per_page,3);
  assert.deepEqual(config.reloadHouseholdAppConfig(householdA,'gratitude'),changed);
  assert.deepEqual(config.getHouseholdAppConfig(householdA,'gratitude'),changed);
});

function adminDiskFixture(folderName='household') {
  const f=diskFixture(folderName);
  const configStore=new YamlAdminConfigStore({dataRoot:f.directory});
  const yamlConfigFileService=new YamlConfigFileService({configStore,logger});
  const app=express(); app.use(express.json());
  app.use('/api/v1/admin/config',createAdminConfigRouter({yamlConfigFileService,logger}));
  return {...f,configStore,yamlConfigFileService,request:(method,document,body)=>
    dispatchWireRequest(app,method,'/api/v1/admin/config/files/'+document,{body})};
}
test('CASE-GR-ADMIN-DISK-CACHE real editor wire write changes disk but not cached runtime config',async()=>{
  const f=adminDiskFixture();
  const changed={unknown:'preserved',display:{options_per_page:8}};
  const result=await f.request('PUT','household/gratitude/config.yml',{parsed:changed});
  assert.equal(result.status,200); assert.equal(result.json().ok,true);
  assert.equal(result.json().path,'household/gratitude/config.yml');
  assert.equal(Object.hasOwn(result.json(),'parsed'),false);
  assert.deepEqual((await f.request('GET','household/gratitude/config.yml')).json().parsed,changed);
  assert.equal(f.config.getHouseholdAppConfig(householdA,'gratitude').display.options_per_page,3);
  assert.deepEqual(f.config.reloadHouseholdAppConfig(householdA,'gratitude'),changed);
  assert.deepEqual(f.config.getHouseholdAppConfig(householdA,'gratitude'),changed);
});
test('CASE-GR-ADMIN-DISK-SCOPE editor literal household path is not configured household-folder routing',async()=>{
  const f=adminDiskFixture('household-a');
  assert.equal((await f.request('PUT','household/gratitude/config.yml',{parsed:{editor:true}})).status,200);
  assert.deepEqual(f.configStore.readManagedAppConfig('gratitude').parsed,{editor:true});
  assert.equal(fs.existsSync(path.join(f.directory,'household-a/gratitude/config.yml')),false);
  assert.equal(f.config.reloadHouseholdAppConfig(householdA,'gratitude'),null);
  assert.equal(f.config.getHouseholdAppConfig(householdA,'gratitude').display.options_per_page,3);
  assert.equal((await f.request('PUT','household-a/gratitude/config.yml',{parsed:{editor:true}})).status,403);
});
test('CASE-GR-ADMIN-DISK-EXTENSION literal yml save can shadow existing yaml configuration',async()=>{
  const f=adminDiskFixture(); f.data.household.write('gratitude/config.yaml',{extension:'yaml'});
  const yamlPath=path.join(f.directory,'household/gratitude/config.yaml');
  assert.equal(f.config.getHouseholdAppConfigPath(householdA,'gratitude'),yamlPath);
  assert.deepEqual(f.config.reloadHouseholdAppConfig(householdA,'gratitude'),{extension:'yaml'});
  assert.equal((await f.request('PUT','household/gratitude/config.yml',{parsed:{extension:'yml'}})).status,200);
  assert.equal(f.config.getHouseholdAppConfigPath(householdA,'gratitude'),yamlPath.replace(/\.yaml$/,'.yml'));
  assert.deepEqual(f.config.reloadHouseholdAppConfig(householdA,'gratitude'),{extension:'yml'});
  assert.deepEqual(f.data.household.read('gratitude/config.yaml'),{extension:'yaml'});
});
test('CASE-GR-ADMIN-DISK-ERRORS raw wins over parsed and rejected writes retain original bytes',async()=>{
  const f=adminDiskFixture(), document='household/gratitude/config.yml';
  const raw='# retained comment\nunknown: original\n';
  assert.equal((await f.request('PUT',document,{raw,parsed:{unknown:'ignored'}})).status,200);
  assert.equal((await f.request('GET',document)).json().raw,raw);
  assert.equal((await f.request('PUT',document,{raw:'value: [unterminated'})).status,400);
  assert.equal((await f.request('PUT',document,{})).status,400);
  assert.equal((await f.request('PUT','household/auth/example.yml',{parsed:{value:'synthetic'}})).status,403);
  assert.equal((await f.request('GET','household/gratitude/config.yaml')).status,404);
  assert.equal((await f.request('GET',document)).json().raw,raw);
});
test('CASE-GR-ADMIN-DISK-MODES in-place data writes retain mode while atomic editor replacement uses staging mode',async()=>{
  const f=adminDiskFixture(); f.data.household.write('gratitude/config.yml',{before:true});
  const target=path.join(f.directory,'household/gratitude/config.yml'); fs.chmodSync(target,0o600);
  f.data.household.write('gratitude/config.yml',{inplace:true});
  const before=fs.statSync(target); assert.equal(before.mode&0o777,0o600);
  assert.equal((await f.request('PUT','household/gratitude/config.yml',{parsed:{atomic:true}})).status,200);
  const after=fs.statSync(target);
  assert.notEqual(after.ino,before.ino); assert.equal(after.mode&0o777,0o666&~process.umask());
  assert.deepEqual(fs.readdirSync(path.dirname(target)),['config.yml']);
});
