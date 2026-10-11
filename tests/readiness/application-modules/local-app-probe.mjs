import {createRequire} from 'node:module';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const scratch = process.env.PRE_RUN_ROOT;
const { sourceRoot, fixtureFiles, rawUTF8Files = [], rawBinaryFiles = [], fixtureDirectories = [], metadataDirectories = [], fixedConfigMetadata = [],gratitudeCase } = JSON.parse(fs.readFileSync(path.join(scratch, 'probe-input.json'), 'utf8'));
const resultFile = path.join(scratch, 'boot-result.json');
const result = { scope: 'Actual assembled app with synthetic configs and loopback HTTP; scheduler/MQTT disabled, no production data/provider/Docker/auth/shutdown certification', readinessAccepted: false, completed: false, phases: [], errors: [], termination: null };
const save = () => fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
const fail = error => {
  result.errors.push({ name: error.name, message: error.message, code: error.code, stack: error.stack });
  result.termination = 'boot-error'; save(); console.error(error); process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const imported = file => import(pathToFileURL(path.join(sourceRoot, file)).href);
try {
  const denied = (label, fn) => { assert.throws(fn, error => ['EACCES', 'EPERM'].includes(error.code)); console.log(`BOOT CONTROL ${label}: denied`); };
  denied('private read', () => fs.readFileSync(path.join(process.env.PRE_DENIED_ROOT, 'private.env')));
  denied('host read', () => fs.readFileSync('/etc/hostname'));
  denied('source write', () => fs.openSync(path.join(sourceRoot, 'backend/src/app.mjs'), 'w'));
  denied('test results cache read', () => fs.readFileSync(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json')));
  fs.writeFileSync(path.join(scratch, 'permitted.txt'), 'synthetic');
  // The launcher supplies UTC; reviewed application reads must use the fixture's
  // explicit deployment timezone before any product module parses local dates.
  const runtimeTimezone = fixtureFiles['data/system/config/system.yml']?.timezone;
  assert.ok(typeof runtimeTimezone === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(runtimeTimezone));
  new Intl.DateTimeFormat('en-US', { timeZone: runtimeTimezone }).format(0);
  process.env.TZ = runtimeTimezone;
  result.runtimeTimezone = runtimeTimezone;
  process.env.DAYLIGHT_BASE_PATH = scratch;
  process.env.DAYLIGHT_ENV = 'readiness';
  for (const [relative, value] of Object.entries(fixtureFiles)) {
    const file = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const metadata=fixedConfigMetadata.find(row=>row.destination===relative);
    if(metadata){
      assert.equal(metadata.mtimeMs,1759276800000);
      const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');const stat=fs.lstatSync(file);
      assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&fs.realpathSync(file)===file);
      assert.equal(bytes.length,metadata.byteLength);assert.equal(stat.size,metadata.byteLength);assert.equal(stat.mtimeMs,metadata.mtimeMs);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.sha256);
      assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),metadata.sha256);
      result.fixedConfigMetadata ??= [];result.fixedConfigMetadata.push({...metadata});
    } else fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  }
  for (const row of [...rawUTF8Files, ...rawBinaryFiles]) {
    const file = path.join(scratch, row.destination);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (row.mtimeMs !== undefined) {
      assert.ok(row.encoding === 'binary' && ["media/img/lists/synthetic-breakfast.png", "media/img/lists/synthetic-reading.png", "media/img/lists/synthetic-weekly.png", "media/games/_common/synthetic-read-assets/tiles.png", "media/games/party-games/synthetic-read-assets.png", "media/school/language/synthetic-read-assets/words/en/star/image.png", "media/audio/readalong/synthetic-media-navigation/cover.png", "media/audio/readalong/synthetic-media-navigation/chapter/cover.png", "data/content/readalong/synthetic-media-navigation/icon.png", "media/img/art/synthetic-read-still/blue-room.png", "media/img/art/synthetic-read-still/garden.png", "media/audio/feedback/school/20251001090000_synthetic_reading.wav", "media/audio/feedback/fitness/20251001100000_synthetic_training.wav", "data/users/user_1/lifelog/nutrition/photos/ph_SyntheticBreakfast.jpg", "data/users/user_1/lifelog/nutrition/photos/ph_SyntheticBreakfast.thumb.jpg", "data/users/user_1/lifelog/nutrition/photos/ph_SyntheticLunch.jpg", "data/users/user_2/lifelog/nutrition/photos/ph_SyntheticBreakfast.jpg","media/school/language/korean-language-reels/synthetic-read/900001.mp4","media/school/language/korean-language-reels/synthetic-read/900002.mp4"].includes(row.destination));
      assert.equal(row.mtimeMs, 1759276800000);
      const stat = fs.lstatSync(file);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(file) === file);
      assert.equal(stat.size, row.byteLength); assert.equal(stat.mtimeMs, row.mtimeMs);
      assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), row.sha256);
      result.timedImageFixtures ??= [];
      result.timedImageFixtures.push({ destination: row.destination, sha256: row.sha256, byteLength: stat.size, mtimeMs: stat.mtimeMs });
    } else fs.writeFileSync(file, Buffer.from(row.base64, 'base64'), { flag: 'wx', mode: 0o600 });
  }
  for (const relative of fixtureDirectories) fs.mkdirSync(path.join(scratch,relative),{recursive:true});
  // Exact names-only menu projection: payload paths remain absent. No other fs call
  // or readdir option is intercepted, and the original directory stays empty.
  const originalReadDirectory = fs.readdirSync;
  const metadata = new Map(metadataDirectories.map(row=>{const dir=path.join(scratch,row.destination);fs.mkdirSync(dir,{recursive:true});assert.equal(fs.realpathSync(dir),dir);assert.equal(originalReadDirectory(dir).length,0);return [dir,row];}));
  if(metadata.size) fs.readdirSync = function(dir, options){
    const row=typeof dir==='string'&&metadata.get(dir);
    if(!row)return Reflect.apply(originalReadDirectory,this,arguments);
    assert.equal(options,undefined,'Metadata admits names-only readdir');
    return row.entries.map(entry=>entry.name);
  };
  for (const directory of ['media/logs', 'data/system/history/ai-usage']) fs.mkdirSync(path.join(scratch, directory), { recursive: true });
  for(const [dir,row] of metadata){
    assert.deepEqual(fs.readdirSync(dir),row.entries.map(e=>e.name));
    assert.deepEqual(originalReadDirectory(dir),[]);
    assert.throws(()=>fs.readdirSync(dir,{withFileTypes:true}),/names-only/);
    for(const entry of row.entries){assert.equal(fs.existsSync(path.join(dir,entry.name)),false);assert.throws(()=>fs.readFileSync(path.join(dir,entry.name)),error=>error.code==='ENOENT');}
  }
  if(metadata.size){assert.deepEqual(fs.readdirSync(path.join(scratch,'media/logs')),originalReadDirectory(path.join(scratch,'media/logs')));result.metadataDirectoryControls={exactNames:true,nonmatchingCallsOriginal:true,audioPayloadsAbsent:true,nonNameOptionsDenied:true};}
  const { initConfigService, configService } = await imported('backend/src/0_system/config/index.mjs');
  const { createSecretsProvider } = await imported('backend/src/1_adapters/secrets/createSecretsProvider.mjs');
  await initConfigService(path.join(scratch, 'data'), { secretsProviderFactory: createSecretsProvider });
  result.phases.push('actual-config-and-secrets'); save();
  const { initializeLogging } = await imported('backend/src/0_system/logging/dispatcher.mjs');
  const { createConsoleTransport } = await imported('backend/src/0_system/logging/transports/console.mjs');
  const { createLogger } = await imported('backend/src/0_system/logging/logger.mjs');
  initializeLogging({ defaultLevel: 'info', timezone: configService.getTimezone() }).addTransport(createConsoleTransport({ colorize: false, format: 'json' }));
  const logger = createLogger({ source: 'backend', component: 'readiness-real-app' });
  result.phases.push('actual-logging-console'); save();
  // Native import of the exact Express package that the backend resolves.
  const expressPath = fs.realpathSync(path.join(sourceRoot, 'backend/node_modules/express/index.js'));
  const { default: express } = await import(pathToFileURL(expressPath).href);
  const layerObservations = new WeakMap();
  const layerIds = new WeakMap();
  let nextLayerId = 1;
  const layerId = layer => { if (!layerIds.has(layer)) layerIds.set(layer, nextLayerId++); return layerIds.get(layer); };
  const restores = [];
  for (const holder of [express.application, express.Router.prototype]) {
    const original = holder.use;
    holder.use = function (...args) {
      const beforeLength = this.stack?.length;
      const returned = Reflect.apply(original, this, args);
      const first = args[0];
      const hasPath = typeof first === 'string' || first instanceof RegExp || Array.isArray(first) && first.flat(Infinity).every(p => typeof p === 'string' || p instanceof RegExp);
      const handlers = (hasPath ? args.slice(1) : args).flat(Infinity);
      const paths = hasPath ? [first].flat(Infinity) : ['/'];
      // Router.use appends the actual Layers; app.use delegates to it.
      // Binding only Router stacks avoids reading/creating app.router early.
      if (beforeLength !== undefined) for (const layer of this.stack.slice(beforeLength)) {
        layerObservations.set(layer, { paths }); layerId(layer);
      }
      return returned;
    };
    restores.push(() => { holder.use = original; });
  }
  let app;
  const server = createServer();
  assert.equal(server.listening, false);
  try {
    const { createApp } = await imported('backend/src/app.mjs');
    result.phases.push('actual-app-import'); save();
    app = await createApp({ server, logger, configPaths: { dataDir: path.join(scratch, 'data'), configDir: path.join(scratch, 'data/system/config') }, configExists: true, enableScheduler: false, enableMqtt: false });
  } finally { for (const restore of restores.reverse()) restore(); }
  assert.equal(server.listening, false);
  result.phases.push('actual-createApp-returned');
  let gratitudeSnapshot;
  if(gratitudeCase){
    const scope=fs.existsSync(path.join(sourceRoot,'modules/gratitude/server/rendering/GratitudeCardRenderer.mjs'))?'backend/src/0_system/libraries/gratitudeRuntime.mjs':'backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs';
    const nativeRequire=createRequire(pathToFileURL(path.join(sourceRoot,scope)));const resolved=fs.realpathSync(nativeRequire.resolve('moment-timezone'));assert.equal(nativeRequire.cache[resolved]?.loaded,true,'Actual native moment must already be loaded');const moment=nativeRequire(resolved);
    const bytes=fs.readFileSync(resolved);const resolvedMoment={path:resolved,sha256:createHash('sha256').update(bytes).digest('hex')};const contract=gratitudeCase.generatedGratitudePngContract;assert.ok(Object.values(contract.momentBindings).some(b=>JSON.stringify(b)===JSON.stringify(resolvedMoment)),'Reviewed actual moment binding');
    const nativeFontPath=configService.getPath('font')+'/roboto-condensed/RobotoCondensed-Regular.ttf';assert.equal(nativeFontPath,path.join(scratch,'media/fonts/roboto-condensed/RobotoCondensed-Regular.ttf'));const fontBytes=fs.readFileSync(nativeFontPath);assert.equal(fontBytes.length,144196);assert.equal(createHash('sha256').update(fontBytes).digest('hex'),'c318f47fe2ec114266cab50c9712d20acb2275516b51538d1a83862bdfc12e59');result.gratitudeFont={path:nativeFontPath,sha256:createHash('sha256').update(fontBytes).digest('hex'),byteLength:fontBytes.length};
    gratitudeSnapshot=()=>{const sampleStart=Date.now(),sample=moment(),sampleEpoch=sample.valueOf(),formatted=sample.format('ddd, D MMM YYYY, h:mm A'),sampleEnd=Date.now();const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(sampleEpoch)).map(p=>[p.type,p.value]));assert.equal(formatted,`${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`);assert.equal(moment.locale(),'en');assert.equal(moment.defaultZone,null);assert.equal(process.env.TZ,'America/Los_Angeles');return{locale:moment.locale(),defaultZone:moment.defaultZone,timezone:process.env.TZ,resolvedMoment,sampleStart,sampleEnd,sampleEpoch,formatted};};
    result.gratitudeRuntime={before:gratitudeSnapshot()};
  }
  const routes = [], unresolved = [], mounted = [];
  const visit = (router, prefixes, ancestors) => {
    if (ancestors.has(router)) { unresolved.push({ prefixes, reason: 'recursive router identity' }); return; }
    const nextAncestors = new Set([...ancestors, router]);
    const stack = router.stack ?? router.router?.stack ?? [];
    for (const [order, layer] of stack.entries()) {
      if (layer.route) {
        routes.push({ layerId: layerId(layer), prefixes, order, path: layer.route.path, methods: Object.keys(layer.route.methods).filter(m => layer.route.methods[m]), fullPaths: typeof layer.route.path === 'string' ? prefixes.map(prefix => `${prefix === '/' ? '' : prefix.replace(/\/$/, '')}${layer.route.path === '/' ? '' : layer.route.path}` || '/') : null }); continue;
      }
      const record = layerObservations.get(layer);
      if (!record) { if (layer.handle?.stack) unresolved.push({ layerId: layerId(layer), prefixes, order, reason: 'no observed .use Layer registration', name: layer.name }); continue; }
      const strings = record.paths.filter(p => typeof p === 'string');
      for (const p of record.paths.filter(p => typeof p !== 'string')) unresolved.push({ layerId: layerId(layer), prefixes, order, reason: 'non-string observed mount; no regexp decoding', value: String(p) });
      const expanded = prefixes.flatMap(prefix => strings.map(p => `${prefix === '/' ? '' : prefix.replace(/\/$/, '')}${p === '/' ? '' : p}` || '/'));
      mounted.push({ layerId: layerId(layer), prefixes: expanded, order, handlerName: layer.handle?.name ?? null, traversableRouter: Boolean(layer.handle?.stack) });
      if (expanded.length && layer.handle?.stack) visit(layer.handle, expanded, nextAncestors);
      else if (expanded.length) unresolved.push({ layerId: layerId(layer), prefixes: expanded, order, reason: 'opaque middleware; may delegate a router, not classified as absent', name: layer.name });
    }
  };
  visit(app, ['/'], new Set());
  result.graph = { routes, mounted, unresolved, observation: 'Delegated .use calls bound to actual newly appended Layers; no handler-identity cross-product or regexp reconstruction', serverListening: server.listening };
  result.phases.push('actual-mounted-graph-enumerated'); save();
  const {createServerRequestHandler}=await imported('backend/src/4_api/serverRequestHandler.mjs');
  server.on('request',createServerRequestHandler({app}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(43129,'127.0.0.1',resolve);});
  assert.equal(server.address().address,'127.0.0.1');assert.equal(server.address().port,43129);
  result.phases.push('actual-loopback-listener-ready');save();
  fs.writeFileSync(path.join(scratch,'ready.json'),JSON.stringify({port:43129,address:'127.0.0.1',fixture:'eleven synthetic config files; no live writable configuration',scope:result.scope}));
  await new Promise(resolve=>setTimeout(resolve,30000));
  if(gratitudeSnapshot)result.gratitudeRuntime.after=gratitudeSnapshot();
  result.completed=true;result.termination='deliberate bounded exit after 30s actual listener; not natural shutdown';save();process.exit(0);
} catch(error){fail(error);}
