/** Read-only package-instance provenance for the reviewed foundation closure. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const toolRoot = process.env.PRE_TOOLCHAIN_ROOT && fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
assert.ok(toolRoot, 'PRE_TOOLCHAIN_ROOT must identify the inspected installed checkout');
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const ledger = read('dependency-ledger.json');
const boundary = read('boundary-review.json');
const focus = new Set(boundary.files.map(file => file.path));
const packageEdges = ledger.edges.filter(edge => focus.has(edge.from) && edge.kind === 'package');
assert.equal(packageEdges.length, 20, 'Review scope drift: recertify package provenance deliberately');

const manifest = instance => {
  assert.match(instance, /^(backend|frontend|node_modules)\//, 'Unexpected installed package instance: ' + instance);
  const file = path.join(toolRoot, instance, 'package.json');
  assert.ok(fs.existsSync(file), 'Missing inspected manifest: ' + instance);
  const json = JSON.parse(fs.readFileSync(file));
  return {path: instance, version: json.version, name: json.name};
};
const resolved = packageEdges.map(edge => {
  assert.ok(edge.package?.instance && edge.package?.name, 'Package edge has no canonical instance: ' + edge.id);
  const installed = manifest(edge.package.instance);
  assert.equal(installed.name, edge.package.name, 'Package name mismatch for ' + edge.id);
  return {
    edgeId: edge.id,
    importer: edge.from,
    line: edge.line,
    specifier: edge.specifier,
    package: {name: installed.name, version: installed.version, instancePath: installed.path, entryPath: edge.target}
  };
});
const instances = [...new Map(resolved.map(record => [record.package.instancePath, record.package])).values()]
  .sort((a, b) => a.instancePath.localeCompare(b.instancePath));
const exact = (instance, version) => {
  const item = manifest(instance);
  assert.equal(item.version, version, 'Installed package provenance changed: ' + instance);
  return {...item, instancePath: instance};
};

emit('package-provenance.json', {
  schema: 'daylight.preimplementation.package-provenance/v1',
  scope: {
    selectedSources: boundary.files.length,
    selectedPackageEdges: packageEdges.length,
    definition: 'Only the 50 reviewed Gratitude/shared-prerequisite foundation sources selected by boundary-review.json. This is not a repository-wide package adoption or lock/build proof.'
  },
  resolvedImporters: resolved,
  resolvedInstances: instances,
  identityControls: {
    mustShare: [
      {id: 'PKG-SHARE-REACT', package: exact('frontend/node_modules/react', '18.3.1'), importers: resolved.filter(r => r.package.name === 'react').map(r => r.edgeId),
        rule: 'One React module instance must serve the current provider, consumer and ReactDOM renderer graph; copying React must fail the hooks/context control.',
        evidence: ['CASE-PKG-REACT in cases/packages.case.mjs']},
      {id: 'PKG-SHARE-CANVAS', package: exact('backend/node_modules/canvas', '3.1.0'), importers: resolved.filter(r => r.package.name === 'canvas').map(r => r.edgeId),
        rule: 'Moved and retained backend rendering callers must resolve the same backend native canvas instance; registered fonts are process-global.',
        evidence: ['CASE-PKG-NATIVE in cases/packages.case.mjs', 'rendering-identity receipt']}
    ],
    mustSeparate: [
      {id: 'PKG-SEPARATE-TIMEZONE', packages: [exact('backend/node_modules/moment-timezone', '0.6.0'), exact('frontend/node_modules/moment-timezone', '0.5.47'), exact('node_modules/moment-timezone', '0.5.46')],
        rule: 'Server, web and root timezone instances are distinct current scopes; do not hoist or collapse them as a relocation side effect.',
        evidence: ['CASE-PKG-ACTUAL-TIMEZONES', 'CASE-PKG-ROOT-TIMEZONE', 'run-package-install red/restored controls']},
      {id: 'PKG-SEPARATE-CANVAS', packages: [exact('backend/node_modules/canvas', '3.1.0'), exact('node_modules/canvas', '3.2.1')],
        rule: 'Backend and root canvas constructors/modules are distinct current native identities; root resolution is a deliberate red control, not a fallback.',
        evidence: ['CASE-PKG-NATIVE', 'rendering-identity root-canvas-fallback red control']}
    ],
    sourceSingletons: [
      {id: 'SRC-SINGLETON-WEBSOCKET-CONTEXT', source: 'frontend/src/contexts/WebSocketContext.jsx', rule: 'Keep one context object with its matching React provider/consumer instance.'},
      {id: 'SRC-SINGLETON-LOGGING', source: 'backend/src/0_system/logging/dispatcher.mjs', rule: 'Keep one current mutable dispatcher per existing server graph; facade forwarding cannot duplicate it.'},
      {id: 'SRC-SINGLETON-BROWSER', source: 'frontend/src/services/WebSocketService.js', rule: 'Keep current browser service identity and scope; do not merge it with server or product state.'}
    ]
  },
  limits: [
    'Resolves installed manifests and static import targets only; no source, manifest, lockfile or installed package is changed.',
    'The 20 exact importer records cover the reviewed foundation closure. Other repository importers remain in dependency-ledger.json and require their own move-card closure.',
    'Current installed versions are characterization, not npm workspace adoption, complete lock/range/peer reconciliation, ABI portability, Linux image or production-runtime proof.'
  ]
});
process.stdout.write(JSON.stringify({selectedPackageEdges: resolved.length, instances: instances.length, output: 'package-provenance.json'}) + '\n');
