/** Adjudicate static HTTP assembly against source; no runtime composition import. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const api = read('assembled-api.json'), review = read('registration-review.json');
const graph = read('dependency-ledger.json');
const inputs = new Map();
function source(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  inputs.set(file, {path: file, sha256: hash(text)});
  return text;
}
function at(file, token, occurrence = 0) {
  const text = source(file);
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) offset = text.indexOf(token, offset + 1);
  assert.ok(offset >= 0, 'Source anchor missing: ' + file + ':' + token);
  return {path: file, line: text.slice(0, offset).split('\n').length, anchor: token};
}
const appFile = 'backend/src/app.mjs', routerRoot = 'backend/src/4_api/v1/routers/';
const apiFile = routerRoot + 'api.mjs';
const appText = source(appFile);
const mainMount = at(appFile, "app.use('/api/v1', apiRouter)");
const errorHandler = at('backend/src/0_system/http/middleware/errorHandler.mjs', 'export function errorHandlerMiddleware');
const routeLoop = at(apiFile, 'router.use(path, routers[key])');
assert.equal(review.apiAssignments.filter(r => r.spread).length, 0, 'New spreads require activation review');
const unpopulatedKeys = api.roots.filter(r => !r.origins.length).map(r => {
  assert.equal(review.apiAssignments.filter(a => a.key === r.key).length, 0);
  return {key: r.key, mount: r.mount, classification: 'not supplied by this composition',
    evidence: routeLoop, semantics: 'The truthy-router condition omits this map entry; another app/middleware handler can still answer the URL.'};
});
assert.deepEqual(unpopulatedKeys.map(r => r.key).sort(), ['messaging', 'queries', 'tts']);
assert.equal(api.gaps.length, 0, 'New interpreter gaps require explicit review');

const special = new Map([
  ['life.mjs:15', ['identity-middleware', 'createUsernameResolver validates lifeApi-resolved username, then assigns req.lifeUsername; unknown user is 404.',
    'backend/src/4_api/v1/routers/life/identity.mjs']],
  ['life.mjs:18', ['observation-middleware', 'Registers response finish logging, then next; does not mount a child router.']],
  ['school.mjs:118', ['capability-middleware', 'Injects capabilityProof into absent body.pin, except /teacher/auth/; then next.']],
  ['schoolCalc.mjs:36', ['authentication-middleware', 'Composition supplies createSchoolCalcIngressAuthenticator; checks relay header and authorization, refuses 401 or stamps frozen ingress ID.',
    'backend/src/4_api/v1/middleware/schoolCalcIngress.mjs', 'backend/src/5_composition/modules/schoolCalc.mjs']],
  ['language.mjs:63', ['alias-middleware', 'Only the /language mount adds Deprecation: true and logs the legacy route; /sentence-ladder shares handlers without that header.']],
  ['nutribot.mjs:38', ['observation-middleware', 'Tracing middleware stamps correlation state; not a child router.',
    'backend/src/0_system/http/middleware/tracing.mjs']],
  ['pianoGames.mjs:17', ['finite-computed-mount', 'Two opaque AST arguments represent one mount, not two middleware handlers. Explicit nativeRouters has chess; safeSegment validates its key. See finite-native-piano-router binding.',
    'backend/src/5_composition/modules/pianoGames.mjs']],
  ['api.mjs:183', ['conditional-prefix-handler', 'plexProxyHandler exists only with media library host and token, reuses contentProxyService.proxy(plex), and is mounted via USE after the map iteration.']]
]);
const middleware = api.middleware.map((r, index) => {
  source(r.path);
  const local = r.path.slice(routerRoot.length);
  let disposition = special.get(local + ':' + r.line);
  if (!disposition && r.expression.startsWith('express.json(')) disposition = ['body-parser',
    'Local express.json parser; preserve options and position. Earlier global parsing/strictness is not undone by local strict:false.'];
  if (!disposition && r.expression.startsWith('errorHandlerMiddleware(')) disposition = ['error-middleware',
    'Shared four-argument error translator; invocation options and ordered position are preserved.', errorHandler.path];
  if (!disposition && /^\((err|error), req, res, (next|_next)\)/.test(r.expression)) disposition = ['error-middleware',
    'Local four-argument error handler/translator; preserve body/status mapping and next(error) behavior at this source location.'];
  if (!disposition && local === 'proxy.mjs') {
    if (r.expression === 'resizePlexThumbnail') disposition = ['url-rewrite',
      'Positive finite w/h and non-/photo path rewrite req.url before the following Plex passthrough; then next.'];
    if (r.expression.startsWith('requiredPassthrough(')) disposition = ['required-prefix-handler',
      'USE accepts all matching methods; absent dependency returns 503; thrown error ends started response or delegates next(error).'];
    if (r.expression.startsWith('placeholderPassthrough(')) disposition = ['optional-prefix-handler',
      'USE accepts all matching methods; absent/failing dependency sends 200 cached SVG unless headers already sent.',
      'backend/src/0_system/proxy/placeholders.mjs'];
  }
  assert.ok(disposition, 'Unreviewed middleware: ' + local + ':' + r.line);
  const [classification, behavior, ...files] = disposition;
  for (const file of files) source(file);
  return {id: 'API-MIDDLEWARE-' + index, ...r, classification, behavior,
    supportingSources: files, state: 'source-adjudicated; not proof of live activation',
    fullPatterns: classification === 'finite-computed-mount' ? ['/api/v1/piano-games/chess']
      : r.localPatterns.map(p => [...r.chain, p].join('/').replace(/\/+/g, '/')),
    dispatch: classification.includes('prefix-handler') ? 'USE; method-independent prefix match' : 'ordered middleware/mount'};
});
assert.equal(middleware.length, 50);
const roleByLine = new Map([
  [508, 'COOP/COEP response headers'], [513, 'Default CORS; normal preflight ends before route dispatch'],
  [514, 'JSON body parsing, 50mb default strict'], [515, 'URL-encoded body parsing, 50mb extended'],
  [518, 'WebSocket-path next(route) handling; not an HTTP websocket upgrade implementation'],
  [528, 'Build metadata endpoint; disk or checkout fallback'],
  [536, 'Missing-config catchall 500 except /ws/; createApp returns before all later registrations'],
  [574, 'Request logger before auth'], [581, 'Device resolver'], [595, 'Household resolver'],
  [598, 'Network trust resolver'], [601, 'Token resolver'], [604, 'Permission gate'],
  [1032, 'Legacy admin router; outside /api/v1 auth prefix; currently supplies eventBus, not eventBusAdministration'],
  [5774, 'Direct agent-memory router, after native agent mounts'], [5781, 'Direct agent-meta router'],
  [6386, 'Nutribot dev webhook proxy'], [6387, 'Journalist dev webhook proxy'],
  [6388, 'Homebot dev webhook proxy'], [6389, 'Fitness dev webhook proxy'],
  [6443, 'Docker/existing dist conditional static assets'],
  [6457, 'Docker SPA fallback before final API; skips /api/v1, /ws and known final-segment asset suffixes'],
  [6494, 'Final /api/v1 router mount'], [6502, 'Final shared object-shaped error translator']
]);
const appStack = review.appMiddleware.map(r => {
  assert.ok(roleByLine.has(r.line), 'Unreviewed global stack registration: ' + r.line);
  return {...r, role: roleByLine.get(r.line), branch: r.line > 536 ? 'requires configured branch (earlier return otherwise)' : 'before/within configuration guard'};
});
assert.equal(appStack.length, 24);
assert.ok(!appStack.some(r => r.pattern === 'canvasBasePath'), 'Settings getter is not an HTTP route');

const helperFile = 'backend/src/4_api/v1/agents/mountAgentHttp.mjs';
const nativeInstall = at(appFile, 'mountAgentHttp(app, {');
const conciergeInstall = at(appFile, 'mountAgentHttp(app, {', 1);
const helperRoutes = ['run', 'run-stream', 'run-background'].map(suffix => ({
  id: 'API-HELPER-NATIVE-' + suffix.toUpperCase(), method: 'POST',
  fullPattern: '/api/v1/agents/${agentId}/' + suffix,
  patternKind: 'source template, instantiated once per orchestrator.list() ID; NOT a request :agentId matcher',
  source: at(helperFile, 'router.post(`/${agentId}/' + suffix + '`'), install: nativeInstall,
  activation: at(appFile, 'for (const { id: agentId } of agentsServices.orchestrator.list())'),
  middleware: 'global /api/v1 auth chain; this binding supplies no extra authMiddleware; inherited final app error translator',
  wire: 'backend/src/4_api/v1/agents/wireFormats/native.mjs'
}));
for (const [method, suffix] of [['POST', '/chat/completions'], ['GET', '/models']]) helperRoutes.push({
  id: 'API-HELPER-CONCIERGE-' + (method === 'GET' ? 'MODELS' : 'CHAT'), method,
  fullPattern: '/v1' + suffix, patternKind: 'literal', source: at(helperFile, `router.${method.toLowerCase()}('${suffix}'`),
  install: conciergeInstall, activation: 'try/catch around service creation, auth construction and mount; failures log concierge.mount_failed',
  middleware: 'global CORS/body parsers, then supplied satelliteBearerAuth; outside /api/v1 permission pipeline; final app error translator after downstream fallthrough',
  wire: 'backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.mjs'
});
for (const r of helperRoutes) source(r.wire);
source('backend/src/4_api/v1/agents/middlewares/satelliteBearerAuth.mjs');
source('backend/src/4_api/v1/middleware/createDevProxy.mjs');
appStack.push({id: 'APP-HELPER-NATIVE', ...nativeInstall, role: 'Native agent helper mounts', helperIds: helperRoutes.slice(0, 3).map(r => r.id)});
appStack.push({id: 'APP-HELPER-CONCIERGE', ...conciergeInstall, role: 'Concierge helper mount, before static fallback', helperIds: helperRoutes.slice(3).map(r => r.id)});
appStack.sort((a, b) => a.line - b.line);

const effectfulHeadExamples = ['CASE-GR-WIRE-HEAD-EVENT', 'CASE-REG-ADMIN-METHODS'];
const endpoints = api.endpoints.map(r => {
  const direct = r.mountSources.find(m => m.path === appFile && m.mechanism === 'direct app.use, outside routeMap');
  return {id: r.id, source: {path: r.path, line: r.line},
    appMount: direct || mainMount, localStack: r.routerIdentity, registrationOrder: r.registrationOrder,
    localMiddlewareIds: middleware.filter(m => m.routerIdentity === r.routerIdentity
      && JSON.stringify(m.chain) === JSON.stringify(r.chain.slice(0, -1))).map(m => m.id),
    parentMounts: r.mountSources, parentMiddlewareRule: 'At each mount source, preserve preceding middleware and later error handlers in its parent stack; do not flatten away mount order.',
    consumerEdges: graph.edges.filter(e => e.target === r.path).map(e => e.id)};
});
emit('api-registration-audit.json', {schema: 'daylight.preimplementation.api-registration-audit/v1', baseline: api.baseline,
  toolHash: hash(fs.readFileSync(new URL(import.meta.url))),
  inventoryInputs: ['assembled-api.json', 'registration-review.json', 'dependency-ledger.json'].map(name => ({name, sha256: hash(fs.readFileSync(path.join(packet, name)))})),
  reviewer: 'investigation lead; source review and executable helper tests, not independent approval',
  counts: {mapRoots: api.roots.length, resolvedFactories: 76, unpopulatedKeys: 3,
    ordinaryRegistrations: api.endpoints.length, adjudicatedMiddlewareArguments: middleware.length,
    helperPatterns: helperRoutes.length, explicitAppGetRoutes: review.appMiddleware.filter(r => r.operation === 'get').length},
  unpopulatedKeys, appStack, mainMount, routeLoop, middleware, helperRoutes, endpoints,
  directGetRoutes: review.appMiddleware.filter(r => r.operation === 'get'),
  implicitMethods: {
    HEAD: 'Express GET supplies HEAD if no earlier handler/explicit HEAD intercepts. Body suppression does not suppress handler side effects.',
    OPTIONS: 'Router fallback can advertise matching methods only when no earlier handler ends the request. Global default cors() currently ends ordinary preflight with 204; ALL and USE can intercept in router-only projections.',
    optionalSyntax: 'Keep original Express patterns such as {/:location} and {/*splat}; these represent alternatives, not literal brace URLs.',
    effectfulHeadExamples, evidenceCases: ['CASE-GR-WIRE-HEAD', 'CASE-GR-WIRE-OPTIONS', 'CASE-GR-WIRE-CORS', 'CASE-REG-CONCIERGE-WIRE']
  },
  quirks: [
    {id: 'HTTP-QUIRK-LEGACY-ADMIN', evidence: at(appFile, "app.use('/admin/ws', createEventBusRouter({ eventBus"),
      behavior: 'Factory expects eventBusAdministration. Current direct binding supplies eventBus; checked endpoints return 503. Do not fix this in a relocation commit.'},
    {id: 'HTTP-QUIRK-ROOT-GET', evidence: at(routerRoot + 'admin/eventbus.mjs', "if (req.method === 'GET' && Object.keys(req.query).length === 0)"),
      behavior: 'GET root with no query calls next; it does NOT redirect to /status despite the comment. ALL root can otherwise rewrite and broadcast.'},
    {id: 'HTTP-QUIRK-PROXY-ALIAS', evidence: at(appFile, 'if (mediaLibConfig?.host && mediaLibConfig?.token)'),
      behavior: 'Legacy /api/v1/plex_proxy requires host/token and reuses the proxy service; separate from /api/v1/proxy/plex optionality.'}
  ],
  inputs: [...inputs.values()],
  limitations: ['Complete source registration accounting is not configuration-specific activation or whole-controller runtime parity.',
    'Caller-supplied agent IDs remain symbolic source templates; no private provider/agent configuration is read.',
    'Local helper tests use synthetic capabilities. Real auth, proxy upstreams, production CORS/static handling and deployment remain separate gates.',
    'External websocket protocols and provider/scheduler lifecycle accounting are separate PRE-2.2.3 work.']
});
process.stdout.write(JSON.stringify({artifact: 'api-registration-audit.json', ordinary: endpoints.length,
  middleware: middleware.length, helpers: helperRoutes.length, unpopulated: unpopulatedKeys.length}) + '\n');
