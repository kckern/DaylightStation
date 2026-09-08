/** Inventory independent runtimes by tracked declarations, never launch/flash them. */
import fs from 'node:fs';
import path from 'node:path';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const source = read('source-ledger.json');
const assets = read('assets-and-storage.json');
const owners = {
  'audio-bridge': ['playback/speech integration', 'Android Java/Gradle'],
  'audio-router': ['playback integration', 'systemd launch declaration; implementation is not tracked here'],
  'content-barcode-relay': ['scan/input capability', 'ESP32 C++/PlatformIO'],
  'document-processor': ['document-processing capability', 'Node service/Docker'],
  'eink-panel': ['eink capability', 'ESP32 C++/PlatformIO'],
  fingerprint: ['household-identity/device integration', 'Node profile-store helper; device runtime is integrated with fitness'],
  fitness: ['fitness product', 'Node/BLE/ANT+/Python helper/Docker'],
  'ir-blaster': ['device-dispatch integration', 'ESP32 C++/PlatformIO'],
  'kitchen-relay': ['scan/nutrition input integration', 'ESP32 C++/PlatformIO'],
  'obd-relay': ['automotive product', 'ESP32 C++/PlatformIO'],
  'omr-relay': ['scan capability; School consumes grades', 'ESP32 C++/PlatformIO'],
  piano: ['piano product; MIDI transport seam separate', 'Python MIDI recorder and Node simulator'],
  'piano-bridge': ['piano/MIDI integration', 'Android Java/native C++/Gradle/CMake'],
  'playback-hub': ['playback-hub capability', 'Python/shell/BlueZ/PipeWire/mpv appliance'],
  'portal-keys': ['screen-host/input integration', 'Android Java/Gradle'],
  'pressure-mat-relay': ['device/input capability', 'ESP32 C++/PlatformIO'],
  'rf-blaster': ['device-dispatch integration', 'ESP32 C++/PlatformIO'],
  'ti86-app': ['school product', 'TI-86 calculator application and host build/test tools'],
  'ticalc-relay': ['school calculator integration', 'ESP32 C++/PlatformIO and TI link transport'],
};
const terms = ['WebSocket', 'MQTT', 'HTTP', 'UDP', 'TCP', 'Bluetooth', 'BLE', 'ANT+', 'MIDI',
  'USB', 'UART', 'serial', 'Paperless', 'PulseAudio', 'mpv', 'TI-86', 'protocol_version'];
const targets = [];
for (const target of assets.extensions) {
  const files = source.files.filter(f => f.path.startsWith(target.sourceRoot + '/'));
  if (!owners[target.id]) throw new Error('Unclassified external runtime ' + target.id);
  const buildInputs = files.filter(f => /(^|\/)(package(?:-lock)?\.json|platformio\.ini|.*gradle(?:\.properties)?|gradle-wrapper\.(?:properties|jar)|gradlew(?:\.bat)?|AndroidManifest\.xml|partitions[^/]*\.csv|CMakeLists\.txt|Makefile|requirements[^/]*\.txt|Dockerfile|.*\.ya?ml|.*\.service|.*\.plist|.*\.cmake)$/.test(f.path));
  const manifests = files.filter(f => /\/package\.json$/.test(f.path)).map(f => {
    const p = JSON.parse(fs.readFileSync(path.join(root, f.path)));
    return {source: f.id, path: f.path, sha256: f.sha256, name: p.name, type: p.type || 'commonjs/default',
      engines: p.engines || null, scripts: Object.keys(p.scripts || {}),
      dependencies: p.dependencies || {}, devDependencies: p.devDependencies || {},
      lock: files.find(l => l.path === f.path.replace(/package\.json$/, 'package-lock.json'))?.id || null};
  });
  const transportEvidence = [], publicPathEvidence = [];
  const inspect = files.filter(f => f.mode !== '120000' && f.bytes < 2 * 1024 * 1024
    && /\.(md|mjs|js|py|sh|cpp|c|h|hpp|java|kt|ino|ini|xml|gradle|service)$/.test(f.path)
    && !/(?:^|\/)(?:vendor|roms|recovered)(?:\/|$)/.test(f.path));
  for (const f of inspect) {
    const lines = fs.readFileSync(path.join(root, f.path), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const matched = terms.filter(term => line.toLowerCase().includes(term.toLowerCase()));
      if (matched.length) transportEvidence.push({source: f.id, path: f.path, line: index + 1, terms: matched,
        evidenceKind: f.path.endsWith('.md') ? 'documentation' : 'source declaration'});
      for (const match of line.matchAll(/\/api\/v1\/[A-Za-z0-9_{}:./*-]+/g))
        publicPathEvidence.push({source: f.id, path: f.path, line: index + 1, route: match[0]});
    });
  }
  const row = {id: 'TARGET-' + target.id, sourceRoot: target.sourceRoot,
    logicalOwner: owners[target.id][0], runtime: owners[target.id][1],
    sourceArtifacts: files.length, sourceIds: files.map(f => f.id), manifests,
    buildInputs: buildInputs.map(f => ({source: f.id, path: f.path, sha256: f.sha256, mode: f.mode})),
    operatorEntries: files.filter(f => f.mode === '100755' || /\.(service|plist)$/.test(f.path)
      || /(^|\/)(flash|build|install|deploy|run|gen-config|fetch-deps|fetch-libs|ota-when-online|simulate-device|pbctl|pkctl|simulation|simulate)[^/]*\.(sh|mjs|py)$/.test(f.path))
      .map(f => ({source: f.id, path: f.path, sha256: f.sha256, mode: f.mode,
        role:/\.test\.|(?:^|\/)tests?\//.test(f.path)?'existing test entry; not automatically safe':/gen-config/.test(f.path)?'private provisioning generator':/fetch-(deps|libs)/.test(f.path)?'dependency download/materialization tool':'operator/build/runtime entry; inspect effects before invocation'})),
    buildIdentity: buildInputs.length
      ? {state: 'tracked build declarations indexed; resolved toolchain/artifact identity not inspected',
        basis: 'buildInputs with source hashes and modes',
        nextAction: 'Use the target-specific build input list to create a disposable identity experiment before relocation; do not infer resolved dependencies from declarations'}
      : {state: 'no tracked local build declaration',
        basis: 'source-root census found no manifest, lock, wrapper, build file or launcher matching reviewed build declarations',
        nextAction: 'Treat build identity as external/unavailable until an attributable source or operator artifact is supplied; do not invent a lock or build step'},
    operatorPathStatus: 'pending',
    transportEvidence, publicPathEvidence,
    relocation: 'retain exact current path throughout Gratitude rehearsal; independent deployments do not automatically join controller workspaces, but central dependency and wire-contract impacts still require review',
    instanceConfiguration: 'Private endpoints, credentials, profiles and generated config excluded; no live files inspected',
    deploymentIdentity: {state: 'not inspected', gapId: 'TARGET-IMAGE-' + target.id,
      owner: 'domain/device reviewer', nextAction: 'Before this target changes, capture actual toolchain/firmware/service identity read-only; never infer it from manifest ranges'},
    protocolStatus: {state: 'source/documentation references inventoried; field-level wire and firmware replay proof pending',
      gapId: 'TARGET-WIRE-' + target.id, owner: 'domain/device reviewer',
      nextAction: 'Review source encoder/decoder and its central consumer together; specify synthetic wire fixtures before any satellite or protocol change'},
    specialLimit: target.id === 'audio-router' ? 'Only systemd unit is tracked; do not copy external implementation or invent its build provenance'
      : target.id === 'fingerprint' ? 'Profile helper is not proof of a separately deployed biometric service; no biometric fixtures copied'
      : null};
  row.operatorPathStatus = row.operatorEntries.length
    ? {state: 'tracked operator entries indexed', basis: 'operatorEntries with source hashes and modes',
      nextAction: 'Preserve each entry path or name an exact replacement in the target implementation card; inspect effects before invocation'}
    : {state: 'no tracked operator entry matched', basis: 'reviewed executable/service/operator filename patterns',
      nextAction: 'Treat any operator invocation as external/unattributed until a source or operator artifact is supplied; do not synthesize a launcher'};
  targets.push(row);
  target.review = {artifact: 'external-targets.json', id: row.id,
    logicalOwner: row.logicalOwner, runtime: row.runtime, deployment: row.deploymentIdentity,
    protocol: row.protocolStatus, relocation: row.relocation};
}
emit('external-targets.json', {schema: 'daylight.preimplementation.external-targets/v1', baseline: source.baseline,
  fieldReview:{artifact:'wire-contract-review.json',narrative:'wire-contract-review.md',scope:'selected source-boundary reviews, attributable absent implementations and cross-root operator references; see per-target remaining gaps'},
  targets, limits: ['Tracked source/build declarations only, not live or reproducible build certification',
    'Keyword provenance is an index for field-level protocol review, not automatic ownership or schema inference',
    'Operator path lists omit machine-specific contents; current files remain byte-identical',
    'No dependencies installed, hardware accessed, firmware flashed or services started']});
emit('assets-and-storage.json', assets);
process.stdout.write(JSON.stringify({targets: targets.length, buildInputs: targets.reduce((n, t) => n + t.buildInputs.length, 0),
  protocolReferences: targets.reduce((n, t) => n + t.transportEvidence.length, 0)}) + '\n');
