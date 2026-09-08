/** Source-only registration provenance; never evaluate application composition. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const source = read('source-ledger.json');
const graph = read('dependency-ledger.json');
const registrations = read('registrations.json');
const {parse} = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const selected = source.files.filter(f => /^(backend\/src|frontend\/src|shared|cli)\//.test(f.path)
  && /\.(mjs|js|jsx|ts|tsx)$/.test(f.path) && !/\.(test|spec)\./.test(f.path) && f.mode !== '120000');
const catalogs = [], browserRoutes = [], appMiddleware = [], bindings = [], mountAugmentations = [],
  providers = [], dispatches = [], calls = [], parseErrors = [], imperativeNavigation = [];
const known = new Set(['appDefs', 'APP_REGISTRY', 'OPTION_RESOLVERS', 'APP_EDITORS', 'ADMIN_ID_TO_APP',
  'HOUSEHOLD_APP_CONFIGS', 'CONTENT_FORMAT_COMPONENTS', 'MEDIA_PLAYBACK_FORMATS', 'GAMING_PRESENTERS',
  'PARTY_GAMES_HOST_REGISTRY', 'EXPERIENCE_REGISTRY', 'BUILTIN_MODULES', 'LEGACY_MODULE_ALIASES', 'SURROUND_BUILTIN_MODULES',
  'REGISTRY_KEYS', 'LEGACY_ID_MAP']);
const key = n => n?.name ?? n?.value ?? null;
for (const file of selected) {
  const text = fs.readFileSync(path.join(root, file.path), 'utf8');
  const excerpt = node => node ? text.slice(node.start, node.end) : null;
  const reference = node => ({source: file.id, path: file.path, line: node.loc.start.line});
  let ast;
  try { ast = parse(text, {sourceType: 'unambiguous', plugins: ['jsx',
    ...(/\.tsx?$/.test(file.path) ? ['typescript'] : []), 'decorators-legacy'], allowReturnOutsideFunction: true}); }
  catch (error) { parseErrors.push({...reference({loc:{start:{line: error.loc?.line || 1}}}), error: error.message}); continue; }
  const incoming = graph.edges.filter(e => e.target === file.path).map(e => e.id);
  const objects = (node, name) => {
    const value = node?.type === 'CallExpression' || node?.type === 'NewExpression' ? node.arguments[0] : node;
    if (value?.type !== 'ObjectExpression' && value?.type !== 'ArrayExpression') return;
    catalogs.push({id: 'CATALOG-' + file.id + '-' + value.start, ...reference(value), name,
      entries: value.type === 'ObjectExpression' ? value.properties.map(p => ({
        key: p.computed ? null : key(p.key), expression: excerpt(p.value || p.argument), line: p.loc.start.line,
        unresolvedSpread: p.type === 'SpreadElement'})) : value.elements.map(p => ({key: key(p), expression: excerpt(p)})),
      consumers: incoming, state: 'literal declaration; installation is recorded separately, not inferred from export'});
  };
  function walk(node, ancestors = [], routeParents = []) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, ancestors, routeParents)); return; }
    let nextRoutes = routeParents;
    if (node.type === 'VariableDeclarator' && (known.has(node.id?.name) ||
      /(?:registry|builtins)\.[cm]?[jt]sx?$/.test(file.path) && /REGISTRY|PRESENTERS|COMPONENTS/.test(node.id?.name || '')))
      objects(node.init, node.id.name);
    if (node.type === 'ExportDefaultDeclaration' && /(?:^|\/)manifest\.[cm]?[jt]s$/.test(file.path)
      && node.declaration.type === 'ObjectExpression') {
      providers.push({id: 'MANIFEST-' + file.id, ...reference(node),
        fields: node.declaration.properties.map(p => ({key: key(p.key), expression: excerpt(p.value || p.argument)})),
        importedBy: incoming, state: 'provider declaration only; loader conditions and instance creation remain independent'});
    }
    if (node.type === 'VariableDeclarator' && node.id?.name === 'manifest' && node.init?.type === 'ObjectExpression'
      && file.path.startsWith('frontend/src/modules/Fitness/widgets/')) {
      providers.push({id: 'MANIFEST-' + file.id, ...reference(node),
        fields: node.init.properties.map(p => ({key: key(p.key), expression: excerpt(p.value || p.argument)})),
        importedBy: incoming, state: 'inline Fitness widget metadata; not a backend adapter provider'});
    }
    if (node.type === 'JSXElement' && node.openingElement.name?.name === 'Route') {
      const opening = node.openingElement;
      const attrs = Object.fromEntries(opening.attributes.filter(a => a.type === 'JSXAttribute')
        .map(a => [a.name.name, a.value?.type === 'StringLiteral' ? a.value.value : a.value ? excerpt(a.value) : true]));
      const routePath = opening.attributes.find(a => a.name?.name === 'path');
      const literal = routePath?.value?.type === 'StringLiteral' ? routePath.value.value : null;
      const expression = routePath?.value?.expression;
      const mapped = expression?.type === 'Identifier' ? [...ancestors].reverse().find(n =>
        n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && n.callee.property.name === 'map'
        && n.callee.object.type === 'ArrayExpression'
        && n.arguments[0]?.params?.[0]?.name === expression.name) : null;
      const finitePatterns = mapped && mapped.callee.object.elements.every(e => e?.type === 'StringLiteral')
        ? mapped.callee.object.elements.map(e => e.value) : literal === null ? [] : [literal];
      const parentPath = routeParents.at(-1)?.fullPattern ?? '';
      const fullPattern = literal?.startsWith('/') ? literal : literal === null && !routePath ? parentPath
        : literal !== null && parentPath !== null ? (parentPath + '/' + literal).replace(/\/+/g, '/') : null;
      const row = {id: 'BROWSER-ROUTE-' + file.id + '-' + node.start, ...reference(node), attributes: attrs,
        owningFunction: [...ancestors].reverse().find(n => /Function/.test(n.type))?.id?.name ?? '<module>',
        parents: routeParents.map(r => r.id), localPattern: literal, finitePatterns, fullPattern, index: attrs.index === true,
        state: 'syntactic nested Route chain; owning component mount/base must also be resolved',
        gapId: 'BROWSER-MOUNT-' + file.id, owner: 'browser-composition-reviewer', importedBy: incoming};
      browserRoutes.push(row); nextRoutes = [...routeParents, row];
    }
    if (node.type === 'VariableDeclarator' && node.id?.name === 'v1Routers' && node.init?.type === 'ObjectExpression')
      for (const p of node.init.properties) bindings.push({id: 'API-BIND-' + file.id + '-' + p.start, ...reference(p),
        key: key(p.key), expression: excerpt(p.value || p.argument), spread: p.type === 'SpreadElement'});
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' && node.left.object.name === 'v1Routers')
      bindings.push({id: 'API-BIND-' + file.id + '-' + node.start, ...reference(node), key: key(node.left.property),
        expression: excerpt(node.right),
        conditions: ancestors.filter(n => n.type === 'IfStatement').map(n => ({line: n.loc.start.line, expression: excerpt(n.test)}))});
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && node.callee?.type === 'Identifier'
      && (/^(register|unregister|subscribe|unsubscribe)[A-Z]/.test(node.callee.name)
        || /^(setInterval|clearInterval|setTimeout|clearTimeout|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback|queueMicrotask|useEffect|useLayoutEffect)$/.test(node.callee.name)))
      calls.push({id: 'REG-CALL-' + file.id + '-' + node.start, ...reference(node), operation: node.callee.name,
        receiver: null, key: node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : null,
        firstArgument: excerpt(node.arguments[0])?.slice(0, 240), consumers: incoming,
        state: 'named registration function call; loop/alias expansion must be reconciled with its catalog'});
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type)
      && ['MemberExpression', 'OptionalMemberExpression'].includes(node.callee?.type)) {
      const operation = key(node.callee.property);
      const receiver = excerpt(node.callee.object);
      const first = node.arguments[0];
      const pattern = first?.type === 'StringLiteral' ? first.value : null;
      if (file.path === 'backend/src/app.mjs' && receiver === 'app'
        && ['use', 'get', 'post', 'put', 'patch', 'delete', 'all', 'head', 'options'].includes(operation)
        && !(operation === 'get' && node.arguments.length === 1))
        appMiddleware.push({id: 'APP-STACK-' + node.start, ...reference(node), operation, pattern,
          arguments: node.arguments.map(a => /Function/.test(a.type) ? `<handler at line ${a.loc.start.line}>` : excerpt(a)),
          conditions: ancestors.filter(n => n.type === 'IfStatement').map(n => ({line: n.loc.start.line, expression: excerpt(n.test)})),
          order: appMiddleware.length});
      if (receiver?.startsWith('v1Routers.') && operation === 'use') mountAugmentations.push({
        id: 'API-AUGMENT-' + file.id + '-' + node.start, ...reference(node), receiver, pattern,
        handlers: node.arguments.slice(1).map(excerpt), state: 'ordered post-factory nested mount; must not be lost by factory-only scan'});
      if (file.path.startsWith('frontend/') && /^(pushState|replaceState)$/.test(operation || ''))
        imperativeNavigation.push({id: 'BROWSER-HISTORY-' + file.id + '-' + node.start, ...reference(node),
          operation, receiver, target: excerpt(node.arguments[2]), consumers: incoming,
          state: 'imperative history writer; URL parser and installed outer route remain authoritative'});
      if (/^(register(?:[A-Z].*)?|unregister(?:[A-Z].*)?|subscribe|subscribeAuthorized|unsubscribe|onStatusChange|on|once|off|emit|publish|broadcast|addListener|removeListener|addEventListener|removeEventListener|schedule(?:[A-Z].*)?|start|stop|dispose|close|disconnect|connect|setInterval|clearInterval|setTimeout|clearTimeout|requestAnimationFrame|cancelAnimationFrame|requestIdleCallback|cancelIdleCallback|queueMicrotask|useEffect|useLayoutEffect)$/.test(operation || ''))
        calls.push({id: 'REG-CALL-' + file.id + '-' + node.start, ...reference(node), operation, receiver,
          key: pattern, firstArgument: pattern === null ? excerpt(first)?.slice(0, 240) : pattern,
          implementation: node.arguments[1]?.type === 'Identifier' ? node.arguments[1].name : null,
          function: [...ancestors].reverse().find(n => /Function/.test(n.type))?.id?.name ?? null,
          conditions: ancestors.filter(n => n.type === 'IfStatement').map(n => n.loc.start.line),
          consumers: incoming, state: 'source call; invocation/order/teardown pairing must be reviewed per affected seam'});
    }
    if (file.path.startsWith('cli/') && node.type === 'SwitchStatement') dispatches.push({
      id: 'CLI-DISPATCH-' + file.id + '-' + node.start, ...reference(node), selector: excerpt(node.discriminant),
      cases: node.cases.map(c => ({label: c.test ? excerpt(c.test) : '<default>', line: c.loc.start.line})),
      state: 'static CLI dispatch; command bodies not executed'});
    for (const [name, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(name))
      walk(value, [...ancestors, node], nextRoutes);
  }
  walk(ast.program);
}
const byCatalog = name => catalogs.find(c => c.name === name);
const adapterManifests = providers.filter(p => p.path.startsWith('backend/src/1_adapters/'));
const widgetManifests = providers.filter(p => p.path.startsWith('frontend/src/modules/Fitness/widgets/'));
const appIds = byCatalog('APP_REGISTRY')?.entries.map(e => e.key) || [];
const contentIds = byCatalog('appDefs')?.entries.map(e => e.key) || [];
const map = registrations.apiMountTable.entries;
const apiBindings = map.map(entry => ({mount: '/api/v1' + entry.key, routerKey: entry.value,
  mountSource: {path: registrations.apiMountTable.source, line: entry.line},
  assignments: bindings.filter(b => b.key === entry.value),
  spreadCandidates: bindings.filter(b => b.spread).map(b => b.id),
  gapId: 'API-FACTORY-' + entry.value, owner: 'api-composition-reviewer',
  state: entry.value === 'gratitude' ? 'exact factory-to-router chain documented in registration-review.md'
    : 'binding provenance captured; full factory/conditional/nested chain still requires resolution'}));
emit('registration-review.json', {schema: 'daylight.preimplementation.registration-review/v1', baseline: source.baseline,
  parsedFiles: selected.length - parseErrors.length, parseErrors, catalogs, browserRoutes,
  appMiddleware, apiBindings, apiAssignments: bindings, mountAugmentations,
  providerManifests: adapterManifests, widgetManifests,
  lifecycleCalls: calls, cliDispatches: dispatches, imperativeNavigation,
  catalogReconciliation: {appContainerIds: appIds, contentAppIds: contentIds,
    browserOnly: appIds.filter(id => !contentIds.includes(id)), contentOnly: contentIds.filter(id => !appIds.includes(id)),
    note: 'Distinct installed contracts; do not add missing content registrations during filesystem migration'},
  limitations: ['Static declarations are not installed runtime instances',
    'Factory nesting, computed manifests/loaders and cross-component browser bases retain explicit gaps',
    'Express implicit HEAD/OPTIONS and global cors/body-parser translation require their own contract assertions',
    'No global controller, provider, schedule or CLI command was evaluated']});
registrations.review = {artifact: 'registration-review.json', narrative: 'registration-review.md',
  assembledApi:'assembled-api.json', apiAudit:'api-registration-audit.json', assembledBrowser:'assembled-browser.json',
  providerLifecycle:'provider-lifecycle-review.json', lifecycleAccounting:'lifecycle-closure.json',
  catalogs: catalogs.length, nestedBrowserDeclarations: browserRoutes.length,
  apiBindings: apiBindings.length, postFactoryMounts: mountAugmentations.length,
  providerManifests: adapterManifests.length, widgetManifests: widgetManifests.length,
  lifecycleCalls: calls.length, cliDispatches: dispatches.length};
emit('registrations.json', registrations);
process.stdout.write(JSON.stringify(registrations.review) + '\n');
