#!/usr/bin/env node
/** Static owner privacy; no runtime registry or product evaluation. */
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { createModuleResolver } from './audit-esm-links.mjs';
import { listIndexFiles, readIndexFiles } from './index-snapshot.mjs';
import { PUBLIC_OWNER_ENTRIES } from './owner-entry-policy.mjs';
export { PUBLIC_OWNER_ENTRIES } from './owner-entry-policy.mjs';

const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['backend', 'frontend', 'shared', 'cli', 'modules', 'capabilities'];
const EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.jsx']);
const SKIP = new Set(['node_modules', '.git', '.claude', '.claire', '.worktrees', '.cache', '.vite', 'dist', 'build', 'coverage', 'vendor']);
// Each entry is explicitly reviewed. No filename wildcard or public-directory
// exemption: add only the actual independent facets an owner publishes.
const ownerOf = (file) => /^(modules|capabilities)\/([^/]+)\//.exec(file)?.slice(1).join('/') ?? null;
const isTestHelper = (file) => /^tests\/(_lib|_fixtures|_infrastructure)\//.test(file);
const isTest = (file) => isTestHelper(file) || /\.(?:test|spec|case)\.(?:mjs|js|cjs|jsx)$/.test(file);
const isSource = (file) => ROOTS.includes(file.split('/')[0]) && EXTENSIONS.has(extname(file))
  && !file.split('/').slice(0, -1).some((part) => SKIP.has(part));

export function browserAliasesFromConfig(source, projectRoot) {
  const aliases = new Map();
  if (!source) return aliases;
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, { ObjectProperty(p) {
    if ((p.node.key.name ?? p.node.key.value) !== 'alias' || p.node.value.type !== 'ObjectExpression') return;
    for (const property of p.node.value.properties) {
      if (property.type !== 'ObjectProperty') continue;
      const name = property.key.name ?? property.key.value;
      const value = property.value;
      if (value.type === 'StringLiteral') aliases.set(name, resolve(projectRoot, 'frontend', value.value));
      if (value.type === 'CallExpression' && value.callee.type === 'MemberExpression'
          && value.callee.object.name === 'path' && value.callee.property.name === 'resolve'
          && value.arguments[0]?.name === '__dirname' && value.arguments.slice(1).every((arg) => arg.type === 'StringLiteral')) {
        aliases.set(name, resolve(projectRoot, 'frontend', ...value.arguments.slice(1).map((arg) => arg.value)));
      }
    }
  } });
  return aliases;
}

/** Strongly connected owners are cyclic even when each imported leaf is public. */
export function ownerCycleFindings(edges) {
  const graph = new Map();
  for (const edge of edges) {
    if (!graph.has(edge.from)) graph.set(edge.from, new Set());
    if (!graph.has(edge.to)) graph.set(edge.to, new Set());
    graph.get(edge.from).add(edge.to);
  }
  let next = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), components = [];
  function visit(owner) {
    indices.set(owner, next); low.set(owner, next++); stack.push(owner); active.add(owner);
    for (const dependency of [...graph.get(owner)].sort()) {
      if (!indices.has(dependency)) { visit(dependency); low.set(owner, Math.min(low.get(owner), low.get(dependency))); }
      else if (active.has(dependency)) low.set(owner, Math.min(low.get(owner), indices.get(dependency)));
    }
    if (low.get(owner) !== indices.get(owner)) return;
    const component = [];
    let member;
    do { member = stack.pop(); active.delete(member); component.push(member); } while (member !== owner);
    if (component.length > 1) components.push(component.sort());
  }
  for (const owner of [...graph.keys()].sort()) if (!indices.has(owner)) visit(owner);
  return components.sort((a, b) => a[0].localeCompare(b[0])).map((owners) => {
    const members = new Set(owners);
    const cycleEdges = edges.filter(edge => members.has(edge.from) && members.has(edge.to))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target));
    const first = cycleEdges[0];
    return { file: first.file, line: first.line, specifier: owners.join(', '), target: 'owner graph',
      reason: 'owner dependency cycle: ' + owners.join(', '), cycleOwners: owners, cycleEdges };
  });
}

export function auditOwnerBoundaries(files, {
  projectRoot = ROOT, imports, backendImports,
  readFile = (file) => readFileSync(file, 'utf8'),
  publicEntries = PUBLIC_OWNER_ENTRIES,
  browserAliases,
  sourceInventory = new Set(files),
} = {}) {
  const resolveModule = createModuleResolver({ projectRoot, imports, backendImports });
  if (!browserAliases) {
    let config;
    try { config = readFile(join(projectRoot, 'frontend/vite.config.js')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    browserAliases = browserAliasesFromConfig(config, projectRoot);
  }
  const findings = [], ownerEdges = [];
  for (const file of files) {
    const source = relative(projectRoot, file).split('\\').join('/');
    if (isTest(source)) continue;
    const from = ownerOf(source);
    const ast = parse(readFile(file), { sourceType: 'unambiguous', plugins: ['jsx', 'dynamicImport', 'importAttributes', 'topLevelAwait'] });
    function check(node, specifier) {
      const clean = specifier.split('?')[0];
      const browser = source.startsWith('frontend/') || /^(modules|capabilities)\/[^/]+\/browser\//.test(source);
      const alias = browser && [...browserAliases].sort(([a], [b]) => b.length - a.length)
        .find(([name]) => clean === name || clean.startsWith(name + '/'));
      const resolved = alias ? { kind: 'local', file: resolve(alias[1], '.' + clean.slice(alias[0].length)) }
        : resolveModule(file, clean);
      if (resolved.kind !== 'local') return;
      if (browser && !extname(resolved.file)) {
        resolved.file = [resolved.file, ...[...EXTENSIONS].map((ext) => resolved.file + ext),
          ...[...EXTENSIONS].map((ext) => join(resolved.file, 'index' + ext))]
          .find((candidate) => sourceInventory.has(candidate)) ?? resolved.file;
      }
      const target = relative(projectRoot, resolved.file).split('\\').join('/');
      const to = ownerOf(target);
      if (from && to && from !== to) ownerEdges.push({ from, to, file: source, line: node.loc?.start.line ?? 1, specifier, target });
      if (isTestHelper(target)) {
        findings.push({ file: source, line: node.loc?.start.line ?? 1, specifier, target, reason: 'production source cannot import a test helper' });
        return;
      }
      if (from === 'capabilities/screen-host' && target.startsWith('frontend/src/composition/')) {
        findings.push({ file: source, line: node.loc?.start.line ?? 1, specifier, target,
          reason: 'screen-host cannot depend on installed composition' });
        return;
      }
      if (!to || from === to) return;
      const reason = from?.startsWith('capabilities/') && to.startsWith('modules/')
        ? from === 'capabilities/screen-host'
          ? 'screen-host cannot depend on installed products'
          : 'capability cannot depend on application modules, including public entries'
        : !publicEntries.has(target) ? 'cross-owner import targets a private implementation' : null;
      if (reason) findings.push({ file: source, line: node.loc?.start.line ?? 1, specifier, target, reason });
    }
    traverse(ast, {
      ImportDeclaration(p) { check(p.node, p.node.source.value); },
      ExportNamedDeclaration(p) { if (p.node.source) check(p.node, p.node.source.value); },
      ExportAllDeclaration(p) { check(p.node, p.node.source.value); },
      ImportExpression(p) { if (p.node.source.type === 'StringLiteral') check(p.node, p.node.source.value); },
      CallExpression(p) {
        if (p.node.callee.type === 'Import' && p.node.arguments[0]?.type === 'StringLiteral') check(p.node, p.node.arguments[0].value);
        const callee = p.node.callee;
        const required = callee.type === 'Identifier' && callee.name === 'require'
          || callee.type === 'MemberExpression' && !callee.computed && callee.object.name === 'require' && callee.property.name === 'resolve';
        if (required && p.node.arguments[0]?.type === 'StringLiteral') check(p.node, p.node.arguments[0].value);
      },
    });
  }
  return [...findings, ...ownerCycleFindings(ownerEdges)];
}

function* walk(directory) {
  let entries;
  try {
    if (!lstatSync(directory).isDirectory()) return;
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile() && EXTENSIONS.has(extname(file))) yield file;
  }
}

function main() {
  const staged = process.argv.includes('--staged');
  let files, options;
  if (staged) {
    const all = listIndexFiles();
    const snapshot = readIndexFiles(all, ROOT);
    const symlinks = new Set(execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .split('\0').filter((entry) => entry.startsWith('120000 ')).map((entry) => entry.slice(entry.indexOf('\t') + 1)));
    files = all.filter((file) => isSource(file) && !symlinks.has(file)).map((file) => join(ROOT, file));
    const imports = JSON.parse(snapshot.get('package.json')).imports ?? {};
    const backendImports = snapshot.has('backend/package.json') ? JSON.parse(snapshot.get('backend/package.json')).imports ?? {} : imports;
    options = { imports, backendImports, readFile: (file) => snapshot.get(relative(ROOT, file)),
      browserAliases: browserAliasesFromConfig(snapshot.get('frontend/vite.config.js'), ROOT),
      sourceInventory: new Set(all.map((file) => join(ROOT, file))) };
  } else files = ROOTS.flatMap((root) => [...walk(join(ROOT, root))]);
  const findings = auditOwnerBoundaries(files, options);
  for (const f of findings) {
    console.error(`${f.file}:${f.line} ${f.specifier} -> ${f.target} — ${f.reason}`);
    for (const edge of f.cycleEdges ?? []) console.error(`  ${edge.from} -> ${edge.to}: ${edge.file}:${edge.line} ${edge.specifier} -> ${edge.target}`);
  }
  if (findings.length) {
    const cycles = findings.filter(f => f.cycleOwners).length;
    console.error(`Owner boundary gate FAILED — ${findings.length - cycles} private owner edge(s)${cycles ? ', ' + cycles + ' owner cycle(s)' : ''}.`);
    process.exitCode = 1;
  }
  else console.log(`Owner boundary gate OK — ${files.length} ${staged ? 'staged ' : ''}source files inspected without evaluation.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
