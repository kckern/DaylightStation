/** Add attributable unknowns and registration evidence without importing products. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, packet, emit } from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const source = read('source-ledger.json'),
  graph = read('dependency-ledger.json'),
  registrations = read('registrations.json');
const {
  parse
} = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const sourceByPath = new Map(source.files.map(f => [f.path, f]));
const owners=read('owner-boundaries.json');
const moves = new Map(owners.moves.map(f => [f.old, f]));
const printEntry=owners.publicEntries.find(e=>e.entry==='@daylight/gratitude/server/adapters/image-print-gateway');
if(!printEntry)throw new Error('Missing selected image-print public boundary');
for (const f of source.files) {
  const moved = moves.get(f.path);
  f.disposition = moved ? 'proposed Gratitude move; not performed' : f.mode === '120000' ? 'retain canonical symlink and target identity' : f.path.startsWith('docs/') ? 'retain documentation in canonical docs tree' : 'retain current path until owner-specific move approval';
  f.actualExecutable = f.mode === '120000' ? null : Boolean(fs.lstatSync(path.join(root, f.path)).mode & 0o111);
  f.classification = moved ? {
    owner: 'gratitude',
    category: 'product',
    runtime: moved.runtime,
    layer: moved.layer,
    context: moved.context,
    rank: moved.rank,
    visibility: 'private unless listed public entry',
    review: 'proposed, no approval implied'
  } : f.owner === 'documentation' ? {
    owner: 'documentation',
    runtime: 'none',
    layer: 'documentation',
    visibility: 'not executable'
  } : {
    state: 'unreviewed',
    unknownId: 'UNKNOWN-' + f.id,
    assignee: 'architecture-reviewer',
    nextAction: 'inspect symbols and incoming/outgoing edges before this source moves',
    blockedGate: f.path.startsWith('_extensions/') ? 'owner-specific satellite relocation' : 'owner-specific migration; global package adoption also needs dependency review'
  };
}
const key = n => n?.name ?? n?.value ?? null;
const catalogs = [],
  browserRoutes = [],
  lifecycle = [];
const knownObjects = new Set(['routeMap', 'APP_REGISTRY', 'OPTION_RESOLVERS', 'ADMIN_ID_TO_APP', 'HOUSEHOLD_APP_CONFIGS', 'APP_EDITORS']);
const files = source.files.filter(f => /\.(mjs|js|jsx|ts|tsx)$/.test(f.path) && !f.path.startsWith('docs/') && !/\.(test|spec)\./.test(f.path) && f.mode !== '120000');
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f.path), 'utf8');
  let ast;
  try {
    ast = parse(text, {
      sourceType: 'unambiguous',
      plugins: ['jsx', ...(/\.tsx?$/.test(f.path) ? ['typescript'] : []), 'decorators-legacy'],
      allowReturnOutsideFunction: true
    });
  } catch {
    continue;
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.type === 'VariableDeclarator' && knownObjects.has(node.id?.name)) {
      const value = node.init?.type === 'CallExpression' ? node.init.arguments[0] : node.init;
      if (value?.type === 'ObjectExpression') catalogs.push({
        id: 'CAT-' + f.id + '-' + node.start,
        source: f.id,
        path: f.path,
        line: node.loc.start.line,
        name: node.id.name,
        entries: value.properties.map(p => ({
          key: key(p.key),
          value: p.value?.type === 'StringLiteral' ? p.value.value : null,
          expression: p.value ? text.slice(p.value.start, p.value.end) : null,
          line: p.loc.start.line
        })),
        status: 'literal declaration; installed contribution must be reconciled'
      });
    }
    if (node.type === 'JSXOpeningElement' && node.name?.name === 'Route') browserRoutes.push({
      id: 'WEBROUTE-' + f.id + '-' + node.start,
      source: f.id,
      path: f.path,
      line: node.loc.start.line,
      attributes: node.attributes.map(a => ({
        name: a.name?.name,
        value: a.value?.value ?? (a.value ? text.slice(a.value.start, a.value.end) : true)
      })),
      status: 'JSX route declaration; nested parent/context not assembled',
      owner: 'browser-composition-reviewer',
      coverageGap: 'GAP-' + f.id
    });
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && /^(register|subscribe|unsubscribe|on|off|addJob|schedule|start|stop|close|dispose)$/.test(node.callee.property?.name || '')) lifecycle.push({
      id: 'LIFECYCLE-' + f.id + '-' + node.start,
      source: f.id,
      path: f.path,
      line: node.loc.start.line,
      operation: node.callee.property.name,
      receiver: text.slice(node.callee.object.start, node.callee.object.end),
      firstArgument: node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : null,
      status: 'static call candidate, not proof of invocation or matching teardown',
      owner: 'integration-reviewer',
      coverageGap: 'GAP-' + f.id
    });
    for (const [name, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(name)) walk(value);
  }
  walk(ast.program);
}
const routeMap = catalogs.find(c => c.path === 'backend/src/4_api/v1/routers/api.mjs' && c.name === 'routeMap');
registrations.apiMountTable = {
  source: routeMap.path,
  line: routeMap.line,
  outerMount: '/api/v1',
  condition: 'router exists at routers[key]; conditional absence is not registration',
  entries: routeMap.entries,
  exceptions: ['app.mjs agent mounts outside routeMap', 'nested router.use and middleware chains still require reconciliation'],
  gratitude: {
    fullMount: '/api/v1/gratitude',
    registeredMethods: ['GET', 'POST', 'DELETE'],
    automatic: 'Express GET supplies HEAD fallback; automatic OPTIONS depends on matched route stack',
    verified: '18 real route registrations, real API mount and permission gate exercised; HEAD/OPTIONS not yet executed'
  }
};
registrations.catalogs = catalogs;
registrations.browserRoutes = browserRoutes;
registrations.lifecycleCandidates = lifecycle;
for (const r of registrations.registrations) {
  r.owner = 'api-composition-reviewer';
  r.gapId = 'GAP-' + r.id;
  r.nextAction = 'resolve receiver and complete ordered mount/middleware chain before affected owner move';
}
emit('source-ledger.json', source);
emit('registrations.json', registrations);
const resources = read('assets-and-storage.json');
resources.hiddenInputs = source.files.filter(f => f.path.split('/').some(p => p.startsWith('.'))).map(f => ({
  source: f.id,
  path: f.path,
  disposition: f.disposition,
  mode: f.mode
}));
resources.effectiveBuild = {
  trackedPopulation: source.total,
  sourceRoots: source.counts.roots,
  ignoredRequirements: [{
    root: 'node_modules',
    present: fs.existsSync(path.join(root, 'node_modules')),
    requiredBy: 'root tools; tests read explicitly selected original install',
    policy: 'no install/symlink created in worktree'
  }, {
    root: 'backend/node_modules',
    present: fs.existsSync(path.join(root, 'backend/node_modules')),
    requiredBy: 'native backend dependencies',
    policy: 'original install is not image proof'
  }, {
    root: 'frontend/node_modules',
    present: fs.existsSync(path.join(root, 'frontend/node_modules')),
    requiredBy: 'React/Vite/Mantine',
    policy: 'test bridge only'
  }, {
    root: 'frontend/dist',
    present: fs.existsSync(path.join(root, 'frontend/dist')),
    requiredBy: 'production browser build',
    policy: 'generated build not captured or copied'
  }, {
    root: 'instance data/config/secrets/media',
    present: 'not traversed',
    requiredBy: 'installed controller only',
    policy: 'synthetic substitute; never source relocation'
  }],
  docker: {
    source: 'docker/Dockerfile',
    copies: ['shared/', 'backend/', 'frontend/', 'cli/', 'package*.json', 'scripts/install-git-hooks.mjs', 'docker/entrypoint.sh'],
    missingProposedRoots: ['modules/', 'capabilities/', 'platform/'],
    unfrozen: ['node image tag without digest', 'apk index/package selection', 'yt-dlp Git HEAD', 'global forever version', 'native libraries and deployment font overrides'],
    decision: 'DEC-PACKAGE-REAL-GRAPH'
  },
  coverage: 'tracked population complete; dynamic/generated runtime source not certified'
};
emit('assets-and-storage.json', resources);
const matrix = [];
for (const edge of graph.edges.filter(e => e.kind === 'source' && (moves.has(e.from) || moves.has(e.target)))) {
  const targetMove = moves.get(edge.target),
    fromMove = moves.get(edge.from);
  const printTarget=edge.target===printEntry.implementationSource;
  const printPort=edge.from===printEntry.implementationSource&&edge.target==='backend/src/3_applications/gratitude/ports/IImagePrintGateway.mjs';
  const printIO=edge.from===printEntry.implementationSource&&edge.target==='backend/src/0_system/utils/FileIO.mjs';
  const printDecision=printTarget||printPort||printIO;
  const relativeTarget=(targetMove&&fromMove)?path.posix.relative(path.posix.dirname(fromMove.new),targetMove.new):null;
  const selectedSpecifier=printTarget?(fromMove?(relativeTarget.startsWith('.')?relativeTarget:'./'+relativeTarget):printEntry.entry):
    printPort?relativeTarget:printIO?'@daylight/platform/server/system/utils/file-io':null;
  if(printTarget&&!fromMove&&!printEntry.consumers.includes(edge.from))throw new Error('Unreviewed image-print consumer '+edge.from);
  matrix.push({
    edge: edge.id,
    from: edge.from,
    newFrom: fromMove?.new || edge.from,
    line: edge.line,
    symbols: edge.symbols || [],
    oldSpecifier: edge.specifier,
    oldTarget: edge.target,
    newTarget: printIO?'platform/server/system/utils/FileIO.mjs':targetMove?.new || edge.target,
    ...(printDecision?{selectedSpecifier,decision:'DEC-PRINT-EXPORT',contractIds:printEntry.contractIds,
      acceptanceCaseIds:printEntry.caseIds,
      executionGate:'IMP-BASE.02, IMP-PKG, IMP-SHARED.04 and IMP-GR-MOVE.01; native candidate resolution and unchanged existing adapter test still required'}:{}),
    relationship: fromMove && targetMove ? 'same-owner relative (layer checked)' : targetMove ? 'external consumer → public entry required' : 'Gratitude → foundation public entry required',
    bindingOwner: edge.from.includes('composition') || edge.from === 'backend/src/app.mjs' ? 'installed composition' : fromMove ? 'gratitude' : 'consumer owner',
    status: printDecision?'exact import spelling selected; not approved or applied; policy/package/consumer verification still required':'proposed; exact public subpath unresolved unless publicEntries identifies target',
    blockingDecision: printDecision?'DEC-PRINT-EXPORT':fromMove && targetMove ? null : 'DEC-FOUNDATION-CLOSURE'
  });
}
emit('import-replacements.json', {
  schema: 'daylight.preimplementation.import-replacements/v1',
  baseline: source.baseline,
  entries: matrix,
  limits: ['resolved source imports only; URL/style/build/dynamic registrations separately inventoried', 'newTarget is source destination, not permission to import a private file', 'no automatic import rewrite applied']
});
process.stdout.write(JSON.stringify({
  apiMounts: routeMap.entries.length,
  catalogs: catalogs.length,
  browserRoutes: browserRoutes.length,
  lifecycleCandidates: lifecycle.length,
  importChanges: matrix.length,
  tracked: source.total
}) + '\n');
