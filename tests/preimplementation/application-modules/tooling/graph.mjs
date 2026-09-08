/** Static inventory only: never evaluate a repository module. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { root, packet, emit } from './census.mjs';
if (!process.env.PRE_TOOLCHAIN_ROOT) throw new Error('Explicit installed toolchain root required');
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const toolRequire = createRequire(path.join(toolRoot, 'package.json'));
const {
  parse
} = toolRequire('@babel/parser');
const ledger = JSON.parse(fs.readFileSync(path.join(packet, 'source-ledger.json')));
const byPath = new Map(ledger.files.map(file => [file.path, file]));
const id = (kind, value) => kind + '-' + createHash('sha256').update(value).digest('hex').slice(0, 16);
const symlinks = ledger.files.filter(f => f.mode === '120000');
const manifests = new Map(ledger.files.filter(f => /(^|\/)package\.json$/.test(f.path)).map(f => [path.dirname(f.path), JSON.parse(fs.readFileSync(path.join(root, f.path)))]));
function canonical(name) {
  let normalized = path.posix.normalize(name);
  for (let i = 0; i < 8; i++) {
    const link = symlinks.find(f => normalized === f.path || normalized.startsWith(f.path + '/'));
    if (!link) return normalized;
    normalized = path.posix.normalize(path.posix.join(path.posix.dirname(link.path), link.symlinkTarget, normalized.slice(link.path.length)));
  }
  throw new Error('Symlink cycle: ' + name);
}
function localTarget(target) {
  const clean = canonical(target.split('?')[0].split('#')[0]);
  return [clean, ...['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json', '.scss', '.css'].map(ext => clean + ext), ...['index.mjs', 'index.js', 'index.jsx', 'index.ts', 'index.tsx'].map(p => clean + '/' + p)].find(p => byPath.has(p)) || null;
}
function scopeFor(name) {
  let dir = path.posix.dirname(name);
  while (!manifests.has(dir) && dir !== '.') dir = path.posix.dirname(dir);
  return {
    dir,
    manifest: manifests.get(dir) || {}
  };
}
const viteAliases = {
  '@': 'frontend/src',
  '@gaming-ui': 'frontend/src/modules/Gaming/platform/ui',
  '@gaming': 'frontend/src/modules/Gaming',
  '@shared-contracts': 'shared/contracts',
  '@shared-music': 'shared/music',
  '@shared-gaming': 'shared/gaming',
  '@shared-interaction': 'shared/interaction',
  '@shared-presentation': 'shared/presentation/scenes',
  '#frontend': 'frontend/src'
};
const packageCache = new Map();
function resolve(from, spec) {
  if (builtinModules.includes(spec) || spec.startsWith('node:')) return {
    kind: 'builtin',
    target: spec.replace(/^node:/, '')
  };
  if (spec.startsWith('.')) {
    const target = localTarget(path.posix.join(path.posix.dirname(from), spec));
    return {
      kind: target ? 'source' : 'unresolved-relative',
      target
    };
  }
  const scope = scopeFor(from);
  if (spec.startsWith('#')) {
    const entries = Object.entries(scope.manifest.imports || {}).sort(([a], [b]) => b.length - a.length);
    for (const [pattern, value] of entries) {
      const [prefix, suffix = ''] = pattern.split('*');
      if (pattern.includes('*') && spec.startsWith(prefix) && spec.endsWith(suffix) || pattern === spec) {
        if (typeof value !== 'string') return {
          kind: 'conditional-import-map',
          target: null,
          scope: scope.dir
        };
        const expansion = pattern.includes('*') ? value.replace('*', spec.slice(prefix.length, suffix ? -suffix.length : undefined)) : value;
        const target = localTarget(path.posix.join(scope.dir, expansion));
        return {
          kind: target ? 'source' : 'unresolved-import-map',
          target,
          scope: scope.dir
        };
      }
    }
  }
  for (const [alias, targetRoot] of Object.entries(viteAliases)) if (spec === alias || spec.startsWith(alias + '/')) {
    const target = localTarget(targetRoot + spec.slice(alias.length));
    return {
      kind: target ? 'source' : 'unresolved-bundler-alias',
      target,
      projection: 'documented Vite/test alias; compare native separately'
    };
  }
  if (spec.startsWith('/') || spec.startsWith('#')) return {
    kind: 'unresolved-resource-or-alias',
    target: null
  };
  const cacheKey = scope.dir + ':' + spec;
  if (packageCache.has(cacheKey)) return packageCache.get(cacheKey);
  try {
    const resolution = createRequire(path.join(toolRoot, scope.dir, 'package.json')).resolve(spec);
    let dir = path.dirname(resolution);
    let found;
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')));
        if (p.name) {
          found = {
            name: p.name,
            version: p.version,
            instance: path.relative(toolRoot, dir)
          };
          break;
        }
      }
      dir = path.dirname(dir);
    }
    const result = {
      kind: 'package',
      target: path.relative(toolRoot, resolution),
      package: found || null,
      projection: 'original installed scope, require condition; not migrated ESM proof'
    };
    packageCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const result = {
      kind: 'unresolved-package',
      target: null,
      code: error.code
    };
    packageCache.set(cacheKey, result);
    return result;
  }
}
const edges = [],
  registrations = [],
  testFiles = [],
  parseErrors = [],
  exports = [];
const addEdge = (file, node, spec, kind) => edges.push({
  id: id('EDGE', file + ':' + node.start + ':' + spec),
  source: byPath.get(file).id,
  from: file,
  line: node.loc?.start.line,
  specifier: spec,
  syntax: kind,
  symbols: (node.specifiers || []).map(s => ({
    imported: s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : s.imported?.name || s.local?.name || '*',
    local: s.local?.name || null,
    exported: s.exported?.name || null
  })),
  ...resolve(file, spec)
});
const jsFiles = ledger.files.filter(f => f.mode !== '120000' && /\.(mjs|cjs|js|jsx|ts|tsx)$/.test(f.path));
for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(root, file.path), 'utf8');
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      errorRecovery: false,
      plugins: ['jsx', ...(file.path.endsWith('.ts') || file.path.endsWith('.tsx') ? ['typescript'] : []), 'decorators-legacy'],
      allowReturnOutsideFunction: true
    });
  } catch (error) {
    parseErrors.push({
      path: file.path,
      line: error.loc?.line,
      reason: error.reasonCode
    });
    continue;
  }
  const cases = [];
  let runnerImports = new Set();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source?.value) {
      addEdge(file.path, node, node.source.value, node.type);
      runnerImports.add(node.source.value);
    }
    if (node.type === 'ExportDefaultDeclaration') exports.push({
      from: file.path,
      line: node.loc.start.line,
      name: 'default'
    });
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id?.name) exports.push({
        from: file.path,
        line: node.loc.start.line,
        name: node.declaration.id.name
      });
      for (const d of node.declaration?.declarations || []) if (d.id?.name) exports.push({
        from: file.path,
        line: node.loc.start.line,
        name: d.id.name
      });
      for (const s of node.specifiers || []) exports.push({
        from: file.path,
        line: node.loc.start.line,
        name: s.exported?.name || s.exported?.value
      });
    }
    if (node.type === 'ImportExpression') {
      if (node.source?.type === 'StringLiteral') addEdge(file.path, node, node.source.value, 'dynamic-literal');else edges.push({
        id: id('EDGE', file.path + ':' + node.start),
        source: file.id,
        from: file.path,
        line: node.loc.start.line,
        kind: 'computed-import',
        target: null
      });
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const first = node.arguments?.[0];
      if (callee.type === 'Import' || callee.name === 'require') {
        if (first?.type === 'StringLiteral') addEdge(file.path, node, first.value, callee.type === 'Import' ? 'dynamic-literal' : 'require');else edges.push({
          id: id('EDGE', file.path + ':' + node.start),
          source: file.id,
          from: file.path,
          line: node.loc.start.line,
          kind: 'computed-import',
          target: null
        });
      }
      const member = callee.type === 'MemberExpression' && !callee.computed ? callee.property?.name : null;
      const receiver = callee.object?.name;
      if (member && /^(get|post|put|delete|patch|head|options|use|all)$/.test(member) && /router|^app$/i.test(receiver || '')) registrations.push({
        id: id('REG', file.path + ':' + node.start),
        source: file.id,
        path: file.path,
        line: node.loc.start.line,
        method: member,
        receiver,
        pattern: first?.type === 'StringLiteral' ? first.value : null,
        kind: 'static-candidate',
        status: 'mount-chain/receiver identity review required',
        coverage: 'unmapped'
      });
      const testRoot = callee.name || (callee.object?.type === 'Identifier' ? callee.object.name : null);
      if (['it', 'test', 'describe'].includes(testRoot)) cases.push({
        id: id('CASESTATIC', file.path + ':' + node.start),
        line: node.loc.start.line,
        kind: testRoot,
        modifier: member,
        title: first?.type === 'StringLiteral' ? first.value : null,
        status: 'static declaration; not runner-discovered/executed'
      });
    }
    for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) walk(value);
  }
  walk(ast.program);
  if (/\.(test|spec)\./.test(file.path)) testFiles.push({
    source: file.id,
    path: file.path,
    runner: runnerImports.has('node:test') ? 'node:test' : runnerImports.has('vitest') ? 'vitest' : runnerImports.has('@playwright/test') ? 'playwright' : runnerImports.has('@jest/globals') ? 'jest' : 'ambiguous/globals',
    cases,
    discovery: 'not-run',
    outcome: 'not-run'
  });
}
const outgoing = new Map();
for (const edge of edges) if (edge.kind === 'source') {
  const list = outgoing.get(edge.from) || [];
  list.push(edge.target);
  outgoing.set(edge.from, list);
}
// Tarjan SCCs, including files outside the eventual rehearsal closure.
let cursor = 0;
const index = new Map(),
  low = new Map(),
  stack = [],
  active = new Set(),
  cycles = [];
function visit(v) {
  index.set(v, cursor);
  low.set(v, cursor++);
  stack.push(v);
  active.add(v);
  for (const w of outgoing.get(v) || []) {
    if (!index.has(w)) {
      visit(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (active.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const component = [];
    let w;
    do {
      w = stack.pop();
      active.delete(w);
      component.push(w);
    } while (w !== v);
    if (component.length > 1) cycles.push(component.sort());
  }
}
for (const v of outgoing.keys()) if (!index.has(v)) visit(v);
emit('dependency-ledger.json', {
  schema: 'daylight.preimplementation.dependencies/v1',
  baseline: ledger.baseline,
  parserVersion: toolRequire('@babel/parser/package.json').version,
  parsed: jsFiles.length - parseErrors.length,
  parseErrors,
  edges,
  exports,
  cycles,
  limitations: ['Static AST graph; computed targets need finite enumeration', 'CommonJS-condition installed package resolution is not ESM/Vite/browser validation', 'No proposed ownership is inferred from path alone']
});
emit('registrations.json', {
  schema: 'daylight.preimplementation.registrations/v1',
  baseline: ledger.baseline,
  registrations,
  limitations: ['Candidates, not an assembled endpoint census', 'Mount chains, JSX routes, registries, lifecycle and middleware need manual reconciliation', 'All unmapped candidates have coverage gap and owner investigation-lead']
});
emit('test-population.json', {
  schema: 'daylight.preimplementation.test-population/v1',
  baseline: ledger.baseline,
  files: testFiles,
  parseErrors,
  limitations: ['Declarations are not actual runner discovery', 'Nested/parameterized tests require runner case expansion', 'No tests executed by static scan']
});
process.stdout.write(JSON.stringify({
  parsed: jsFiles.length - parseErrors.length,
  parseErrors: parseErrors.length,
  edges: edges.length,
  registrations: registrations.length,
  testFiles: testFiles.length,
  cycles: cycles.length
}) + '\n');
