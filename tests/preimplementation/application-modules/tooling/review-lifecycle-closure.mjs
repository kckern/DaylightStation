/** Source-only lifetime and CLI registration accounting; never import entrypoints. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const review = read('registration-review.json'), providers = read('provider-lifecycle-review.json');
const graph = read('dependency-ledger.json'), ledger = read('source-ledger.json');
const {parse} = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = new Map();
const consumers = file => graph.edges.filter(e => e.target === file).map(e => ({edge:e.id, path:e.from, line:e.line}));
function source(file) {
  const value = fs.readFileSync(path.join(root, file), 'utf8');
  inputs.set(file, {path:file, sha256:hash(value)}); return value;
}
function at(file, token) {
  const text = source(file), offset = text.indexOf(token);
  assert.ok(offset >= 0, 'Missing source anchor: ' + file + ':' + token);
  return {path:file, line:text.slice(0, offset).split('\n').length, anchor:token};
}
const policies = [
  ['backend/src/0_system/http/middleware/requestLogger.mjs', 'if (recorded) return;', 'res.on(\'close\', record)',
    'Request-scoped finish and close listeners share a recorded guard; only one log is emitted. No explicit listener removal; response object owns lifetime.'],
  ['backend/src/0_system/utils/FileIO.mjs', "writer.on('finish'", "writer.on('error'",
    'Image-download helper owns writer finish/error promise handlers; no explicit off. Stream completion/error determines lifetime, not a product singleton. Other FileIO exports are not given a subscription lifecycle by sharing this file.'],
  ['backend/src/1_rendering/lib/CanvasFactory.mjs', 'export async function initCanvas', 'return { canvas, ctx, createNodeCanvas }',
    'Each call imports canvas, attempts primary/extra registerFont before creating canvas, catches font errors, and returns canvas/context. Font registration is process-global; no deregistration/cache guard in this source. Preserve native-module and resource identity.'],
  ['backend/src/3_applications/events/RealtimePublications.mjs', 'export class GratitudeEvents', 'return { item, payload }',
    'Publication wrappers invoke injected publishers; they do not acquire subscriptions. Split only GratitudeEvents from four other owner publications; keep payload/time and exactly-once semantics.'],
  ['frontend/src/contexts/WebSocketContext.jsx', 'const unsubscribeStatus =', 'unsubscribeMessages();',
    'Effect releases both returned subscriptions; provider retains one payload callback slot, not a listener set. Indicator timeout is not cleared here; unsubscribing does not disconnect shared transport.'],
  ['frontend/src/lib/api.mjs', 'export const DaylightWebsocketSubscribe', 'activeWebsockets.delete(path)',
    'Legacy path-specific WebSockets are distinct from WebSocketService. Duplicate path returns existing unsubscribe without adding the new callback. Unsubscribe closes only OPEN sockets; CONNECTING is not cancelled. DaylightWebsocketUnsubscribe itself constructs a separate socket.'],
  ['frontend/src/lib/logging/Logger.js', 'export const startDiagnostics', 'export const stopDiagnostics',
    'Singleton diagnostic state owns recursive rAF, report interval and jank probes. Same cadence start is idempotent; changed cadence re-arms interval. Stop cancels frame/interval, stops probes and clears exposed diagnostics. Do not conflate with transport lifetime.'],
  ['frontend/src/lib/logging/index.js', 'function createBufferingWebSocketTransport', 'const scheduleFlush =',
    'Both transports lazily import/connect the shared WebSocket singleton. Buffered transport coalesces a flush timeout and drains on send/flush; no timer cancellation or transport dispose API is returned.'],
  ['frontend/src/lib/logging/inputRecorder.js', 'export function startRecorder', 'export function stopRecorder',
    'Start clears prior drain interval and resets ring; stop clears interval, flushes remaining batch and nulls sendFn. Deferred idle callbacks are not cancelled but guard sendFn; recording can continue in the ring.'],
  ['frontend/src/lib/logging/jankProbes.js', 'export function startJankProbes', 'export function stopJankProbes',
    'Start first stops old probes. Loop interval plus feature-detected performance observers are stopped/disconnected and counters reset. Failed observer construction is caught; no feature support is inferred.'],
  ['frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx', 'load().catch', 'useHotkeys([',
    'Load effect has no cancellation; useUnsavedGuard owns unload state and Mantine useHotkeys owns keyboard registration. Preserve imported hook/provider instance identity; not an extra app-wide handler.'],
  ['frontend/src/modules/Admin/shared/CrudTable.jsx', 'const handleClickAway', "document.removeEventListener('mousedown'",
    'Pending-row effect defers attaching click-away via zero-timeout; cleanup clears timeout and removes same handler. No handler when no pending row.'],
  ['frontend/src/modules/Admin/shared/useUnsavedGuard.js', 'registry.register(id, dirty)', 'return () => registry.unregister(id)',
    'Dirty state updates registry by useId; independent cleanup unregisters ID. beforeunload is attached only while dirty, with same-handler removal. Null registry fallback and context singleton are preserved.'],
  ['frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx', 'registerPayloadCallback(handleWebSocketPayload)', 'return () => unregisterPayloadCallback()',
    'Payload/key/long-press/input-reset effects have explicit cleanup as source shows. Bootstrap/focus/scroll effects do not create teardown handles. Action/highlight/animation timeouts are not comprehensively cancelled; delayed writes after unmount remain baseline. All call IDs below retain individual locations.'],
  ['frontend/src/services/WebSocketService.js', 'subscribe(filter, callback)', 'this.subscribers.delete(key)',
    'Shared singleton owns reconnect/stale/reload timers and status listeners. Returned unsubscribers remove logical listeners only. disconnect closes transport but onclose can re-arm reconnect; it does not clear every timer. No comprehensive shutdown claim.']
].map(([file, start, stop, behavior], i) => ({id:'LIFETIME-POLICY-'+String(i+1).padStart(2,'0'),
  file, start:at(file,start), cleanupOrCompletion:at(file,stop), behavior, consumers:consumers(file)}));
const policyByFile = new Map(policies.map(p => [p.file,p.id]));
const affectedCalls = providers.affectedCalls.map(c => {
  assert.ok(policyByFile.has(c.path), 'Unreviewed affected lifecycle file: '+c.path);
  return {...c, lifetimePolicy:policyByFile.get(c.path)};
});
assert.equal(affectedCalls.length, 96);

// CLI parser declarations and callback-style lifecycles not represented by .on().
const cliFiles = ledger.files.filter(f => f.path.startsWith('cli/') && f.mode!=='120000'
  && /\.(mjs|js|jsx|ts|tsx|py|sh)$/.test(f.path) && !/\.(test|spec)\./.test(f.path));
const supplemental = [], terminationDeclarations = [], terminationCalls = [], scheduleDeclarations = [], cli = [], astFiles = new Set([...policyByFile.keys(), ...cliFiles.filter(f=>/\.[cm]?[jt]sx?$/.test(f.path)).map(f=>f.path),
  'backend/src/app.mjs','backend/src/5_composition/bootstrap.mjs','backend/src/5_composition/serverMain.mjs']);
const key = n => n?.name ?? n?.value;
for (const file of astFiles) {
  const text = source(file);
  const ast = parse(text,{sourceType:'unambiguous',plugins:['jsx',...(/\.tsx?$/.test(file)?['typescript']:[]),'decorators-legacy']});
  const item = {path:file, consumers:consumers(file), argv:[], parserDeclarations:[], dispatches:review.cliDispatches.filter(d=>d.path===file)};
  const location = n => ({path:file,line:n.loc.start.line,endLine:n.loc.end.line});
  const ref = n => n ? {...location(n),type:n.type} : null;
  function walk(n, ancestors=[]) {
    if (!n || typeof n!=='object') return;
    if (Array.isArray(n)) { for(const v of n)walk(v,ancestors); return; }
    const name=key(n.callee?.property) || n.callee?.name;
    const scope=ancestors.filter(p=>/Function|Method/.test(p.type)).at(-1);
    const guards=ancestors.filter(p=>p.type==='IfStatement').map(p=>ref(p.test));
    if(file==='backend/src/app.mjs' && ['CallExpression','OptionalCallExpression'].includes(n.type)
      && ['stop','dispose','flush'].includes(name))
      terminationCalls.push({...location(n),operation:name,receiver:text.slice(n.callee.start,n.callee.end),guards});
    if (file.startsWith('cli/')) {
      if (n.type==='MemberExpression' && n.object?.name==='process' && key(n.property)==='argv') item.argv.push(location(n));
      if (['CallExpression','OptionalCallExpression'].includes(n.type) && /^(command|option|requiredOption|argument|arguments|action|parse|parseAsync|parseArgs|yargs|usage|demandCommand|choices|positional)$/.test(name||''))
        item.parserDeclarations.push({...location(n),operation:name, syntax:n.arguments[0]?.type==='StringLiteral'?n.arguments[0].value:null,
          arguments:n.arguments.map(ref), scope:ref(scope), guards});
    }
    if (n.type==='AssignmentExpression' && n.left?.type==='MemberExpression' && /^on[a-z]/.test(key(n.left.property)||''))
      supplemental.push({...location(n),kind:'event-property-assignment',property:key(n.left.property),callback:ref(n.right),scope:ref(scope),guards});
    if (n.type==='NewExpression' && /^(WebSocket|EventSource|Worker|SharedWorker|PerformanceObserver|ResizeObserver|MutationObserver|IntersectionObserver)$/.test(name||''))
      supplemental.push({...location(n),kind:'effectful-constructor',constructor:name,arguments:n.arguments.map(ref),scope:ref(scope),guards});
    if (['CallExpression','OptionalCallExpression'].includes(n.type)
      && /^(on[A-Z].*|subscribe[A-Z].*|start[A-Z].*|stop[A-Z].*|every|after|useHotkeys|listen|setClientSubscriptionAuthorizer)$/.test(name||''))
      supplemental.push({...location(n),kind:'named-lifecycle-helper',operation:name,arguments:n.arguments.map(ref),scope:ref(scope),guards});
    if(file==='backend/src/app.mjs' && ['CallExpression','OptionalCallExpression'].includes(n.type)
      && ['on','once'].includes(name) && ['process','server'].includes(n.callee?.object?.name))
      terminationDeclarations.push({...location(n),receiver:n.callee.object.name,operation:name,
        event:n.arguments[0]?.value,callbacks:n.arguments.slice(1).map(ref),guards});
    if(['backend/src/app.mjs','backend/src/5_composition/bootstrap.mjs'].includes(file)
      && n.type==='CallExpression' && ['registerTask','registerAgent'].includes(name))
      scheduleDeclarations.push({...location(n),operation:name,arguments:n.arguments.map(ref),guards,
        cronOrOrchestrator:n.arguments[1]?text.slice(n.arguments[1].start,n.arguments[1].end).slice(0,240):null});
    for(const [k,v] of Object.entries(n))if(!['loc','start','end','comments','tokens'].includes(k))walk(v,[...ancestors,n]);
  }
  walk(ast.program);
  if(file.startsWith('cli/'))cli.push({...item,disposition:item.argv.length||item.parserDeclarations.length||item.dispatches.length
    ?'argument/parser/dispatch contribution; preserve entry path and source guards; never executed here'
    :'CLI helper or self-contained command without recognized argument dispatch; incoming source edges identify use; no claim it is inert'});
}
for(const f of cliFiles.filter(f=>!astFiles.has(f.path))) {
  const text=source(f.path);
  cli.push({path:f.path,consumers:consumers(f.path),nonJavascript:true,
    argumentReferences:text.split('\n').flatMap((line,i)=>/sys\.argv|argparse|\bgetopts\b|\$[1-9@]/.test(line)?[{line:i+1}]:[]),
    disposition:'Non-JavaScript operator/helper source; stable path retained; command body not evaluated'});
}
const app='backend/src/app.mjs', bootstrap='backend/src/5_composition/bootstrap.mjs';
const lifetimes = [
  ['eventbus',bootstrap,'await eventBusInstance.start(httpServer)','backend/src/1_adapters/eventbus/WebSocketEventBus.mjs','async stop()',
    'stop clears ping interval and closes sockets/server. No application shutdown binding calls it in reviewed entrypoints; registered application callback arrays are not cleared by stop.'],
  ['pressure-mat',app,'const pressureMatAdapter = new PressureMatAdapter','backend/src/1_adapters/hardware/pressure-mat/PressureMatAdapter.mjs','start()',
    'start registers client-message handler and configured command subscriptions; no adapter-wide stop in source or app binding. Returned subscribePresence cleanup is a separate consumer lifetime.'],
  ['screen-content',app,'screenContentTracker.start()','backend/src/3_applications/devices/services/ScreenContentTracker.mjs','start()',
    'start subscribes presence without retaining returned cleanup; no stop method. Do not infer teardown from TTL-based data freshness.'],
  ['command-liveness',app,'commandHandlerLivenessService.start()','backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs','stop()',
    'Constructor subscribes once; stop is a flag/state reset, not unsubscribe. App does not wire stop.'],
  ['system-scheduler',app,'scheduler.start()','backend/src/0_system/scheduling/Scheduler.mjs','stop()',
    'App enableScheduler plus class Docker/ENABLE_CRON gate. Async initialize precedes interval creation; stop clears an existing interval only. No shutdown binding in app/main.'],
  ['ambient-scheduler',app,'ambientScheduler.start()','backend/src/3_applications/ambient/AmbientSchedulerService.mjs','stop()',
    'App enableScheduler gate. start arms every() and initial tick; stop invokes returned cancellation but does not cancel in-flight tick. No shutdown binding in app/main.'],
  ['agent-scheduler',bootstrap,'scheduler.registerAgent(agent, agentOrchestrator)','backend/src/1_adapters/scheduling/AgentAssignmentScheduler.mjs','stop()',
    'registerAgent/registerTask populate cron jobs and can start enabled interval; stop clears interval/jobs. No call to this scheduler stop is wired in reviewed app/main. Separate from the system scheduler class.'],
  ['entrypoint-monitor','backend/src/5_composition/serverMain.mjs','createEventLoopLagMonitor({ logger }).start()','backend/src/0_system/runtime/eventLoopLag.mjs','function stop()',
    'Entry starts memory watchdog and lag monitor without retaining all cleanup handles; unref is not cancellation. serverMain also installs crash handlers at import time and reads dotenv; never a passive test fixture.']
].map(([id,file,start,implementation,stop,behavior])=>({id:'LIFETIME-'+id,start:at(file,start),
  implementation:at(implementation,stop),behavior,consumers:consumers(implementation)}));
const eventBinds=review.lifecycleCalls.filter(c=>c.path===app&&['on','once'].includes(c.operation)&&['process','server'].includes(c.receiver));
const shutdownBindings=eventBinds.map(c=>{
  const declaration=terminationDeclarations.find(d=>d.line===c.line&&d.receiver===c.receiver);
  assert.ok(declaration,'Missing termination callback span: '+c.line);
  return {...c,declaration,callbackCalls:terminationCalls.filter(x=>declaration.callbacks.some(cb=>x.line>=cb.line&&x.line<=cb.endLine)),
    callbackOperations:review.lifecycleCalls.filter(x=>x.path===app
    && declaration.callbacks.some(cb=>x.line>=cb.line&&x.line<=cb.endLine)
    && ['stop','dispose'].includes(x.operation)).map(x=>x.id),
    note:'Exact lexical callback membership; conditional invocation is not a shutdown guarantee. Independent SIGTERM listeners are not an awaited aggregate disposer.'};
});
const scheduleCalls=review.lifecycleCalls.filter(c=>[app,bootstrap].includes(c.path)&&['registerTask','registerAgent'].includes(c.operation));
const scheduleBindings=scheduleCalls.map(c=>{
  const declaration=scheduleDeclarations.find(d=>d.path===c.path&&d.line===c.line);
  assert.ok(declaration,'Missing schedule declaration: '+c.path+':'+c.line);
  return {...c,declaration,
  scheduler:'backend/src/1_adapters/scheduling/AgentAssignmentScheduler.mjs',
  conditionSource:c.path==='backend/src/app.mjs'?'app service-availability guards plus shared agent scheduler enabled policy':'bootstrap agent/service/config guards plus enabled policy',
  declarationOnly:'Agent assignment IDs/schedules come from each registered instance; standalone tasks preserve literal keys and callback source. Disabled scheduler can still list registered jobs.'};});
at('backend/src/5_composition/policies/agentSchedulerEnabled.mjs','export');
at('backend/src/0_system/boot/installCrashHandlers.mjs','export function installCrashHandlers');
emit('lifecycle-closure.json',{schema:'daylight.preimplementation.lifecycle-closure/v1',baseline:review.baseline,
  policies,affectedCalls,supplemental:supplemental.map(s=>({...s,consumers:consumers(s.path)})),lifetimes,shutdownBindings,scheduleBindings,cli,
  inventoryDisposition:'Relevant provider/widget/affected/shared/composition/CLI registrations are source-associated. Existing missing cleanup is an explicit baseline disposition, not an inventory omission or a passed lifecycle test.',
  remainingVerification:['Each future affected lifecycle changeset must verify start/stop/repeated-start/failure sequencing using isolated capabilities.',
    'No comprehensive runtime teardown, live schedule activation or command execution is claimed. Missing shutdown must not be repaired incidentally.'],
  inputs:[...inputs.values()],inventoryInputs:['registration-review.json','provider-lifecycle-review.json','dependency-ledger.json','source-ledger.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url))) });
process.stdout.write(JSON.stringify({affectedCalls:affectedCalls.length,policies:policies.length,supplemental:supplemental.length,
  lifetimes:lifetimes.length,shutdownBindings:shutdownBindings.length,schedules:scheduleBindings.length,cliFiles:cli.length})+'\n');
