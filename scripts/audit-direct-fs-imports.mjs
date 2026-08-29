#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default;
const FS_MODULES = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises']);
const SOURCE_ROOTS = ['backend/src/', 'backend/config/'];
const RUNTIME_ENTRYPOINTS = new Set(['backend/index.js']);
const ALLOWED_RUNTIME_ROOTS = ['backend/src/0_system/'];

function isTestFile(file) {
  return /(^|\/)(__tests__|test|tests|fixtures)(\/|$)/.test(file) ||
    /\.(test|spec)\.(mjs|js|cjs)$/.test(file);
}

function isScannedRuntimeFile(file) {
  const isRuntimeSource = SOURCE_ROOTS.some((root) => file.startsWith(root)) ||
    RUNTIME_ENTRYPOINTS.has(file);
  return isRuntimeSource && /\.(mjs|js|cjs)$/.test(file) &&
    !isTestFile(file) && !ALLOWED_RUNTIME_ROOTS.some((root) => file.startsWith(root));
}

export function scanDirectFsImports(file, source) {
  if (!isScannedRuntimeFile(file)) return [];
  // Preserve the AST-based verdict for candidate files, while avoiding a
  // costly parse of every unrelated staged module in a large remediation.
  // Every forbidden static specifier contains this literal fragment.
  if (!/(?:node:)?fs(?:\/promises)?/.test(source)) return [];

  const findings = [];
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: ['dynamicImport', 'importAttributes', 'topLevelAwait'],
  });
  const add = (node, specifier) => {
    if (!FS_MODULES.has(specifier)) return;
    findings.push({ file, line: node.loc?.start?.line ?? 1, specifier });
  };
  const staticSpecifier = (node) => {
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return node.quasis[0]?.value?.cooked;
    }
    return null;
  };

  traverse(ast, {
    ImportDeclaration(path) { add(path.node, path.node.source.value); },
    ExportNamedDeclaration(path) { if (path.node.source) add(path.node, path.node.source.value); },
    ExportAllDeclaration(path) { add(path.node, path.node.source.value); },
    ImportExpression(path) {
      add(path.node, staticSpecifier(path.node.source));
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const isImport = callee.type === 'Import';
      const isRequire = callee.type === 'Identifier' && callee.name === 'require';
      const isModuleRequire = callee.type === 'MemberExpression'
        && !callee.computed
        && callee.property?.type === 'Identifier'
        && callee.property.name === 'require';
      if (isImport || isRequire || isModuleRequire) {
        add(path.node, staticSpecifier(args[0]));
      }
    },
  });

  return findings;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) walk(file, files);
    else if (isScannedRuntimeFile(file)) files.push(file);
  }
  return files;
}

function stagedFiles() {
  const output = execFileSync('git', [
    'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z', '--',
    ...SOURCE_ROOTS, ...RUNTIME_ENTRYPOINTS,
  ], { encoding: 'utf8' });
  return output.split('\0').filter(isScannedRuntimeFile);
}

function stagedSources(files) {
  if (files.length === 0) return [];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    input: `${files.map((file) => `:${file}`).join('\n')}\n`,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw result.error || new Error(result.stderr?.toString('utf8') || 'Unable to read staged files');
  }
  const output = result.stdout;
  let offset = 0;
  return files.map((file) => {
    const headerEnd = output.indexOf(0x0A, offset);
    if (headerEnd < 0) throw new Error(`Invalid Git object header for ${file}`);
    const header = output.subarray(offset, headerEnd).toString('utf8');
    const size = Number(header.split(' ')[2]);
    if (!Number.isInteger(size) || size < 0) throw new Error(`Unable to read staged ${file}: ${header}`);
    const start = headerEnd + 1;
    const end = start + size;
    const source = output.subarray(start, end).toString('utf8');
    offset = end + 1; // cat-file writes one newline after every object body.
    return source;
  });
}

const stagedFilesArgument = process.argv.find((argument) => argument.startsWith('--staged-files='));

function run({ staged = false, files: suppliedFiles = null, quiet = false } = {}) {
  const files = suppliedFiles ?? (staged
    ? stagedFiles()
    : [
        ...SOURCE_ROOTS.flatMap((root) => walk(root)),
        ...[...RUNTIME_ENTRYPOINTS].filter((file) => statSync(file).isFile()),
      ]);

  const sources = staged ? stagedSources(files) : null;
  const findings = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    findings.push(...scanDirectFsImports(file, staged ? sources[index] : readFileSync(file, 'utf8')));
  }

  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} direct ${finding.specifier} import`);
  }

  if (findings.length > 0) {
    console.error(`\nDirect filesystem imports are forbidden outside 0_system (${findings.length} found).`);
    console.error('Use an application-owned port implemented by an adapter; the adapter must delegate raw filesystem work to 0_system. Composition must wire those abstractions, not node:fs.');
    process.exitCode = 1;
  } else if (!quiet) {
    console.log(`Direct filesystem import gate passed (${files.length} ${staged ? 'staged ' : ''}runtime files checked).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run({
    staged: process.argv.includes('--staged') || Boolean(stagedFilesArgument),
    files: stagedFilesArgument ? JSON.parse(stagedFilesArgument.slice('--staged-files='.length)) : null,
    quiet: process.argv.includes('--quiet'),
  });
}
