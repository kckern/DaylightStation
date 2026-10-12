#!/usr/bin/env node
// Offline Git-object census. Never imports application modules or starts services.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const roots = ['backend', 'modules', 'capabilities', 'frontend', '_extensions'];
const excluded = /(?:^|\/)(?:tests?|__tests__|__fixtures__|fixtures|__mocks__|node_modules|vendor|third_party|third-party|generated|dist|build|coverage|docs|\.gradle|\.git)(?:\/|$)|(?:\.(?:test|spec|stories)\.[^/]+$)|(?:^|\/)(?:gradlew(?:\.bat)?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
const js = /\.(?:[cm]?js|jsx|tsx?|mts|cts)$/;
const source = /\.(?:[cm]?js|jsx|tsx?|mts|cts|py|sh|bash|java|kt|c|cpp|cc|h|hpp|ino|lua|html|xml|json|ya?ml|gradle|service)$/;
const sha = b => createHash('sha256').update(b).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
const owner = file => /^(modules|capabilities)\//.test(file) ? file.split('/').slice(0, 2).join('/') : file.split('/')[0];

export function inspectJS(text, file) {
  const ast = parser.parse(text, { sourceType: 'unambiguous', allowReturnOutsideFunction: true,
    plugins: ['jsx', 'typescript', 'decorators-legacy'], errorRecovery: false });
  const sites = [];
  const excerpt = n => text.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, 320);
  const add = (n, kind, parents, argument) => {
    const symbol = [...parents].reverse().find(p => /Function|Method/.test(p.type));
    const declaration = [...parents].reverse().find(p => p.type === 'VariableDeclarator');
    const name = symbol?.id?.name ?? symbol?.key?.name ?? symbol?.key?.value ?? declaration?.id?.name ?? '<module>';
    const literal = argument?.type === 'StringLiteral' || argument?.type === 'NumericLiteral'
      || (argument?.type === 'TemplateLiteral' && argument.expressions.length === 0);
    sites.push({ line: n.loc.start.line, column: n.loc.start.column, symbol: name, kind,
      expression: excerpt(n), nameExpression: argument ? excerpt(argument) : null,
      nameKind: argument ? (literal ? 'literal' : 'dynamic') : 'not-applicable',
      conditional: parents.some(p => /^(IfStatement|ConditionalExpression|SwitchCase|LogicalExpression|For.*|WhileStatement|DoWhileStatement)$/.test(p.type)),
      unresolved: !literal && argument != null, activationUnverified: true });
  };
  const walk = (n, parents = []) => {
    if (!n || typeof n !== 'object' || !n.type) return;
    if (n.type === 'CallExpression' || n.type === 'OptionalCallExpression' || n.type === 'NewExpression') {
      const c = n.callee;
      const method = c?.type === 'Identifier' ? c.name : (!c?.computed ? c?.property?.name : c?.property?.value);
      const callee = c ? excerpt(c) : '';
      let kind;
      if (c?.type === 'Import' || method === 'lazy') kind = 'browser-dynamic-entry';
      else if (/^(WebSocket|WebSocketServer|EventSource|Worker|SharedWorker)$/.test(method ?? '')) kind = 'transport-or-worker-entry';
      else if (/^(setInterval|setTimeout|setImmediate|requestAnimationFrame|schedule|scheduleJob|registerTask|addJob|createJob|queueMicrotask)$/.test(method ?? '')) kind = 'job-or-timer';
      else if (/^(on|once|addListener|addEventListener|subscribe|on[A-Z]\w*|useWebSocketSubscription|useEventListener)$/.test(method ?? '')) kind = 'event-or-subscription';
      else if (/^(emit|publish|broadcast|dispatchEvent|postMessage)$/.test(method ?? '')) kind = 'event-publication';
      else if (/^(register\w*|subscribe\w*|attach\w*Listener|use\w*(?:Event|Socket)\w*)$/.test(method ?? '')) kind = 'registration-factory-or-hook';
      else if (/^(createRoot|hydrateRoot|createBrowserRouter|createHashRouter|useRoutes)$/.test(method ?? '') || /(?:ReactDOM|serviceWorker)\.(?:render|register)$/.test(callee)) kind = 'browser-root-or-router';
      else if (method === 'set' && /(?:handler|registry|workflow|job|widget|topic)/i.test(callee)) kind = 'registration-table-write';
      else if (c?.computed && method == null) kind = 'unresolved-computed-call';
      if (kind) add(n, kind, parents, n.arguments?.[0]);
    }
    if (n.type === 'ImportExpression') add(n, 'browser-dynamic-entry', parents, n.source);
    if (/FunctionDeclaration|ClassMethod|ObjectMethod/.test(n.type)
      && /^(register\w*|subscribe\w*|on[A-Z]\w*|schedule\w*)$/.test(n.id?.name ?? n.key?.name ?? ''))
      add(n, 'registration-interface-or-factory', [...parents, n], n.params?.[0]);
    if (n.type === 'JSXOpeningElement' && /(?:^|\.)(?:Route|Router|Routes|Widget|AppContainer)$/.test(excerpt(n.name)))
      add(n, 'browser-route-or-widget', parents, n.attributes.find(a => a.name?.name === 'path')?.value);
    if (n.type === 'JSXAttribute' && /^on[A-Z]/.test(n.name?.name ?? '')) add(n, 'browser-event-handler', parents, n.value?.expression);
    if ((n.type === 'ObjectProperty' || n.type === 'ObjectMethod') && parents.some(p => p.type === 'VariableDeclarator'
      && /(?:handler|registry|workflow|job|widget|route)/i.test(p.id?.name ?? '')))
      add(n, 'registration-table-declaration', parents, n.computed ? n.key : { ...n.key, type: 'StringLiteral' });
    if (n.type === 'ObjectProperty' && /^(?:handlers|widgets|routes|jobs|listeners|subscriptions)$/.test(n.key?.name ?? n.key?.value ?? ''))
      add(n, 'registration-table-or-injection', parents, n.value);
    for (const [key, value] of Object.entries(n)) {
      if (['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const v of value) if (v?.type) walk(v, [...parents, n]);
      } else if (value?.type) walk(value, [...parents, n]);
    }
  };
  walk(ast);
  return sites.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
}

if (process.argv.includes('--controls')) {
  const a = inspectJS("if (enabled) bus.on('ready', h); bus.on(topic, h); setInterval(h, delay); const App=lazy(()=>import('./App.jsx')); <Route path='/x' element={<App/>}/>; <button onClick={h}/>; obj[method](value);", 'fixture.jsx');
  assert(a.some(s => s.kind === 'event-or-subscription' && s.nameKind === 'literal' && s.conditional));
  assert(a.some(s => s.kind === 'event-or-subscription' && s.unresolved));
  for (const kind of ['job-or-timer', 'browser-dynamic-entry', 'browser-route-or-widget', 'browser-event-handler', 'unresolved-computed-call']) assert(a.some(s => s.kind === kind));
  assert.equal(inspectJS('// bus.on("fake", h)\nconst s="registerTask(fake)";', 'x.js').length, 0);
  assert.throws(() => inspectJS('function broken( {', 'x.js'));
  const factories=inspectJS('export function registerJobs(deps) {} const x={handlers:{a:job},subscribe(topic,h){}}; bus.onClientDisconnection(h);', 'x.js');
  assert(factories.some(s=>s.kind==='registration-interface-or-factory' && s.symbol==='registerJobs'));
  assert(factories.some(s=>s.kind==='registration-table-or-injection'));
  assert(factories.some(s=>s.kind==='event-or-subscription'));
  process.stdout.write(JSON.stringify({ controlsPassed: 12, nativeActions: 0 }) + '\n');
} else {
  const revision = process.argv[2]; const output = process.argv[3];
  assert(revision && output, 'Usage: node build-non-http-census.mjs <Git commit> <output.json>');
  const commit = git(['rev-parse', `${revision}^{commit}`]).toString().trim();
  const entries = git(['ls-tree', '-rz', commit, '--', ...roots]).toString().split('\0').filter(Boolean).map(row => {
    const [head, file] = row.split('\t'); const [mode, type, blob] = head.split(' '); return { file, mode, type, blob };
  });
  const exclusions = []; const selected = [];
  for (const e of entries) {
    const reason = e.type !== 'blob' || e.mode === '120000' ? 'symlink-or-nonblob-boundary'
      : excluded.test(e.file) ? 'test-generated-vendor-docs-policy' : !source.test(e.file) ? 'non-runtime-source-format' : null;
    if (reason) exclusions.push({ path: e.file, gitBlob: e.blob, reason }); else selected.push(e);
  }
  const batch = execFileSync('git', ['cat-file', '--batch'], { input: selected.map(e => e.blob).join('\n') + '\n', maxBuffer: 256 * 1024 * 1024 });
  let offset = 0; const files = []; const unresolvedFiles = [];
  for (const e of selected) {
    const end = batch.indexOf(10, offset); const header = batch.subarray(offset, end).toString().split(' ');
    assert.equal(header[0], e.blob); assert.equal(header[1], 'blob'); const size = Number(header[2]);
    const bytes = batch.subarray(end + 1, end + 1 + size); offset = end + 2 + size; const text = bytes.toString('utf8');
    let sites = []; let parserStatus = 'lexical-non-JavaScript';
    if (js.test(e.file)) {
      try { sites = inspectJS(text, e.file); parserStatus = 'parsed'; }
      catch (error) { parserStatus = 'parse-unresolved'; unresolvedFiles.push({ path: e.file, reason: String(error.message).slice(0, 250) }); }
    }
    if (parserStatus !== 'parsed') {
      text.split('\n').forEach((line, i) => {
        if (!/^\s*(?:#|\/\/|\*)/.test(line) && /(?:register|subscribe|add(?:Event)?Listener|\.on\(|schedule|setInterval|setTimeout|WebSocket|websocket|socketio|onMessage|onReceive|setCallback|attachInterrupt|createRoot|<script|<(?:activity|service|receiver|provider)\b|ExecStart=|@(?:Subscribe|Scheduled)|\b(?:setup|loop|main|onCreate|doWork)\s*\(|__name__\s*==)/.test(line))
          sites.push({ line: i + 1, column: 0, symbol: '<lexical-unresolved>', kind: 'non-js-registration-or-entry-candidate', expression: line.trim().slice(0, 320), nameKind: 'dynamic', conditional: null, unresolved: true, activationUnverified: true });
      });
      if (e.file.endsWith('/package.json')) {
        try {
          const pkg = JSON.parse(text);
          for (const key of ['main', 'module', 'browser', 'bin', 'scripts']) if (pkg[key] != null)
            sites.push({ line: text.slice(0, text.indexOf(`"${key}"`)).split('\n').length, column: 0,
              symbol: key, kind: 'package-entry-or-command-declaration', expression: JSON.stringify(pkg[key]).slice(0, 320),
              nameKind: 'dynamic', conditional: null, unresolved: true, activationUnverified: true });
        } catch (error) { unresolvedFiles.push({path:e.file,reason:`package JSON: ${error.message}`}); }
      }
    }
    if (/(?:^|\/)(?:index|main|server|worker|service|composition|installation)\.(?:[cm]?js|jsx|tsx?|py|java|cpp|sh)$/.test(e.file))
      sites.unshift({ line: 1, column: 0, symbol: '<module>', kind: 'conventional-entry-or-composition-file', expression: e.file, nameKind: 'literal', conditional: null, unresolved: true, activationUnverified: true });
    files.push({ path: e.file, owner: owner(e.file), gitBlob: e.blob, sha256: sha(bytes), bytes: size, parserStatus,
      protocolBoundary: /(?:_extensions|satellites)\//.test(e.file), sites });
  }
  assert.equal(offset, batch.length);
  const kinds = {}; for (const f of files) for (const site of f.sites) kinds[site.kind] = (kinds[site.kind] ?? 0) + 1;
  const artifact = { schema: 'daylight.non-http-source-registration-census/v2', sourceCommit: commit,
    scope: 'All Git-tracked files in the five runtime roots classified once; JS/TS/JSX AST registration/entry/event/job patterns plus explicit non-JS lexical candidates. Source sites do not prove invocation, installed handlers, configuration reachability or protocol behavior.',
    roots, exclusionPolicy: excluded.source, sourceFormatPolicy: source.source,
    scanner: { path: 'tests/readiness/application-modules/build-non-http-census.mjs', sha256: sha(fs.readFileSync(new URL(import.meta.url))),
      parserVersion: require('@babel/parser/package.json').version, parserSha256: sha(fs.readFileSync(require.resolve('@babel/parser'))) },
    trackedRootFileCount: entries.length, searchedFileCount: files.length,
    siteCount: Object.values(kinds).reduce((a, b) => a + b, 0), kinds, files, exclusions, unresolvedFiles,
    completeness: { trackedFilePartitionExact: files.length + exclusions.length === entries.length,
      semanticAliasResolution: false, runtimeActivation: false, nonJsSemantics: false,
      unknownComputedCallsIncluded: true, parserFailuresExplicit: true },
    runtimeProofScope: 'Existing paired native/browser/job evidence remains separately pinned; census supplies no runtime pass credit.',
    hardwareProtocolScope: 'Satellite/extension source files are inventoried; physical MIDI, localhost8770 bridges, cast, firmware and device protocol activation are not validated.',
    nativeActionsPerformed: false };
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ sourceCommit: commit, tracked: entries.length, searched: files.length,
    sites: artifact.siteCount, kinds, parseFailures: unresolvedFiles.length, output: path.resolve(output) }) + '\n');
}
