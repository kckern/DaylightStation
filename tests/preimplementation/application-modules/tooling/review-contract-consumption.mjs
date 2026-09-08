/** Per-symbol contract-consumption review; declarative data is not a loophole for executable code. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const ledger = read('dependency-ledger.json');
const source = 'shared/contracts/householdConfig.mjs';
const imports = ledger.edges.filter(edge => edge.target === source);
assert.equal(imports.length, 11, 'Household contract consumer population changed: recertify each symbol');
const consumers = Object.fromEntries(['HOUSEHOLD_APP_CONFIGS', 'appConfigRelPath', 'allAppNames'].map(symbol => [symbol,
  imports.filter(edge => edge.symbols?.some(item => item.imported === symbol || item.imported === '*')).map(edge => ({
    edgeId: edge.id, importer: edge.from, line: edge.line,
    imported: edge.symbols.filter(item => item.imported === symbol || item.imported === '*').map(item => item.imported)
  }))]));
assert.equal(consumers.HOUSEHOLD_APP_CONFIGS.length, 10);
assert.equal(consumers.appConfigRelPath.length, 2, 'One ConfigService import plus namespace contract test');
assert.equal(consumers.allAppNames.length, 1, 'Only namespace contract test currently reaches allAppNames');
const boundary = read('boundary-review.json');
const record = boundary.files.find(file => file.path === source);
assert.ok(record, 'Missing reviewed household contract source');
const exports = Object.fromEntries(record.exports.map(item => [item.name, item]));
assert.equal(exports.HOUSEHOLD_APP_CONFIGS.proposedEntry, '@daylight/contracts/household-config');
assert.equal(exports.appConfigRelPath.proposedEntry, null);
assert.equal(exports.allAppNames.proposedEntry, null);
emit('contract-consumption-review.json', {
  schema: 'daylight.preimplementation.contract-consumption-review/v1',
  contract: {source, entry: '@daylight/contracts/household-config', permittedExport: 'HOUSEHOLD_APP_CONFIGS'},
  symbols: [
    {symbol: 'HOUSEHOLD_APP_CONFIGS', kind: 'immutable declarative name-to-relative-path registry', public: true, consumers: consumers.HOUSEHOLD_APP_CONFIGS,
      operations: ['property lookup', 'Object.entries/Object.values for loader/allowlist/migration projection'], closure: 'No I/O, clock, serialization, port, adapter, service construction or product workflow is included.'},
    {symbol: 'appConfigRelPath', kind: 'executable system lookup helper', public: false, futurePrivateSource: 'platform/server/system/config/householdConfigLookup.mjs', consumers: consumers.appConfigRelPath,
      operations: ['registered path or null lookup'], closure: 'ConfigService is the only production caller; the namespace test is a current compatibility consumer that must be split/retargeted with the helper.'},
    {symbol: 'allAppNames', kind: 'executable system enumeration helper', public: false, futurePrivateSource: 'platform/server/system/config/householdConfigLookup.mjs', consumers: consumers.allAppNames,
      operations: ['fresh Object.keys enumeration'], closure: 'Only the current namespace contract test reaches it; no public export is selected.'}
  ],
  explicitlyNotSanctioned: [
    {kind: 'clocked builders', reason: 'Time/default policy is executable; D4/D8 and its owner layer remain binding.'},
    {kind: 'serializers/normalizers', reason: 'Executable representation behavior is not immutable naming data.'},
    {kind: 'application ports or adapters', reason: 'D3/D7 place ports and their implementations in owner application/adapter layers.'},
    {kind: 'gaming rules, score/turn orchestration or presenters', reason: 'These belong to Gaming mechanism/experience/environment owners, not contracts.'},
    {kind: 'cross-owner private source', reason: 'A public contract entry does not grant internal-facet or private-module imports.'}
  ],
  implementationGate: {card: 'IMP-BASE.04', required: 'Extract both helpers privately while retaining the exact frozen map binding and reject helper public exports/duplicate registries in red controls.'},
  limits: ['This records one selected declarative household contract only; it does not classify all existing shared/contracts modules as public application contracts.', 'No existing source, export, package manifest or reference guide is changed.']
});
process.stdout.write(JSON.stringify({imports: imports.length, publicConsumers: consumers.HOUSEHOLD_APP_CONFIGS.length, privateHelperConsumers: consumers.appConfigRelPath.length + consumers.allAppNames.length, output: 'contract-consumption-review.json'}) + '\n');
