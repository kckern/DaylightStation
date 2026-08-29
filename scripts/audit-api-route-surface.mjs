#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const root = process.cwd();
const baseArg = process.argv.find((arg) => arg.startsWith('--base='));
const base = baseArg?.slice('--base='.length) || 'HEAD';
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

function currentFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?js$/.test(entry.name) && !/\.test\.m?js$/.test(entry.name)) files.push(path.relative(root, full));
    }
  };
  // Include the API plus legacy system HTTP modules so moving a registration
  // into its correct layer does not look like an added/removed route.
  walk(path.join(root, 'backend/src/4_api'));
  walk(path.join(root, 'backend/src/0_system/http'));
  files.push('backend/src/app.mjs');
  return files;
}

function baselineFiles() {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', 'backend/src/4_api', 'backend/src/0_system/http', 'backend/src/app.mjs'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.m?js$/.test(file) && !/\.test\.m?js$/.test(file));
}

function sourceAt(file, ref = null) {
  if (ref) return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' });
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function literal(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? '';
  return null;
}

function inventory(files, ref = null) {
  const counts = new Map();
  for (const file of files) {
    let ast;
    try {
      ast = parse(sourceAt(file, ref), { sourceType: 'module', plugins: ['jsx', 'dynamicImport', 'importMeta'] });
    } catch (error) {
      throw new Error(`Cannot parse ${ref ? `${ref}:` : ''}${file}: ${error.message}`);
    }
    traverse(ast, {
      CallExpression(callPath) {
        const callee = callPath.node.callee;
        if (callee?.type !== 'MemberExpression' || callee.computed) return;
        const method = callee.property?.name;
        if (!METHODS.has(method)) return;
        const routePath = literal(callPath.node.arguments[0]);
        // Express registrations in this codebase use slash-prefixed literals.
        // This excludes unrelated Map/header/config `.get('name')` calls.
        if (routePath === null || !routePath.startsWith('/')) return;
        const key = `${method.toUpperCase()} ${routePath}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      },
    });
  }
  return counts;
}

const before = inventory(baselineFiles(), base);
const after = inventory(currentFiles());
const removed = [];
const added = [];
for (const [route, count] of before) {
  const delta = count - (after.get(route) ?? 0);
  if (delta > 0) removed.push({ route, count: delta });
}
for (const [route, count] of after) {
  const delta = count - (before.get(route) ?? 0);
  if (delta > 0) added.push({ route, count: delta });
}

const result = {
  base,
  baselineLiteralRegistrations: [...before.values()].reduce((sum, count) => sum + count, 0),
  currentLiteralRegistrations: [...after.values()].reduce((sum, count) => sum + count, 0),
  removed,
  added,
};
console.log(JSON.stringify(result, null, 2));
if (removed.length > 0) process.exitCode = 1;
