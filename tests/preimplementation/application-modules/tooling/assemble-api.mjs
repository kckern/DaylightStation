/** Limited static factory-return interpreter. Reads ASTs; executes no product code. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root, packet, emit} from './census.mjs';
const require = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'));
const {parse} = require('@babel/parser');
const importedTraverse = require('@babel/traverse');
const traverse = importedTraverse.default || importedTraverse;
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const graph = read('dependency-ledger.json');
const registrations = read('registrations.json');
const files = new Map();
const fixtures = new Map([
  ['<fixture>/leaf.mjs', "import express from 'express'; export function create(){ const router=express.Router(); for(const family of ['one','two']) router.get(`/items/${family}`, ()=>{}); return router; }"],
  ['<fixture>/wrapper.mjs', "import {create} from './leaf.mjs'; export function wrap(){ return create(); } export function projected(){return {router:create()};} export async function dynamic(){ const {create}=await import('./leaf.mjs'); return create(); } export function assigned(){let module=null; module=projected();return module.router;}"],
  ['<fixture>/cycle-a.mjs', "export {create} from './cycle-b.mjs';"],
  ['<fixture>/cycle-b.mjs', "export {create} from './cycle-a.mjs';"],
]);
const key = node => node?.name ?? node?.value ?? null;
const ref = p => ({path: p.hub.file.opts.filename, line: p.node.loc.start.line});
const describe = p => p ? ({...ref(p), expression: p.hub.file.code.slice(p.node.start, p.node.end).slice(0, 300)}) : null;
const importTarget = (file, specifier) => fixtures.has(file) && specifier.startsWith('.')
  ? path.posix.join(path.posix.dirname(file), specifier)
  : graph.edges.find(e => e.from === file && e.specifier === specifier && e.kind === 'source')?.target;
function getFile(file) {
  if (files.has(file)) return files.get(file);
  const text = fixtures.get(file) ?? fs.readFileSync(path.join(root, file), 'utf8');
  const ast = parse(text, {sourceType: 'unambiguous', plugins: ['jsx', 'decorators-legacy']});
  // Babel's standalone traverse lacks a file hub; supply only immutable provenance.
  const hub = {file: {opts: {filename: file}, code: text}, getCode: () => text, buildError: (_, message) => new Error(message)};
  const data = {file, text, ast, exports: new Map(), program: null};
  files.set(file, data);
  traverse(ast, {
    enter(p) { p.hub = hub; },
    Program(p) { p.hub = hub; data.program = p; },
    ExportDefaultDeclaration(p) { p.hub = hub; data.exports.set('default', p.get('declaration')); },
    ExportNamedDeclaration(p) {
      p.hub = hub;
      const d = p.get('declaration');
      if (d.node?.id?.name) data.exports.set(d.node.id.name, d);
      if (d.isVariableDeclaration()) for (const declaration of d.get('declarations'))
        if (declaration.node.id.type === 'Identifier') data.exports.set(declaration.node.id.name, declaration.get('init'));
      for (const specifier of p.get('specifiers')) {
        const target = p.node.source ? importTarget(file, p.node.source.value) : null;
        data.exports.set(key(specifier.node.exported), target
          ? {reexport: target, name: key(specifier.node.local)} : specifier.get('local'));
      }
    },
  });
  return data;
}
function withHub(p, owner) { if (p && !p.hub) p.hub = owner.hub; return p; }
function child(p, name) {
  const value = p.get(name);
  return Array.isArray(value) ? value.map(v => withHub(v, p)) : withHub(value, p);
}
const issue = (p, reason) => ({kind: 'unresolved', ...describe(p), reason});
function exported(file, name, selectors, stack, env, invokeArgs = null) {
  const marker = 'export:' + file + ':' + name + ':' + selectors.join('.') + ':' + (invokeArgs !== null);
  if (stack.includes(marker)) return [{kind: 'unresolved', path: file, reason: 'reexport-cycle:' + name}];
  const next = [...stack, marker];
  const target = getFile(file).exports.get(name);
  if (!target) return [{kind: 'unresolved', path: file, reason: 'export-not-resolved:' + name}];
  if (target.reexport) return exported(target.reexport, target.name, selectors, next, env, invokeArgs);
  target.hub ||= getFile(file).program.hub;
  return evaluate(target, selectors, next, env, invokeArgs);
}
function evaluate(p, selectors = [], stack = [], env = new Map(), invokeArgs = null) {
  if (!p?.node) return [];
  const marker = `${ref(p).path}:${p.type}:${p.node.start}:${p.node.end}:${selectors.join('.')}:${invokeArgs !== null}`;
  if (stack.includes(marker) || stack.length > 60) return [issue(p, 'recursive-or-depth-limited-expression')];
  const next = [...stack, marker];
  if (p.isAwaitExpression()) return evaluate(child(p, 'argument'), selectors, next, env, invokeArgs);
  if (p.isIdentifier()) {
    const binding = p.scope.getBinding(p.node.name);
    if (!binding) return [issue(p, 'unbound:' + p.node.name)];
    const b = withHub(binding.path, p);
    if (env.has(binding)) {
      const supplied = env.get(binding);
      return supplied.argument ? evaluate(supplied.argument, [...supplied.selectors, ...selectors], next, supplied.env, invokeArgs)
        : evaluate(supplied, selectors, next, env, invokeArgs);
    }
    if (b.isImportSpecifier() || b.isImportDefaultSpecifier()) {
      const declaration = b.parentPath;
      const specifier = declaration.node.source.value;
      if (specifier === 'express' && (b.isImportDefaultSpecifier() || key(b.node.imported) === 'Router'))
        return [{kind: selectors.length && selectors[0] !== 'Router' ? 'known-express-member' : 'express-constructor', ...describe(p)}];
      const target = importTarget(ref(p).path, specifier);
      return target ? exported(target, b.isImportDefaultSpecifier() ? 'default' : key(b.node.imported), selectors, next, env, invokeArgs)
        : [issue(p, 'external-or-unresolved-import:' + specifier)];
    }
    if (b.isVariableDeclarator()) {
      let projection = selectors;
      if (b.node.id.type === 'ObjectPattern') {
        const property = b.node.id.properties.find(n => key(n.value) === p.node.name || n.value?.left?.name === p.node.name);
        const rest = b.node.id.properties.find(n => n.type === 'RestElement' && n.argument.name === p.node.name);
        if (!property && !rest) return [issue(p, 'destructuring-not-resolved')];
        if (rest && b.node.id.properties.some(n => n.type !== 'RestElement' && key(n.key) === selectors[0]))
          return [issue(p, 'property-excluded-by-object-rest')];
        projection = property ? [key(property.key), ...selectors] : selectors;
      }
      const values = [child(b, 'init'), ...binding.constantViolations
        .filter(violation => violation.isAssignmentExpression() && violation.node.left.type === 'Identifier')
        .map(violation => child(withHub(violation, p), 'right'))];
      return values.flatMap(value => evaluate(value, projection, next, env, invokeArgs));
    }
    if (b.isFunction()) return evaluate(b, selectors, next, env, invokeArgs);
    return [issue(p, 'binding-not-resolved:' + b.type)];
  }
  if (p.isMemberExpression()) {
    const property = p.node.computed && p.node.property.type !== 'StringLiteral' ? null : key(p.node.property);
    return property === null ? [issue(p, 'computed-property-not-finite')]
      : evaluate(child(p, 'object'), [property, ...selectors], next, env, invokeArgs);
  }
  if (p.isObjectExpression()) {
    if (!selectors.length) return [issue(p, 'object-return-needs-projection')];
    const [selected, ...remaining] = selectors;
    const properties = child(p, 'properties');
    const explicit = properties.filter(prop => !prop.isSpreadElement() && key(prop.node.key) === selected);
    if (explicit.length) return explicit.flatMap(prop => evaluate(child(prop, 'value'), remaining, next, env, invokeArgs));
    const spread = properties.filter(prop => prop.isSpreadElement());
    return spread.length ? spread.flatMap(prop => evaluate(child(prop, 'argument'), selectors, next, env, invokeArgs))
      : [issue(p, 'missing-object-property:' + selected)];
  }
  if (p.isConditionalExpression() || p.isLogicalExpression()) {
    const names = p.isConditionalExpression() ? ['consequent', 'alternate'] : ['left', 'right'];
    return names.flatMap(name => evaluate(child(p, name), selectors, next, env, invokeArgs))
      .map(result => ({...result, conditional: true}));
  }
  if (p.isFunction()) {
    if (invokeArgs === null) return [{kind: 'function', pathRef: p}];
    const invocationEnv = new Map(env);
    child(p, 'params').forEach((parameter, index) => {
      if (parameter.isIdentifier() && invokeArgs[index]) invocationEnv.set(p.scope.getBinding(parameter.node.name), invokeArgs[index]);
      if (parameter.isAssignmentPattern() && parameter.node.left.type === 'Identifier')
        invocationEnv.set(p.scope.getBinding(parameter.node.left.name), invokeArgs[index] || child(parameter, 'right'));
      if (parameter.isObjectPattern() && invokeArgs[index]) for (const property of parameter.node.properties) {
        const name = property.value?.type === 'AssignmentPattern' ? property.value.left.name : property.value?.name;
        if (name) invocationEnv.set(p.scope.getBinding(name), {argument: invokeArgs[index], selectors: [key(property.key)], env});
      }
    });
    if (p.isArrowFunctionExpression() && !p.get('body').isBlockStatement())
      return evaluate(child(p, 'body'), selectors, next, invocationEnv);
    const returns = [];
    p.traverse({ReturnStatement(ret) {
      ret.hub = p.hub;
      if (ret.getFunctionParent() === p) returns.push(child(ret, 'argument'));
    }});
    return returns.flatMap(ret => evaluate(ret, selectors, next, invocationEnv));
  }
  if (p.isCallExpression() || p.isNewExpression()) {
    const callee = child(p, 'callee');
    if (callee.isImport()) {
      const specifier = p.node.arguments[0]?.type === 'StringLiteral' ? p.node.arguments[0].value : null;
      const target = specifier && importTarget(ref(p).path, specifier);
      return target && selectors.length ? exported(target, selectors[0], selectors.slice(1), next, env, invokeArgs)
        : [issue(p, 'dynamic-import-needs-finite-source-and-export')];
    }
    const isMemberRouter = callee.isMemberExpression() && key(callee.node.property) === 'Router';
    const constructors = evaluate(isMemberRouter ? child(callee, 'object') : callee, [], next, env);
    if (constructors.some(c => c.kind === 'express-constructor')) {
      if (selectors.length) return [issue(p, 'unexpected-property-on-router')];
      const declaration = p.parentPath;
      if (!declaration.isVariableDeclarator() || declaration.node.id.type !== 'Identifier')
        return [issue(p, 'anonymous-router-return')];
      return [{kind: 'router', file: ref(p).path, receiver: declaration.node.id.name,
        binding: declaration.scope.getBinding(declaration.node.id.name), env, line: p.node.loc.start.line}];
    }
    const functions = constructors.filter(c => c.kind === 'function');
    return functions.length ? functions.flatMap(c => evaluate(c.pathRef, selectors, next, env, child(p, 'arguments')))
      : constructors.length ? constructors : [issue(p, 'call-return-not-resolved')];
  }
  return [issue(p, 'unsupported-expression:' + p.type)];
}
const app = getFile('backend/src/app.mjs');
const assignments = new Map();
let initial = null;
const augmentations = new Map();
const nativeBindings = [], directApiMounts = [];
app.program.traverse({
  enter(p) { p.hub = app.program.hub; },
  VariableDeclarator(p) { if (p.node.id.name === 'v1Routers') initial = child(p, 'init'); },
  AssignmentExpression(p) {
    if (p.node.left.type === 'MemberExpression' && p.node.left.object.name === 'v1Routers') {
      const name = key(p.node.left.property);
      const entries = assignments.get(name) || []; entries.push(child(p, 'right')); assignments.set(name, entries);
    }
  },
  CallExpression(p) {
    if (p.node.callee.name === 'createPianoGamesModule') {
      const argument = child(p, 'arguments')[0];
      if (argument?.isObjectExpression()) {
        const native = child(argument, 'properties').find(prop => key(prop.node.key) === 'nativeRouters');
        if (native?.node.value.type === 'ObjectExpression') for (const entry of child(child(native, 'value'), 'properties'))
          nativeBindings.push({key: key(entry.node.key), value: child(entry, 'value'), source: describe(entry)});
      }
    }
    if (p.node.callee.object?.name === 'app' && key(p.node.callee.property) === 'use'
      && p.node.arguments[0]?.type === 'StringLiteral'
      && (p.node.arguments[0].value.startsWith('/api/v1/') || p.node.arguments[0].value === '/admin/ws'))
      directApiMounts.push(p);
    const receiver = p.node.callee.object;
    if (key(p.node.callee.property) === 'use' && receiver?.type === 'MemberExpression' && receiver.object.name === 'v1Routers') {
      const name = key(receiver.property); const entries = augmentations.get(name) || []; entries.push(p); augmentations.set(name, entries);
    }
  },
});
const endpoints = [], gaps = [], middleware = [], roots = [];
function patterns(p) {
  if (p?.isStringLiteral()) return [p.node.value];
  if (p?.isTemplateLiteral() && p.node.expressions.length === 0) return [p.node.quasis[0].value.cooked];
  if (p?.isTemplateLiteral()) {
    let expanded = [p.node.quasis[0].value.cooked];
    for (let index = 0; index < p.node.expressions.length; index++) {
      const expression = p.node.expressions[index];
      const loop = p.findParent(parent => parent.isForOfStatement() && parent.node.left.type === 'VariableDeclaration'
        && parent.node.left.declarations.some(d => d.id.name === expression.name)
        && parent.node.right.type === 'ArrayExpression');
      const values = expression.type === 'Identifier' && loop
        && loop.node.right.elements.every(element => element?.type === 'StringLiteral')
        ? loop.node.right.elements.map(element => element.value) : [];
      if (!values.length || expanded.length * values.length > 128) return [];
      expanded = expanded.flatMap(prefix => values.map(value => prefix + value + p.node.quasis[index + 1].value.cooked));
    }
    return expanded;
  }
  if (p?.isArrayExpression()) return child(p, 'elements').flatMap(patterns);
  return [];
}
function callsFor(origin) {
  return origin.binding.referencePaths.flatMap(reference => {
    reference.hub ||= getFile(origin.file).program.hub;
    const member = reference.parentPath;
    if (!member.isMemberExpression() || !member.parentPath.isCallExpression()) return [];
    member.parentPath.hub ||= reference.hub;
    return [member.parentPath];
  }).sort((a, b) => a.node.start - b.node.start);
}
function expand(origin, chain, active = [], extraCalls = [], mountSources = []) {
  const identity = origin.file + ':' + origin.line + ':' + origin.receiver;
  if (active.includes(identity)) { gaps.push({chain, reason: 'router-mount-cycle', identity}); return; }
  const calls = [...callsFor(origin), ...extraCalls];
  for (const [registrationOrder, call] of calls.entries()) {
    const method = key(call.node.callee.property);
    if (!['use', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'route'].includes(method)) continue;
    const args = child(call, 'arguments');
    if (origin.file === 'backend/src/4_api/v1/routers/api.mjs' && method === 'use'
      && args[0]?.node.name === 'path' && args[1]?.node.object?.name === 'routers') continue;
    const localPatterns = patterns(args[0]);
    if (method !== 'use') {
      if (!localPatterns.length || method === 'route') { gaps.push({chain, ...describe(call), reason: 'computed-regexp-or-chained-route'}); continue; }
      for (const pattern of localPatterns) endpoints.push({id: 'API-ENDPOINT-' + createHash('sha256')
        .update(JSON.stringify([chain, pattern, method, ref(call), call.node.start])).digest('hex').slice(0, 20), chain: [...chain, pattern],
        fullPattern: [...chain, pattern].join('/').replace(/\/+/g, '/'), method: method.toUpperCase(), ...describe(call),
        handlers: args.slice(1).map(describe),
        routerIdentity: identity, registrationOrder, mountSources,
        guards: call.getAncestry().filter(p => p.isIfStatement()).map(p => describe(child(p, 'test'))),
        registrationPhase: call.getFunctionParent()?.scope === origin.binding.scope ? 'factory body' : 'nested scope; review timing',
        implicitHead: method === 'get', state: 'statically reachable route; runtime conditions/middleware may prevent installation or handling'});
      continue;
    }
    const mountedPatterns = localPatterns.length ? localPatterns : ['/'];
    const handlers = localPatterns.length ? args.slice(1) : args;
    for (const handler of handlers) {
      const outcomes = evaluate(handler, [], [], origin.env || new Map());
      const routers = [...new Map(outcomes.filter(result => result.kind === 'router')
        .map(r => [r.file + ':' + r.line + ':' + r.receiver, r])).values()];
      if (routers.length) for (const mount of mountedPatterns) for (const router of routers)
        expand(router, [...chain, mount], [...active, identity], [], [...mountSources,
          {pattern: mount, ...describe(call), routerIdentity: identity, registrationOrder}]);
      else middleware.push({chain, localPatterns: mountedPatterns, ...describe(handler),
        registration: describe(call), handlerIndex: handlers.indexOf(handler),
        routerIdentity: identity, registrationOrder, mountSources,
        state: 'middleware or unresolved router-valued expression; inspect before declaring affected chain complete',
        diagnostics: outcomes.filter(r => r.kind === 'unresolved').map(({pathRef, ...r}) => r)});
    }
  }
}
for (const mount of registrations.apiMountTable.entries) {
  const key = mount.value;
  const expressions = assignments.get(key);
  const results = expressions?.length ? expressions.flatMap(p => evaluate(p)) : evaluate(initial, [key]);
  const origins = results.filter(r => r.kind === 'router');
  const unique = [...new Map(origins.map(r => [r.file + ':' + r.line, r])).values()];
  roots.push({mount: '/api/v1' + mount.key, key,
    origins: unique.map(({binding, env, ...o}) => o),
    diagnostics: results.filter(r => r.kind === 'unresolved').map(({pathRef, ...r}) => r),
    status: unique.length ? 'factory return resolved statically' : 'unresolved factory return'});
  for (const origin of unique) expand(origin, ['/api/v1', mount.key], [], augmentations.get(key) || [],
    [{path: registrations.apiMountTable.source, line: mount.line, pattern: mount.key,
      binding: key, mechanism: 'ordered routeMap iteration; router.use(path, routers[key]) only when supplied'}]);
}
const reviewedBindings = [];
for (const native of nativeBindings) {
  assert.match(native.key, /^[a-zA-Z0-9_-]+$/);
  const origins = evaluate(native.value).filter(result => result.kind === 'router');
  const pianoMount = registrations.apiMountTable.entries.find(m => m.value === 'piano-games');
  for (const origin of origins) expand(origin, ['/api/v1', '/piano-games', '/' + native.key], [], [],
    [{path: registrations.apiMountTable.source, line: pianoMount.line, pattern: pianoMount.key,
      binding: 'piano-games', mechanism: 'ordered routeMap iteration'},
    {path: 'backend/src/4_api/v1/routers/pianoGames.mjs', line: 17, pattern: '/' + native.key,
      bindingSource: native.source, mechanism: 'finite nativeRouters dictionary; router.use with safeSegment(gameId)'}]);
  reviewedBindings.push({kind: 'finite-native-piano-router', key: native.key, source: native.source,
    basis: ['backend/src/app.mjs', 'backend/src/5_composition/modules/pianoGames.mjs', 'backend/src/4_api/v1/routers/pianoGames.mjs'],
    origins: origins.map(({binding, env, ...origin}) => origin),
    limit: 'Source-reviewed explicit nativeRouters dictionary and safeSegment key; not arbitrary computed-module interpretation'});
}
for (const call of directApiMounts) {
  const args = child(call, 'arguments');
  for (const handler of args.slice(1)) {
    const routerKey = handler.node.object?.name === 'v1Routers' ? key(handler.node.property) : null;
    if (!routerKey && args[0].node.value !== '/admin/ws') continue;
    const origins = (routerKey ? (assignments.get(routerKey) || []).flatMap(p => evaluate(p))
      : evaluate(handler)).filter(result => result.kind === 'router');
    for (const origin of origins) expand(origin, [args[0].node.value], [], [],
      [{...describe(call), pattern: args[0].node.value, mechanism: 'direct app.use, outside routeMap'}]);
    reviewedBindings.push({kind: 'direct-app-api-router', key: routerKey || 'legacy-admin-eventbus', source: describe(call),
      mount: args[0].node.value, origins: origins.map(({binding, env, ...origin}) => origin)});
  }
}
for (const origin of exported('backend/src/4_api/v1/routers/api.mjs', 'createApiRouter', [], [], new Map(), [])
  .filter(result => result.kind === 'router')) expand(origin, ['/api/v1']);
const selfChecks = [];
for (const name of ['wrap', 'projected', 'dynamic', 'assigned']) {
  const result = exported('<fixture>/wrapper.mjs', name, name === 'projected' ? ['router'] : [], [], new Map(), []);
  assert.equal(result.filter(r => r.kind === 'router').length, 1, name);
  selfChecks.push({case: 'STATIC-RESOLVE-' + name, result: 'passed'});
}
const leaf = exported('<fixture>/leaf.mjs', 'create', [], [], new Map(), []).find(r => r.kind === 'router');
const route = callsFor(leaf).find(p => key(p.node.callee.property) === 'get');
assert.deepEqual(patterns(child(route, 'arguments')[0]), ['/items/one', '/items/two']);
selfChecks.push({case: 'STATIC-FINITE-TEMPLATE', result: 'passed'});
assert.ok(exported('<fixture>/cycle-a.mjs', 'create', [], [], new Map(), []).some(r => r.reason?.startsWith('reexport-cycle')));
selfChecks.push({case: 'STATIC-REEXPORT-CYCLE', result: 'rejected-as-expected'});
const gratitude = endpoints.filter(e => e.chain[1] === '/gratitude');
assert.equal(gratitude.length, 18);
assert.equal(gratitude.at(-1).fullPattern, '/api/v1/gratitude/card/print{/:location}');
selfChecks.push({case: 'STATIC-GRATITUDE-MOUNT-PATTERNS', result: 'passed; reconciles the separate actual HTTP pack'});
assert.equal(new Set(endpoints.map(e => e.id)).size, endpoints.length, 'Duplicate endpoint identity requires explicit registration review');
selfChecks.push({case: 'STATIC-ENDPOINT-IDENTITIES', result: 'passed'});
emit('assembled-api.json', {schema: 'daylight.preimplementation.assembled-api/v1', baseline: registrations.baseline,
  method: 'Babel lexical bindings/import exports/factory returns/object projections; no application evaluation',
  roots, endpoints, middleware, gaps, selfChecks, reviewedBindings,
  inputs: [...files.values()].filter(f => !fixtures.has(f.file)).map(f => ({path: f.file,
    sha256: createHash('sha256').update(f.text).digest('hex')})),
  inventoryInputs: ['dependency-ledger.json', 'registrations.json', 'registration-review.json'].map(name => ({name,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(packet, name))).digest('hex')})),
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
  limitations: ['Conditional branches produce possible routes, not proof of installation',
    'Computed properties/regexp/chained routes and opaque class getters remain explicit diagnostics',
    'Unresolved router-valued use arguments are not silently promoted to harmless middleware',
    'Global app middleware/direct mounts remain in registration-review.json',
    'Static interpreter is preparation tooling, not the future production resolver or a runtime mount test']});
process.stdout.write(JSON.stringify({mounts: roots.length, resolved: roots.filter(r => r.origins.length).length,
  endpoints: endpoints.length, gaps: gaps.length, middlewareOrUnknown: middleware.length}) + '\n');
