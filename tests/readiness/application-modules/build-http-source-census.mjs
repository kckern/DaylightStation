#!/usr/bin/env node
// Offline source declarations, never an installed production denominator.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { METHODS } from 'node:http';
const require = createRequire(import.meta.url), parser = require('@babel/parser');
const sha = b => createHash('sha256').update(b).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
const roots = ['backend', 'modules', 'capabilities', 'frontend', '_extensions'];
const excluded = /(?:^|\/)(?:tests?|__tests__|__fixtures__|fixtures|__mocks__|node_modules|vendor|third_party|third-party|generated|dist|build|coverage|docs|\.gradle|\.git)(?:\/|$)|\.(?:test|spec|stories)\.[^/]+$/i;
const js = /\.(?:[cm]?js|jsx|tsx?|mts|cts)$/;
const verbs = new Set([...METHODS.map(x => x.toLowerCase()), 'all', 'use', 'route']);
const owner = file => /^(modules|capabilities)\//.test(file) ? file.split('/').slice(0, 2).join('/') : file.split('/')[0];
const walk = (n, parents, visit) => {
  if (!n?.type) return;
  visit(n, parents);
  for (const [k, v] of Object.entries(n)) {
    if (['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'tokens'].includes(k)) continue;
    if (Array.isArray(v)) { for (const child of v) if (child?.type) walk(child, [...parents, n], visit); }
    else if (v?.type) walk(v, [...parents, n], visit);
  }
};
export function inspect(text, file, maps = {}) {
  const ast = parser.parse(text, { sourceType: 'unambiguous', allowReturnOutsideFunction: true,
    plugins: ['jsx', 'typescript', 'decorators-legacy'] });
  const excerpt = n => n ? text.slice(n.start, n.end) : null;
  const ids = new Set(['app', 'router']);
  const imports = [], sites = [], helpers = [];
  const guardsFor = parents => parents.filter(p => ['IfStatement','ConditionalExpression','LogicalExpression','ForOfStatement','ForInStatement','ForStatement','SwitchCase','TryStatement'].includes(p.type))
    .map(p => ({ kind: p.type, line: p.loc.start.line, condition: p.test ? excerpt(p.test) : p.type === 'TryStatement' ? 'try/catch' : text.slice(p.start, Math.min(p.end, p.start + 170)) }));
  walk(ast, [], n => {
    if (n.type === 'ImportDeclaration') imports.push({ source: n.source.value,
      bindings: n.specifiers.map(x => ({ local: x.local.name, imported: x.imported?.name ?? x.type })) });
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'CallExpression'
      && (/Router$/.test(n.init.callee.name ?? '') || n.init.callee.property?.name === 'Router')) ids.add(n.id.name);
  });
  walk(ast, [], (n, parents) => {
    if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return;
    const c = n.callee;
    const helperName = c.type === 'Identifier' ? c.name : c.property?.name;
    if (helperName && /(?:Router|Routes?|Endpoint|Endpoints)$/.test(helperName)) helpers.push({ line: n.loc.start.line,
      callee: excerpt(c), expression: excerpt(n), guards: guardsFor(parents), unresolved: true,
      importedFrom: imports.find(x => x.bindings.some(b => b.local === helperName))?.source ?? null });
    if (!['MemberExpression', 'OptionalMemberExpression'].includes(c.type)) return;
    const method = c.computed ? c.property.value : c.property.name;
    let obj = c.object, routeArg;
    // A chain can contain several verbs: router.route('/x').get(h).post(h).
    while (obj.type === 'CallExpression' && obj.callee.type === 'MemberExpression') {
      if (obj.callee.property?.name === 'route') routeArg = obj.arguments[0];
      obj = obj.callee.object;
    }
    const receiver = excerpt(obj);
    const known = ids.has(obj.name) || /(?:^|\.)(?:\w*router|app)$/i.test(receiver) || /^v1Routers\./.test(receiver);
    const arg = routeArg ?? n.arguments[0];
    let literals = arg?.type === 'StringLiteral' ? [arg.value]
      : arg?.type === 'TemplateLiteral' && !arg.expressions.length ? [arg.quasis[0].value.cooked]
      : arg?.type === 'ArrayExpression' && arg.elements.every(e => e?.type === 'StringLiteral') ? arg.elements.map(e => e.value) : [];
    const routeLikePath = literals.length && literals.every(x => x.startsWith('/'));
    if (!verbs.has(method) && !(known && c.computed && method == null)) return;
    if (!known && !routeLikePath) return;
    if (method === 'get' && n.arguments.length === 1 && !routeArg) return; // app setting getter
    const guards = guardsFor(parents);
    const fn = [...parents].reverse().find(p => /Function|Method/.test(p.type));
    const handlers = n.arguments.slice(routeArg ? 0 : 1).map(a => text.slice(a.start, Math.min(a.end, a.start + 240)));
    sites.push({ file, canonicalOwnerFile: maps[file] ?? file, owner: owner(file), line: n.loc.start.line,
      column: n.loc.start.column, symbol: fn?.id?.name ?? fn?.key?.name ?? '<anonymous/module>', receiver,
      method: method ?? '<computed>', methodExpression: excerpt(c.property), literalPaths: literals,
      pathExpression: excerpt(arg), pathKind: literals.length ? 'literal' : arg?.type === 'RegExpLiteral' ? 'regex' : 'dynamic-or-implicit-root',
      handlers, guards, sourceSha256: sha(text), classification: !known ? 'unresolved-receiver-path-candidate'
        : method === 'use' ? 'mount-or-middleware' : method === 'route' ? 'route-chain' : 'route-declaration',
      unresolved: !known || !literals.length || ['use','route'].includes(method) || method == null,
      activationUnverified: true });
  });
  return { imports, sites, helperCalls: helpers };
}
function identities(rows) {
  const occurrences = new Map();
  for (const r of rows) {
    // Reuse historical identity for compatible sites; conditions/handler excerpts remain part of identity.
    const key = JSON.stringify([r.canonicalOwnerFile,r.receiver,r.method,r.pathExpression,r.guards.map(g => [g.kind,g.condition]),r.handlers]);
    const id = sha(key).slice(0,24), n = occurrences.get(id) ?? 0;
    occurrences.set(id,n+1); r.declarationId = 'decl-'+id+'-'+n;
  }
}
if (process.argv.includes('--controls')) {
  const r = inspect("const r=express.Router(); if(enabled) r.get('/x', h); router.route('/c').get(h).post(h); router.use('/device', wrap(device)); router[m]('/dynamic',h); helper.get('/maybe',h); app.get('env'); router.get(/^x/,h); router.get(['/a','/b'],h);", 'x.mjs');
  assert(r.sites.some(s => s.receiver === 'r' && s.literalPaths[0] === '/x' && s.guards.length));
  assert(r.sites.some(s => s.method === 'post' && s.literalPaths[0] === '/c'));
  assert(r.sites.some(s => s.method === '<computed>' && s.unresolved));
  assert(r.sites.some(s => s.classification === 'unresolved-receiver-path-candidate'));
  assert(r.sites.some(s => s.pathKind === 'regex' && s.unresolved));
  assert(r.sites.some(s => s.literalPaths.length === 2));
  assert(!r.sites.some(s => s.pathExpression === "'env'"));
  assert.equal(inspect('// router.get("/fake",h)\nconst s="router.get(fake)";', 'x.mjs').sites.length,0);
  assert.throws(() => inspect('function x( {', 'x.mjs'));
  const a=inspect("router.get('/x',h);", 'x.mjs').sites,b=inspect("\n\nrouter.get('/x',h);",'x.mjs').sites; identities(a);identities(b);assert.equal(a[0].declarationId,b[0].declarationId);
  console.log(JSON.stringify({ controlsPassed:10, nativeExecuted:false }));
} else {
  const [reference, candidate, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: build-http-source-census.mjs reference-ref candidate-ref output');
  const here=path.dirname(new URL(import.meta.url).pathname);
  const inventory=path.resolve(here,'../../../docs/_wip/plans/2026-10-09-application-modules-ownership-inventory.json');
  const maps=JSON.parse(fs.readFileSync(inventory)).resolvedMoves;
  const historicalPaths=['http-expected-installed-route-matrix.json','http-readonly-eligibility.json'];
  const historical=historicalPaths.map(name => {const f=path.join(here,name);return {path:f,sha256:sha(fs.readFileSync(f)),value:JSON.parse(fs.readFileSync(f))};});
  const byId=new Map(historical[0].value.declarations.map(r=>[r.declarationId,r]));
  const effects=new Map(historical[1].value.declarations.map(r=>[r.declarationId,r]));
  const cases=historical[0].value.isolatedAndLiveEvidenceUnion.cases;
  const roles=[], parsedCache=new Map();
  for (const [role,ref] of [['reference',reference],['candidate',candidate]]) {
    const commit=git(['rev-parse',ref+'^{commit}']).toString().trim();
    const tracked=git(['ls-tree','-r','--name-only',commit,'--',...roots]).toString().trim().split('\n').filter(Boolean);
    const records=[],sites=[],parseErrors=[];
    for (const file of tracked) {
      if (excluded.test(file) || !js.test(file)) { records.push({file,status:'excluded',reason:excluded.test(file)?'test-generated-vendor-docs':'non-JS-source-or-resource',nonJSUncertainty:!excluded.test(file)}); continue; }
      const bytes=git(['show',commit+':'+file]); const text=bytes.toString();
      try { const key=file+':'+sha(bytes);if(!parsedCache.has(key))parsedCache.set(key,inspect(text,file,maps));
        const r=structuredClone(parsedCache.get(key));records.push({file,status:'included',owner:owner(file),sha256:sha(bytes),bytes:bytes.length,imports:r.imports,helperCalls:r.helperCalls,siteCount:r.sites.length});sites.push(...r.sites); }
      catch(e) { const row={file,status:'parse-error',sha256:sha(bytes),error:e.message};records.push(row);parseErrors.push(row); }
    }
    identities(sites);
    for (const r of sites) {
      const old=byId.get(r.declarationId),effect=effects.get(r.declarationId);
      r.historicalLink=old?{identityMatch:true,status:old.status,urlTemplates:old.urlTemplates,effectEligibility:effect?.effectEligibility??null,
        cases:cases.filter(c=>c.declarationId===r.declarationId).map(c=>({id:c.id,urlTemplate:c.urlTemplate,acceptedHistorically:c.accepted})),currentBehaviorCredit:false}:null;
    }
    roles.push({role,commit,trackedFiles:tracked.length,includedFiles:records.filter(r=>r.status==='included').length,
      excludedFiles:records.filter(r=>r.status==='excluded').length,parseErrors,files:records,sites,
      counts:{sites:sites.length,localLiteralRouteDeclarations:sites.filter(s=>s.classification==='route-declaration'&&s.literalPaths.length).length,
        mountsOrMiddleware:sites.filter(s=>s.classification==='mount-or-middleware').length,unresolved:sites.filter(s=>s.unresolved).length,
        exactHistoricalIdentityLinks:sites.filter(s=>s.historicalLink).length}});
  }
  const result={schema:'daylight.current-http-source-census/v1',generatorSha256:sha(fs.readFileSync(new URL(import.meta.url))),
    parser:{version:require('@babel/parser/package.json').version,sha256:sha(fs.readFileSync(require.resolve('@babel/parser')))},roots,
    ownershipInventory:{path:inventory,sha256:sha(fs.readFileSync(inventory))},historicalInputs:historical.map(({value,...r})=>r),roles,
    productionMethodTemplateDenominator:null,nativeExecuted:false,scope:'Source-registration syntax inventory and exact historical identity links only. Counts are local source sites, never installed reachable URL templates or coverage percentages.',
    unresolvedBoundaries:['Mount reachability/conditional configuration not executed; import/factory/helper call sites and guards are retained for review.',
      'Unknown receivers, computed methods, regex/dynamic paths and opaque middleware are not promoted to concrete routes.',
      '/device wrapper is a detached router delegate: local device declarations and wrapper mount are separate, not additive installed route occurrences.',
      '/plex_proxy is an external all-method delegate; Telegram/webhook and other provider mounts need configured activation evidence.',
      'Non-JS runtime files/resources explicitly partitioned; no complete native/firmware protocol or helper data-flow resolution claim.',
      'Historical effect clearance, URL projection and testcase links are provenance only; identity matches never transfer current behavior/live coverage credit.']};
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,sha256:sha(fs.readFileSync(output)),roles:roles.map(r=>({role:r.role,commit:r.commit,files:r.includedFiles,parseErrors:r.parseErrors.length,...r.counts}))}));
}
