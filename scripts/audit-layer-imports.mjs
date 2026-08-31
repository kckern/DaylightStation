#!/usr/bin/env node
// scripts/audit-layer-imports.mjs
// Layer-import ratchet. Scans backend/src for forbidden import patterns per
// docs/reference/core/layers-of-abstraction/. Compares counts to
// scripts/audit-baseline.json; exits 1 if any rule's count INCREASED.
// Usage:
//   node scripts/audit-layer-imports.mjs             # check against baseline
//   node scripts/audit-layer-imports.mjs --update    # rewrite baseline (only after a task legitimately lowers counts)
//   node scripts/audit-layer-imports.mjs --list=<rule>  # print offending file:line for one rule
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { listIndexFiles, readIndexFile, readIndexFiles } from './index-snapshot.mjs';

const traverse = typeof traverseModule === 'function' ? traverseModule : traverseModule.default;

const IMPORT_RE = /^\s*(?:import\b[^'"]*|export\b[^'"]*from\s*)['"]([^'"]+)['"]/;
const SOURCE_ROOT = '/backend/src/';

// Decision D6: every domain belongs to a dependency level. Feature domains
// may depend on shared/foundation domains; aggregators may also depend on
// features. A source may never import a higher-numbered level.
const DOMAIN_LEVELS = Object.freeze({
  core: 0,
  content: 1, common: 1, messaging: 1, notification: 1, scheduling: 1, entropy: 1, 'state-gates': 1,
  ambient: 2, art: 2, automotive: 2, barcode: 2, camera: 2, concierge: 2, cost: 2,
  donow: 2, economy: 2, exercise: 2, feed: 2, finance: 2, fitness: 2, gaming: 2,
  gratitude: 2, 'home-automation': 2, journaling: 2, lifeplan: 2, livestream: 2,
  measures: 2, media: 2, midi: 2, nutrition: 2, piano: 2, pianoaudio: 2,
  'playback-hub': 2, scan: 2, school: 2, shutdown: 2, trigger: 2,
  health: 3, journalist: 3, lifelog: 3, 'weekly-review': 3,
});

function domainFromPath(filePath) {
  return filePath?.match(/\/2_domains\/([^/]+)\//)?.[1] ?? null;
}

function domainFromSpecifier(specifier, resolved) {
  const alias = specifier.match(/^#domains\/([^/]+)/)?.[1];
  return alias ?? domainFromPath(resolved);
}

function resolvedSpecifier(filePath, specifier) {
  if (!specifier.startsWith('.')) return null;
  return normalize(resolve(dirname(filePath), specifier));
}

function staticModuleSpecifier(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function targetsLayer(resolvedPath, ...layers) {
  return Boolean(resolvedPath) && layers.some((layer) =>
    resolvedPath.includes(`${SOURCE_ROOT}${layer}/`));
}

function adapterFamily(filePath) {
  const physicalFamily = filePath?.match(/\/1_adapters\/([^/]+)/)?.[1] ?? null;
  // Telegram transport, webhook and messaging gateway files are one external
  // integration family retained in two historical directories.
  if (physicalFamily === 'telegram' || physicalFamily === 'messaging') return 'telegram';
  return physicalFamily;
}

// exempt: composition root (5_composition) — the one sanctioned cross-layer zone
const isCompositionRoot = (f) => f.includes('5_composition/');
const isCompositionSource = (f) => isCompositionRoot(f) || /(?:^|\/)backend\/src\/app\.mjs$/.test(f);
const isTest = (f) => /(^|\/)(__tests__|test|tests|fixtures)(\/|$)/.test(f) ||
  /\.(test|spec)\.(mjs|js|cjs)$/.test(f);

export const RULES = [
  // D4 shared-kernel exception: 0_system may import pure domain shared-kernel utils (#domains/core/utils/*)
  { rule: 'system-no-upward', layer: '0_system/', bad: (s, p) => /^#(domains(?!\/core\/utils)|adapters|apps|applications|api|rendering)\//.test(s) || (targetsLayer(p, '1_adapters', '1_rendering', '2_domains', '3_applications', '4_api') && !p.includes(`${SOURCE_ROOT}2_domains/core/utils/`)), exempt: isCompositionRoot },
  { rule: 'domains-no-adapters', layer: '2_domains/', bad: (s, p) => /^#(adapters|apps|applications|api|system|rendering)\//.test(s) || targetsLayer(p, '0_system', '1_adapters', '1_rendering', '3_applications', '4_api') },
  { rule: 'domains-no-node-io', layer: '2_domains/', bad: s => /^(node:)?(fs|fs\/promises|path|child_process)$/.test(s) },
  { rule: 'apps-no-adapters', layer: '3_applications/', bad: (s, p) => /^#adapters\//.test(s) || /1_adapters\//.test(s) || targetsLayer(p, '1_adapters') },
  { rule: 'apps-no-config-internals', layer: '3_applications/', bad: (s, p) => /^#system\/config\//.test(s) || targetsLayer(p, '0_system/config') },
  { rule: 'apps-no-fs', layer: '3_applications/', bad: s => /^(node:)?(fs|fs\/promises|child_process)$/.test(s) },
  { rule: 'apps-no-fileio', layer: '3_applications/', bad: s => /#system\/utils\/FileIO\.mjs$/.test(s) },
  // Application workflows do not own runtime mechanics.
  { rule: 'apps-no-node-infrastructure', layer: '3_applications/', bad: s => /^(node:)?(fs|fs\/promises|path|os|stream|child_process|crypto|vm)$/.test(s) },
  // FileIO.mjs states the rule in its own header: "ALL file operations in
  // adapters/services MUST go through these utilities. NEVER use direct fs.*
  // calls outside of this file." Nothing enforced it, so adapters reached past
  // it — and on 2026-08-26 a lesson-companion record was corrupted by an async
  // read-modify-write over a bare `fs.writeFile`, while the atomic writer that
  // prevents exactly that (`saveYamlToPathAtomic`) had existed in FileIO all
  // along, unused. `path` is deliberately NOT flagged: joining paths is not I/O.
  { rule: 'adapters-no-direct-fs', layer: '1_adapters/', bad: s => /^(node:)?(fs|fs\/promises)$/.test(s) },
  { rule: 'adapters-no-config-singleton', layer: '1_adapters/', bad: (s, p) => /^#system\/config\//.test(s) || targetsLayer(p, '0_system/config') },
  { rule: 'adapters-no-rendering', layer: '1_adapters/', bad: (s, p) => /^#rendering\//.test(s) || targetsLayer(p, '1_rendering') },
  { rule: 'adapters-no-app-internals', layer: '1_adapters/', bad: (s, p) => {
    const targetsApplication = /^#apps\//.test(s) || targetsLayer(p, '3_applications');
    const targetsPort = /^#apps\/.*\/ports\//.test(s) || p?.includes('/3_applications/') && p.includes('/ports/');
    return targetsApplication && !targetsPort;
  } },
  { rule: 'adapters-no-cross-adapter', layer: '1_adapters/', bad: (s, p, source) => {
    const sourceFamily = adapterFamily(source);
    const target = p || (/^#adapters\//.test(s) ? projectSpecifier(source, s) : null);
    const targetFamily = adapterFamily(target);
    return Boolean(sourceFamily && targetFamily && sourceFamily !== targetFamily);
  } },
  { rule: 'rendering-no-adapters-apps', layer: '1_rendering/', bad: (s, p) => /^#(adapters|apps|applications)\//.test(s) || targetsLayer(p, '1_adapters', '3_applications') },
  { rule: 'api-no-adapters', layer: '4_api/', bad: (s, p) => /^#adapters\//.test(s) || /1_adapters\//.test(s) || targetsLayer(p, '1_adapters') },
  { rule: 'api-no-apps', layer: '4_api/', bad: (s, p) => /^#(apps|applications)\//.test(s) || /3_applications\//.test(s) || targetsLayer(p, '3_applications') },
  { rule: 'api-no-domains', layer: '4_api/', bad: (s, p) => /^#domains\//.test(s) || /2_domains\//.test(s) || targetsLayer(p, '2_domains') },
  { rule: 'api-no-config', layer: '4_api/', bad: (s, p) => /^#system\/config\//.test(s) || targetsLayer(p, '0_system/config') },
  { rule: 'api-no-rendering', layer: '4_api/', bad: (s, p) => /^#rendering\//.test(s) || targetsLayer(p, '1_rendering') },
  { rule: 'api-no-fileio', layer: '4_api/', bad: s => /#system\/utils\/FileIO\.mjs$/.test(s) },
  // API is an HTTP driving adapter, not a filesystem/process adapter.
  { rule: 'api-no-node-infrastructure', layer: '4_api/', bad: s => /^(node:)?(fs|fs\/promises|path|os|stream|child_process|crypto)$/.test(s) },
  // Composition binds capabilities; it must not perform persistence or spawn
  // processes itself. Named adapters own those mechanics.
  { rule: 'composition-no-fileio', layer: 'backend/src/', bad: (s, p, source) => isCompositionSource(source) && /(?:#system\/utils\/FileIO\.mjs$|0_system\/utils\/FileIO\.mjs$)/.test(s) },
  { rule: 'composition-no-direct-runtime-io', layer: 'backend/src/', bad: (s, p, source) => isCompositionSource(source) && /^(node:)?(fs|fs\/promises|child_process)$/.test(s) },
  { rule: 'no-applications-alias', layer: 'backend/src/', bad: s => /^#applications\//.test(s) },
  { rule: 'no-deep-relative-layer-cross', layer: 'backend/src/', bad: s => /^(\.\.\/){3,}.*(0_system|1_adapters|1_rendering|2_domains|3_applications|4_api)\//.test(s) },
];

// AST semantic rules. These cannot be expressed accurately as line regexes:
// `new Date(value)` is parsing, while `new Date()` is an ambient clock; a
// locally injected `fetch` is a port, while the unbound global is raw network
// infrastructure. Confirmed architecture rules are hard gates at zero.
export const AST_SEMANTIC_RULES = Object.freeze([
  { rule: 'domains-no-ambient-clock' },
  { rule: 'domains-nondeterminism' },
  { rule: 'apps-no-global-fetch' },
  { rule: 'apps-no-global-process' },
  { rule: 'apps-no-global-timers' },
  { rule: 'apps-no-generic-eventbus' },
  { rule: 'apps-no-config-service-access' },
  { rule: 'api-no-global-fetch' },
  { rule: 'api-no-global-process' },
  { rule: 'composition-no-global-fetch' },
  { rule: 'domains-no-application-ports' },
  { rule: 'ports-outside-applications' },
  // Graph-level port governance. A port that is referenced only by a barrel is
  // dead or aspirational until a production consumer proves otherwise. D7 is
  // narrower: when an adapter imports an application port directly, its class
  // must explicitly extend that port rather than relying on duck typing.
  { rule: 'ports-zero-importers' },
  { rule: 'adapters-port-not-extended' },
  { rule: 'adapters-port-contract-not-class' },
]);

// The application layer must describe capabilities in business language. This
// report groups every hard rule that detects an application reaching directly
// for runtime infrastructure, so the pre-commit gate and a human audit use the
// same definition of "application infrastructure".
export const APPLICATION_INFRASTRUCTURE_RULES = Object.freeze([
  'apps-no-adapters',
  'apps-no-config-internals',
  'apps-no-fs',
  'apps-no-fileio',
  'apps-no-node-infrastructure',
  'apps-no-global-fetch',
  'apps-no-global-process',
  'apps-no-global-timers',
  'apps-no-generic-eventbus',
  'apps-no-config-service-access',
  'no-storage-paths',
]);

// Content-based counters (count string occurrences, not imports). Ratcheted
// alongside RULES against the same baseline.
export const CONTENT_RULES = [
  { rule: 'api-handrolled-500', layer: '4_api/', re: /res\.status\(500\)/, exclude: ['4_api/utils/internalError.mjs'] },
  { rule: 'apps-success-false', layer: '3_applications/', re: /\bsuccess:\s*false\b/ },
  // UserDataService is deprecated (Task P2.8): no NEW runtime consumers outside
  // its home or a composition root. Composition is explicitly allowed to bind
  // its legacy methods to narrow ports while the service is retired.
  { rule: 'no-userdataservice', layer: 'backend/src/', re: /userDataService/i, exclude: ['0_system/config/', '5_composition/', 'src/app.mjs'] },
  // Serialization ownership (audit D-3): entities must not define their storage
  // format; datastores own hydration/dehydration. Counts toJSON() method
  // DEFINITIONS (line starts with the method), not `.toJSON()` call sites.
  // Migration: docs/_wip/plans/2026-07-08-serialization-ownership-migration.md
  { rule: 'domains-tojson', layer: '2_domains/', re: /^\s*toJSON\s*\(\s*\)\s*\{/ },
  // Stored-record hydration belongs to adapters/application mappers, not domain
  // entities or value objects. Constructors accept already-reconstituted props.
  { rule: 'domains-fromjson', layer: '2_domains/', re: /^\s*static fromJSON\s*\(/ },
  // STORAGE LAYOUT BELONGS TO THE ADAPTER. A `household/<domain>` path literal
  // — or the segmented `'household', '<domain>'` join — outside the adapter
  // and config layers means application or API code is deciding where bytes
  // live. application-layer-guidelines.md states it plainly: "Application
  // layer never builds file paths."
  //
  // This is not theoretical tidiness. The 2026-08-16 household reorganization
  // should have touched ~25 adapter files; it touched ~90, because five
  // hardware relays, an API router and two application services each carried
  // their own copy of the layout.
  //
  // Excluded, deliberately:
  //   1_adapters/, 0_system/config/  — they OWN storage addressing
  //   5_composition/, app.mjs        — the composition root's job is wiring
  //   3_applications/admin/          — an admin surface over household/config
  //                                    and household/auth, which are NOT
  //                                    domains and never move
  {
    rule: 'no-storage-paths',
    // backend/src plus shared/ — library code that several entry points reuse.
    // cli/ is deliberately NOT here: a CLI is its own composition root, so
    // naming a path there is legitimate wiring, not a layer violation. What
    // the chess archive bug actually showed is that a reader and a writer must
    // share one constant; that is `npm run audit:paths`'s job, not this rule's.
    layer: ['backend/src/', 'shared/'],
    re: /['"`]household\/[a-z]|'household'\s*,\s*'/,
    exclude: ['1_adapters/', '0_system/config/', '5_composition/', 'src/app.mjs', '3_applications/admin/'],
  },
];

const DOMAIN_HIERARCHY_RULE = 'domains-no-upward-domain-imports';

export function scanContent(filePath, content) {
  const out = [];
  const lines = content.split('\n');
  for (const r of CONTENT_RULES) {
    const layers = Array.isArray(r.layer) ? r.layer : [r.layer];
    if (!layers.some((l) => filePath.includes(l))) continue;
    const excludes = Array.isArray(r.exclude) ? r.exclude : (r.exclude ? [r.exclude] : []);
    if (excludes.some((e) => filePath.includes(e))) continue;
    lines.forEach((line, i) => {
      if (r.re.test(line)) out.push({ rule: r.rule, file: filePath, line: i + 1, spec: line.trim() });
    });
  }
  return out;
}

export function scanViolations(filePath, content) {
  const out = [];
  const lines = content.split('\n');
  for (const r of RULES) {
    if (!filePath.includes(r.layer)) continue;
    if (r.exempt?.(filePath)) continue;
    lines.forEach((line, i) => {
      const m = line.match(IMPORT_RE);
      if (m && r.bad(m[1], null, filePath)) out.push({ rule: r.rule, file: filePath, line: i + 1, spec: m[1] });
    });
  }
  return out;
}

/**
 * Parse module references rather than relying on one-line import syntax.
 * This scanner catches
 * multiline declarations, literal dynamic imports, CommonJS require calls, and
 * relative references that cross a numbered layer.
 */
export function scanAstViolations(filePath, content) {
  const references = [];
  const out = [];
  const ast = parse(content, {
    sourceType: 'unambiguous',
    plugins: ['dynamicImport', 'importAttributes', 'topLevelAwait'],
  });
  const add = (node, specifier) => {
    if (typeof specifier !== 'string') return;
    references.push({
      specifier,
      resolved: resolvedSpecifier(filePath, specifier),
      line: node.loc?.start?.line ?? 1,
    });
  };
  traverse(ast, {
    ImportDeclaration(path) { add(path.node, path.node.source.value); },
    ExportNamedDeclaration(path) { if (path.node.source) add(path.node, path.node.source.value); },
    ExportAllDeclaration(path) { add(path.node, path.node.source.value); },
    ImportExpression(path) {
      add(path.node, staticModuleSpecifier(path.node.source));
    },
    AssignmentPattern(path) {
      const value = path.node.right;
      if (filePath.includes('2_domains/') && value?.type === 'MemberExpression' && !value.computed &&
          value.object?.type === 'Identifier' && value.object.name === 'Math' &&
          value.property?.type === 'Identifier' && value.property.name === 'random' &&
          !path.scope.getBinding('Math')) {
        out.push({ rule: 'domains-nondeterminism', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'Math.random default' });
      }
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const isImport = callee.type === 'Import';
      const isRequire = callee.type === 'Identifier' && callee.name === 'require';
      const isModuleRequire = callee.type === 'MemberExpression'
        && !callee.computed
        && callee.property?.type === 'Identifier'
        && callee.property.name === 'require';
      if (isImport || isRequire || isModuleRequire) add(path.node, staticModuleSpecifier(args[0]));

      if (filePath.includes('2_domains/')) {
        if (callee.type === 'MemberExpression' && !callee.computed &&
            callee.object.type === 'Identifier' && callee.object.name === 'Date' &&
            callee.property.type === 'Identifier' && callee.property.name === 'now' &&
            !path.scope.getBinding('Date')) {
          out.push({ rule: 'domains-no-ambient-clock', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'Date.now()' });
        }
        if (callee.type === 'MemberExpression' && !callee.computed &&
            callee.object.type === 'Identifier' && callee.object.name === 'Math' &&
            callee.property.type === 'Identifier' && callee.property.name === 'random' &&
            !path.scope.getBinding('Math')) {
          out.push({ rule: 'domains-nondeterminism', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'Math.random()' });
        }
        if (callee.type === 'Identifier' && /^(randomUUID|uuidv4|randomBytes|randomFillSync|randomInt|getRandomValues)$/.test(callee.name)) {
          out.push({ rule: 'domains-nondeterminism', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: `${callee.name}()` });
        }
        if (callee.type === 'MemberExpression' && !callee.computed &&
            callee.property.type === 'Identifier' &&
            /^(randomUUID|randomBytes|randomFillSync|randomInt|getRandomValues)$/.test(callee.property.name)) {
          out.push({ rule: 'domains-nondeterminism', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: `${callee.property.name}()` });
        }
      }

      if (filePath.includes('3_applications/') && callee.type === 'Identifier' &&
          callee.name === 'fetch' && !path.scope.getBinding('fetch')) {
        out.push({ rule: 'apps-no-global-fetch', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'global fetch()' });
      }
      if (filePath.includes('4_api/') && callee.type === 'Identifier' &&
          callee.name === 'fetch' && !path.scope.getBinding('fetch')) {
        out.push({ rule: 'api-no-global-fetch', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'global fetch()' });
      }
      if (isCompositionSource(filePath) && callee.type === 'Identifier' &&
          callee.name === 'fetch' && !path.scope.getBinding('fetch')) {
        out.push({ rule: 'composition-no-global-fetch', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'global fetch()' });
      }
      if (filePath.includes('3_applications/') && callee.type === 'Identifier' &&
          /^(setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|clearImmediate)$/.test(callee.name) &&
          !path.scope.getBinding(callee.name)) {
        out.push({ rule: 'apps-no-global-timers', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: `${callee.name}()` });
      }
    },
    NewExpression(path) {
      if (filePath.includes('2_domains/') && path.node.callee.type === 'Identifier' &&
          path.node.callee.name === 'Date' && path.node.arguments.length === 0 &&
          !path.scope.getBinding('Date')) {
        out.push({ rule: 'domains-no-ambient-clock', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'new Date()' });
      }
    },
    MemberExpression(path) {
      if (path.node.object.type !== 'Identifier' || path.node.object.name !== 'process' ||
          path.scope.getBinding('process')) return;
      const rule = filePath.includes('3_applications/')
        ? 'apps-no-global-process'
        : filePath.includes('4_api/') ? 'api-no-global-process' : null;
      if (rule) out.push({ rule, file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'global process' });
    },
    ReferencedIdentifier(path) {
      if (filePath.includes('3_applications/') && path.node.name === 'eventBus') {
        out.push({ rule: 'apps-no-generic-eventbus', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'generic eventBus dependency' });
      }
      if (filePath.includes('3_applications/') && path.node.name === 'configService') {
        out.push({ rule: 'apps-no-config-service-access', file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'raw configService dependency' });
      }
      if (path.node.name !== 'fetch' || path.scope.getBinding('fetch')) return;
      if (path.parentPath.isCallExpression() && path.parentPath.node.callee === path.node) return;
      const rule = filePath.includes('3_applications/')
        ? 'apps-no-global-fetch'
        : filePath.includes('4_api/') ? 'api-no-global-fetch'
          : isCompositionSource(filePath) ? 'composition-no-global-fetch' : null;
      if (rule) out.push({ rule, file: filePath, line: path.node.loc?.start?.line ?? 1, spec: 'global fetch reference' });
    },
  });

  for (const r of RULES) {
    if (!filePath.includes(r.layer) || r.exempt?.(filePath)) continue;
    for (const ref of references) {
      if (r.bad(ref.specifier, ref.resolved, filePath)) {
        out.push({ rule: r.rule, file: filePath, line: ref.line, spec: ref.specifier });
      }
    }
  }
  if (filePath.includes('2_domains/') &&
      (filePath.includes('/ports/') || /\/I[A-Z][^/]*\.mjs$/.test(filePath))) {
    out.push({ rule: 'domains-no-application-ports', file: filePath, line: 1, spec: 'application-facing port declared in domain layer' });
  }
  return out;
}

/** Enforce Decision D6 using the same AST reference collection as the main
 * scanner. Unlike regex counting, this catches multiline/dynamic and relative
 * imports. */
export function scanDomainHierarchyViolations(filePath, content) {
  const sourceDomain = domainFromPath(filePath);
  if (!sourceDomain || DOMAIN_LEVELS[sourceDomain] === undefined) return [];
  const references = [];
  const ast = parse(content, { sourceType: 'unambiguous', plugins: ['dynamicImport', 'importAttributes', 'topLevelAwait'] });
  const add = (node, specifier) => {
    if (typeof specifier === 'string') references.push({ specifier, resolved: resolvedSpecifier(filePath, specifier), line: node.loc?.start?.line ?? 1 });
  };
  traverse(ast, {
    ImportDeclaration(path) { add(path.node, path.node.source.value); },
    ExportNamedDeclaration(path) { if (path.node.source) add(path.node, path.node.source.value); },
    ExportAllDeclaration(path) { add(path.node, path.node.source.value); },
    ImportExpression(path) { add(path.node, staticModuleSpecifier(path.node.source)); },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const isImport = callee.type === 'Import';
      const isRequire = callee.type === 'Identifier' && callee.name === 'require';
      const isModuleRequire = callee.type === 'MemberExpression'
        && !callee.computed
        && callee.property?.type === 'Identifier'
        && callee.property.name === 'require';
      if (isImport || isRequire || isModuleRequire) add(path.node, staticModuleSpecifier(args[0]));
    },
  });
  return references.flatMap((reference) => {
    const targetDomain = domainFromSpecifier(reference.specifier, reference.resolved);
    if (!targetDomain || targetDomain === sourceDomain || DOMAIN_LEVELS[targetDomain] === undefined) return [];
    return DOMAIN_LEVELS[targetDomain] > DOMAIN_LEVELS[sourceDomain]
      ? [{ rule: 'domains-no-upward-domain-imports', file: filePath, line: reference.line, spec: `${sourceDomain} -> ${targetDomain} (${reference.specifier})` }]
      : [];
  });
}

const PORT_PATH_RE = /\/3_applications\/.*\/ports\/[^/]+\.mjs$/;
const ANY_PORT_PATH_RE = /\/ports\/[^/]+\.mjs$/;

function projectSpecifier(filePath, specifier) {
  const aliases = {
    '#system/': 'backend/src/0_system/',
    '#adapters/': 'backend/src/1_adapters/',
    '#rendering/': 'backend/src/1_rendering/',
    '#domains/': 'backend/src/2_domains/',
    '#apps/': 'backend/src/3_applications/',
    '#api/': 'backend/src/4_api/',
    '#composition/': 'backend/src/5_composition/',
  };
  for (const [prefix, target] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) return resolve(target, specifier.slice(prefix.length));
  }
  return resolvedSpecifier(resolve(filePath), specifier);
}

function portModuleMetadata(filePath, content) {
  const references = [];
  const reexports = [];
  const adapterPortBindings = [];
  const superClasses = new Set();
  const exportedClasses = new Set();
  const ast = parse(content, {
    sourceType: 'unambiguous',
    plugins: ['dynamicImport', 'importAttributes', 'topLevelAwait'],
  });
  const addReference = (node, specifier, bindings = [], importedNames = ['*']) => {
    if (typeof specifier !== 'string') return;
    references.push({
      target: projectSpecifier(filePath, specifier),
      line: node.loc?.start?.line ?? 1,
      specifier,
      importedNames,
    });
    if (filePath.includes('/1_adapters/') && bindings.length) {
      adapterPortBindings.push({
        target: projectSpecifier(filePath, specifier),
        line: node.loc?.start?.line ?? 1,
        specifier,
        bindings,
      });
    }
  };
  traverse(ast, {
    ImportDeclaration(path) {
      const bindings = path.node.specifiers.map((specifier) => {
        if (specifier.type === 'ImportDefaultSpecifier') return 'default';
        if (specifier.type === 'ImportNamespaceSpecifier') return '*';
        return specifier.imported?.name ?? specifier.imported?.value;
      }).map((imported, index) => ({ imported, local: path.node.specifiers[index].local?.name }))
        .filter(({ imported, local }) => imported && local);
      addReference(path.node, path.node.source.value, bindings, bindings.map(({ imported }) => imported));
    },
    ExportNamedDeclaration(path) {
      if (path.node.declaration?.type === 'ClassDeclaration' && path.node.declaration.id?.name) {
        exportedClasses.add(path.node.declaration.id.name);
      }
      if (path.node.source) {
        const target = projectSpecifier(filePath, path.node.source.value);
        const names = path.node.specifiers.map((specifier) => ({
          imported: specifier.local?.name ?? specifier.local?.value,
          exported: specifier.exported?.name ?? specifier.exported?.value,
        }));
        addReference(path.node, path.node.source.value, [], names.map(({ imported }) => imported));
        reexports.push({ target, names, all: false });
      }
    },
    ExportAllDeclaration(path) {
      const target = projectSpecifier(filePath, path.node.source.value);
      addReference(path.node, path.node.source.value);
      reexports.push({ target, names: [], all: true });
    },
    ExportDefaultDeclaration(path) {
      if (path.node.declaration?.type === 'ClassDeclaration') exportedClasses.add('default');
    },
    ImportExpression(path) {
      addReference(path.node, staticModuleSpecifier(path.node.source));
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const isImport = callee.type === 'Import';
      const isRequire = callee.type === 'Identifier' && callee.name === 'require';
      const isModuleRequire = callee.type === 'MemberExpression'
        && !callee.computed
        && callee.property?.type === 'Identifier'
        && callee.property.name === 'require';
      if (isImport || isRequire || isModuleRequire) addReference(path.node, staticModuleSpecifier(args[0]));
    },
    Class(path) {
      if (path.node.superClass?.type === 'Identifier') superClasses.add(path.node.superClass.name);
    },
  });
  return { filePath: resolve(filePath), references, reexports, adapterPortBindings, superClasses, exportedClasses };
}

/** Analyze D7 and dead-port governance across the complete production module
 * graph. Zero-importer findings are discovery-only because a public extension
 * point can be intentionally consumed outside this repository. */
export function analyzePortGovernance(modules) {
  const metadata = modules
    .filter(({ file }) => !isTest(file))
    .map(({ file, content }) => portModuleMetadata(file, content));
  const portFiles = new Set(metadata
    .map(({ filePath }) => filePath)
    .filter((filePath) => PORT_PATH_RE.test(filePath) && !filePath.endsWith('/ports/index.mjs')));
  const incoming = new Map([...portFiles].map((filePath) => [filePath, []]));
  const findings = [];

  for (const module of metadata) {
    if (ANY_PORT_PATH_RE.test(module.filePath) &&
        !module.filePath.includes('/3_applications/') &&
        !module.filePath.endsWith('/ports/index.mjs')) {
      findings.push({
        rule: 'ports-outside-applications',
        file: module.filePath,
        line: 1,
        spec: 'D3 requires application-facing ports under 3_applications/*/ports/',
      });
    }
  }

  for (const module of metadata) {
    for (const reference of module.references) {
      if (!portFiles.has(reference.target)) continue;
      incoming.get(reference.target).push({ filePath: module.filePath, importedNames: reference.importedNames });
    }
    for (const imported of module.adapterPortBindings) {
      if (!portFiles.has(imported.target)) continue;
      if (module.filePath.endsWith('/index.mjs')) continue;
      const portModule = metadata.find(({ filePath }) => filePath === imported.target);
      const classBindings = imported.bindings.filter(({ imported: importedName }) =>
        /^I[A-Z]/.test(importedName) && portModule?.exportedClasses.has(importedName));
      const nonClassPortBindings = imported.bindings.filter(({ imported: importedName }) =>
        /^I[A-Z]/.test(importedName) && !portModule?.exportedClasses.has(importedName));
      for (const binding of nonClassPortBindings) {
        findings.push({
          rule: 'adapters-port-contract-not-class',
          file: module.filePath,
          line: imported.line,
          spec: `${imported.specifier}#${binding.imported}`,
        });
      }
      for (const binding of classBindings) {
        if (module.superClasses.has(binding.local)) continue;
        findings.push({
          rule: 'adapters-port-not-extended',
          file: module.filePath,
          line: imported.line,
          spec: `${imported.specifier}#${binding.imported}`,
        });
      }
    }
  }

  for (const [portFile, importers] of incoming) {
    const liveImporters = importers.filter(({ filePath }) => !filePath.endsWith('/index.mjs'));
    const barrels = metadata.filter((module) => module.filePath.endsWith('/index.mjs') &&
      module.reexports.some((reexport) => reexport.target === portFile));
    for (const barrel of barrels) {
      const exportRule = barrel.reexports.find((reexport) => reexport.target === portFile);
      const exportedNames = new Set(exportRule?.names.map(({ exported }) => exported).filter(Boolean));
      for (const consumer of metadata) {
        if (consumer.filePath.endsWith('/index.mjs')) continue;
        for (const reference of consumer.references.filter(({ target }) => target === barrel.filePath)) {
          if (exportRule?.all || reference.importedNames.includes('*') ||
              reference.importedNames.some((name) => exportedNames.has(name))) {
            liveImporters.push({ filePath: consumer.filePath, importedNames: reference.importedNames });
          }
        }
      }
    }
    if (liveImporters.length === 0) {
      findings.push({
        rule: 'ports-zero-importers',
        file: portFile,
        line: 1,
        spec: 'no static production importer outside a barrel module',
      });
    }
  }
  return findings;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.mjs') && !isTest(p)) acc.push(p);
  }
  return acc;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const indexFiles = staged ? listIndexFiles(['backend/src', 'shared', 'cli', 'scripts/audit-baseline.json']) : [];
  // backend/src plus the trees that also address storage. Every other rule is
  // scoped by its own `layer` filter, so only no-storage-paths sees these.
  const files = staged
    ? indexFiles.filter((file) => (file.startsWith('backend/src/') || file.startsWith('shared/')) && file.endsWith('.mjs') && !isTest(file))
    : ['backend/src', 'shared'].flatMap((d) => walk(d));
  const portGraphFiles = [...files, ...(staged
    ? indexFiles.filter((file) => file.startsWith('cli/') && file.endsWith('.mjs') && !isTest(file))
    : (existsSync('cli') ? walk('cli') : []))];
  const indexSnapshot = staged ? readIndexFiles([...new Set([...portGraphFiles, 'scripts/audit-baseline.json'])]) : null;
  const readSource = staged ? (file) => indexSnapshot.get(file) ?? readIndexFile(file) : (file) => readFileSync(file, 'utf8');
  const useAstReport = args.includes('--ast-report');
  const useDomainHierarchyReport = args.includes('--domain-hierarchy-report');
  // AST is authoritative in both modes. --ast-report remains useful because it
  // prints the complete object without comparing or rewriting the ratchet.
  const all = files.flatMap(f => scanAstViolations(f, readSource(f)));
  const domainHierarchy = files.flatMap(f => scanDomainHierarchyViolations(f, readSource(f)));
  const portGovernance = analyzePortGovernance(portGraphFiles.map((file) => ({ file, content: readSource(file) })));
  const allContent = files.flatMap(f => scanContent(f, readSource(f)));
  const counts = {};
  for (const r of RULES) counts[r.rule] = all.filter(v => v.rule === r.rule).length;
  for (const r of AST_SEMANTIC_RULES) counts[r.rule] = all.filter(v => v.rule === r.rule).length;
  for (const rule of ['ports-outside-applications', 'ports-zero-importers', 'adapters-port-not-extended', 'adapters-port-contract-not-class']) {
    counts[rule] = portGovernance.filter((finding) => finding.rule === rule).length;
  }
  for (const r of CONTENT_RULES) counts[r.rule] = allContent.filter(v => v.rule === r.rule).length;
  counts[DOMAIN_HIERARCHY_RULE] = domainHierarchy.length;

  const listArg = args.find(a => a.startsWith('--list='));
  if (listArg) {
    const rule = listArg.split('=')[1];
    for (const v of [...all, ...allContent, ...domainHierarchy, ...portGovernance].filter(v => v.rule === rule)) console.log(`${v.file}:${v.line}  ${v.spec}`);
    process.exit(0);
  }
  if (useAstReport) {
    console.log('AST report (does not compare or rewrite ratchet baseline):', counts);
    process.exit(0);
  }
  if (useDomainHierarchyReport) {
    const violations = domainHierarchy;
    for (const violation of violations) console.log(`${violation.file}:${violation.line}  ${violation.spec}`);
    console.log(`Domain hierarchy violations: ${violations.length}`);
    process.exit(violations.length ? 1 : 0);
  }
  if (args.includes('--application-infrastructure-report')) {
    const violations = [...all, ...allContent]
      .filter((violation) => APPLICATION_INFRASTRUCTURE_RULES.includes(violation.rule))
      .filter((violation) => violation.rule !== 'no-storage-paths' || violation.file.includes('3_applications/'));
    for (const violation of violations) {
      console.log(`${violation.rule}  ${violation.file}:${violation.line}  ${violation.spec}`);
    }
    console.log(`Application infrastructure violations: ${violations.length}`);
    process.exit(violations.length ? 1 : 0);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({
      counts,
      findings: [...all, ...allContent, ...domainHierarchy, ...portGovernance],
    }, null, 2));
    process.exit(0);
  }
  if (args.includes('--ports-report')) {
    for (const violation of portGovernance) console.log(`${violation.rule}  ${violation.file}:${violation.line}  ${violation.spec}`);
    const hardFailures = portGovernance.filter((violation) =>
      violation.rule === 'adapters-port-not-extended' ||
      violation.rule === 'adapters-port-contract-not-class' ||
      violation.rule === 'ports-outside-applications');
    console.log(`Port governance findings: ${portGovernance.length} (${hardFailures.length} hard D7 failures)`);
    process.exit(hardFailures.length ? 1 : 0);
  }
  const baselinePath = 'scripts/audit-baseline.json';
  if (staged && args.includes('--update')) {
    console.error('--staged and --update cannot be combined');
    process.exit(1);
  }
  if (args.includes('--update') || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + '\n');
    console.log('Baseline written:', counts);
    process.exit(0);
  }
  const baseline = JSON.parse(staged ? readIndexFile(baselinePath) : readFileSync(baselinePath, 'utf8'));
  let regressed = false;
  for (const [rule, n] of Object.entries(counts)) {
    const base = baseline[rule] ?? 0;
    const mark = n > base ? 'REGRESSION' : n < base ? 'improved' : 'ok';
    if (n > base) regressed = true;
    console.log(`${rule.padEnd(36)} ${String(n).padStart(4)} (baseline ${base}) ${mark}`);
  }
  process.exit(regressed ? 1 : 0);
}
