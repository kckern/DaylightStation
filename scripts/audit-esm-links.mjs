#!/usr/bin/env node

/**
 * Static ESM link gate.
 *
 * Parse checks prove that a module is syntactically valid. They do not prove
 * that its local import targets exist or export the names their consumers ask
 * for. This gate checks those contracts without evaluating an entrypoint (and
 * therefore without starting the household controller).
 */
import {
  existsSync,
  realpathSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { listIndexFiles, readIndexFile, readIndexFiles } from './index-snapshot.mjs';

const traverse = typeof traverseModule === 'function'
  ? traverseModule
  : traverseModule.default;
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ROOTS = ['backend/src', 'cli'];
const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs']);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function parseModule(source, file) {
  return parse(source, {
    sourceFilename: file,
    sourceType: 'unambiguous',
    plugins: ['dynamicImport', 'importAttributes', 'topLevelAwait'],
  });
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(file))) yield file;
  }
}

function importedName(specifier) {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return null;
  return specifier.imported?.name ?? specifier.imported?.value ?? null;
}

function exportedName(specifier) {
  return specifier.exported?.name ?? specifier.exported?.value ?? null;
}

function destructuredImportNames(pattern) {
  if (pattern?.type !== 'ObjectPattern') return [];
  return pattern.properties.flatMap((property) => {
    if (property.type === 'RestElement') return [];
    return property.key?.name ?? property.key?.value ?? [];
  });
}

function awaitedStaticImport(node) {
  const expression = node?.type === 'AwaitExpression' ? node.argument : node;
  if (expression?.type !== 'CallExpression' || expression.callee.type !== 'Import') return null;
  const [argument] = expression.arguments;
  return argument?.type === 'StringLiteral' ? argument.value : null;
}

function declarationNames(declaration) {
  if (!declaration) return [];
  if (declaration.id?.name) return [declaration.id.name];
  if (declaration.type !== 'VariableDeclaration') return [];
  return declaration.declarations.flatMap(({ id }) => bindingNames(id));
}

function bindingNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingNames);
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.flatMap((property) =>
      property.type === 'RestElement' ? bindingNames(property.argument) : bindingNames(property.value));
  }
  return [];
}

export function createModuleResolver({ projectRoot = PROJECT_ROOT, imports, backendImports } = {}) {
  const rootPackageImports = imports ?? JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  ).imports ?? {};
  const backendRoot = join(projectRoot, 'backend');
  const backendPackage = join(backendRoot, 'package.json');
  const backendPackageImports = backendImports ?? (imports || !existsSync(backendPackage)
    ? rootPackageImports
    : JSON.parse(readFileSync(backendPackage, 'utf8')).imports ?? {});

  function resolveAlias(sourceFile, specifier) {
    const inBackendPackage = sourceFile === backendRoot || sourceFile.startsWith(`${backendRoot}/`);
    const packageRoot = inBackendPackage ? backendRoot : projectRoot;
    const packageImports = inBackendPackage ? backendPackageImports : rootPackageImports;
    for (const [pattern, targetPattern] of Object.entries(packageImports)) {
      if (typeof targetPattern !== 'string') continue;
      if (!pattern.includes('*')) {
        if (specifier === pattern) return resolve(packageRoot, targetPattern);
        continue;
      }
      const [prefix, suffix] = pattern.split('*');
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
      return resolve(packageRoot, targetPattern.replace('*', middle));
    }
    return null;
  }

  return (sourceFile, specifier) => {
    if (BUILTINS.has(specifier)) return { kind: 'external' };
    if (specifier.startsWith('.')) {
      return { kind: 'local', file: resolve(dirname(sourceFile), specifier) };
    }
    if (specifier.startsWith('#')) {
      const file = resolveAlias(sourceFile, specifier);
      return file ? { kind: 'local', file } : { kind: 'unresolved-alias' };
    }
    return { kind: 'external' };
  };
}

export function auditEsmLinks(files, {
  projectRoot = PROJECT_ROOT,
  imports,
  backendImports,
  readFile = (file) => readFileSync(file, 'utf8'),
  fileExists = existsSync,
} = {}) {
  const resolveModule = createModuleResolver({ projectRoot, imports, backendImports });
  const findings = [];
  const astCache = new Map();
  const exportCache = new Map();

  function astFor(file) {
    if (!astCache.has(file)) astCache.set(file, parseModule(readFile(file), file));
    return astCache.get(file);
  }

  function exportsFor(file, visiting = new Set()) {
    if (exportCache.has(file)) return exportCache.get(file);
    if (visiting.has(file)) return new Set();
    const nextVisiting = new Set(visiting).add(file);
    const names = new Set();
    const exportAll = [];
    for (const statement of astFor(file).program.body) {
      if (statement.type === 'ExportDefaultDeclaration') names.add('default');
      if (statement.type === 'ExportNamedDeclaration') {
        for (const name of declarationNames(statement.declaration)) names.add(name);
        for (const specifier of statement.specifiers) {
          const name = exportedName(specifier);
          if (name) names.add(name);
        }
      }
      if (statement.type === 'ExportAllDeclaration' && !statement.exported) {
        exportAll.push(statement.source.value);
      }
      if (statement.type === 'ExportAllDeclaration' && statement.exported) {
        names.add(statement.exported.name ?? statement.exported.value);
      }
    }
    for (const specifier of exportAll) {
      const target = resolveModule(file, specifier);
      if (target.kind !== 'local' || !fileExists(target.file)) continue;
      for (const name of exportsFor(target.file, nextVisiting)) {
        if (name !== 'default') names.add(name);
      }
    }
    exportCache.set(file, names);
    return names;
  }

  function check(sourceFile, node, specifier, requestedNames = []) {
    const target = resolveModule(sourceFile, specifier);
    const source = relative(projectRoot, sourceFile);
    const line = node.loc?.start?.line ?? 1;
    if (target.kind === 'unresolved-alias') {
      findings.push({ file: source, line, specifier, reason: 'unmapped package import alias' });
      return;
    }
    if (target.kind !== 'local') return;
    if (!fileExists(target.file)) {
      findings.push({ file: source, line, specifier, reason: 'module target does not exist' });
      return;
    }
    if (!SOURCE_EXTENSIONS.has(extname(target.file))) return;
    let available;
    try {
      available = exportsFor(target.file);
    } catch (error) {
      findings.push({
        file: source,
        line,
        specifier,
        reason: `target export scan failed: ${error.message}`,
      });
      return;
    }
    for (const name of requestedNames.filter(Boolean)) {
      if (!available.has(name)) {
        findings.push({
          file: source,
          line,
          specifier,
          reason: `target does not export ${JSON.stringify(name)}`,
        });
      }
    }
  }

  for (const file of files) {
    const ast = astFor(file);
    traverse(ast, {
      ImportDeclaration(path) {
        check(file, path.node, path.node.source.value, path.node.specifiers.map(importedName));
      },
      ExportNamedDeclaration(path) {
        if (!path.node.source) return;
        const names = path.node.specifiers.map((specifier) =>
          specifier.local?.name ?? specifier.local?.value ?? null);
        check(file, path.node, path.node.source.value, names);
      },
      ExportAllDeclaration(path) {
        check(file, path.node, path.node.source.value);
      },
      CallExpression(path) {
        if (path.node.callee.type !== 'Import') return;
        const [argument] = path.node.arguments;
        if (argument?.type === 'StringLiteral') check(file, path.node, argument.value);
      },
      VariableDeclarator(path) {
        const specifier = awaitedStaticImport(path.node.init);
        if (!specifier) return;
        check(file, path.node, specifier, destructuredImportNames(path.node.id));
      },
    });
  }
  return findings;
}

function main() {
  const staged = process.argv.includes('--staged');
  // Resolve imports against the complete index: backend/CLI modules commonly
  // target shared contracts, test helpers, and package-import aliases outside
  // their own source roots.
  const indexFiles = staged ? listIndexFiles() : [];
  const indexSet = new Set(indexFiles);
  const indexSnapshot = staged ? readIndexFiles(indexFiles, PROJECT_ROOT) : null;
  const indexPathFor = (file) => {
    const direct = relative(PROJECT_ROOT, file);
    if (indexSet.has(direct)) return direct;
    // `backend/shared*` are tracked symlinks into the root shared tree. The
    // index stores the physical tree once, whereas Node resolves aliases
    // through the symlink. Match the blob by its physical repo path.
    try {
      return relative(PROJECT_ROOT, realpathSync(file));
    } catch {
      return direct;
    }
  };
  const readStaged = (file) => indexSnapshot.get(indexPathFor(file)) ?? readIndexFile(file, PROJECT_ROOT);
  const files = staged
    ? indexFiles.filter((file) => SOURCE_ROOTS.some((root) => file.startsWith(`${root}/`)) && SOURCE_EXTENSIONS.has(extname(file))).map((file) => join(PROJECT_ROOT, file))
    : SOURCE_ROOTS.flatMap((root) => [...walk(join(PROJECT_ROOT, root))]);
  const rootImports = staged ? JSON.parse(indexSnapshot.get('package.json')).imports ?? {} : undefined;
  const stagedBackendPackage = staged && indexSet.has('backend/package.json');
  const backendImports = stagedBackendPackage
    ? JSON.parse(indexSnapshot.get('backend/package.json')).imports ?? {}
    : rootImports;
  const findings = auditEsmLinks(files, staged ? {
    imports: rootImports,
    backendImports,
    readFile: readStaged,
    fileExists: (file) => indexSet.has(indexPathFor(file)),
  } : undefined);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.specifier} — ${finding.reason}`);
  }
  if (findings.length) {
    console.error(`\nESM link gate FAILED — ${findings.length} broken local import contract(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`ESM link gate OK — ${files.length} ${staged ? 'staged ' : ''}modules checked without evaluating entrypoints.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
