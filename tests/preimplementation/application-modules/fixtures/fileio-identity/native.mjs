/** Runs only after copying this template into the isolated fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as publicIO from '@daylight/platform/server/system/utils/file-io';
import * as privateIO from '@daylight-internal/platform--server/system/utils/file-io';

const expected = JSON.parse(fs.readFileSync(new URL('./expected-public.json', import.meta.url), 'utf8'));
const names = expected.names.sort();
assert.equal(Object.keys(privateIO).length, 77);
assert.equal(names.length, expected.selected ? 73 : 77);
assert.deepEqual(Object.keys(publicIO).sort(), names, 'FILEIO_EXPORT_POPULATION');
for (const name of names) assert.equal(publicIO[name], privateIO[name], 'FILEIO_BINDING_IDENTITY: ' + name);
for (const name of expected.privateOnly) {
  assert.equal(typeof privateIO[name], 'function');
  assert.equal(Object.hasOwn(publicIO, name), false, 'Private-only helper leaked through public entry');
}
assert.notEqual(publicIO, privateIO, 'Facades are distinct module namespaces, not duplicate implementations');
assert.equal(await import('@daylight/platform/server/system/utils/file-io'), publicIO);
assert.equal(await import('./platform/server/system/utils/FileIO.mjs'), privateIO);
await assert.rejects(import('@daylight/platform/server/system/utils/FileIO.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });

const sample = path.join(process.env.PRE_RUN_ROOT, 'sample.yml');
assert.deepEqual(publicIO.loadYaml(sample), { origin: 'actual' });
const cacheDir = path.join(process.env.PRE_RUN_ROOT, 'directory');
const originalReaddir = fs.readdirSync;
let reads = 0;
fs.readdirSync = function (target, ...args) {
  if (target === cacheDir) reads++;
  return originalReaddir.call(this, target, ...args);
};
try {
  const expected = path.join(cacheDir, '0017-example.yml');
  assert.equal(publicIO.findFileByPrefix(cacheDir, 17, ['.yml', '.yaml']), expected);
  assert.equal(privateIO.findYamlByPrefix(cacheDir, '0017'), expected);
  assert.equal(reads, 1, 'FILEIO_CACHE_IDENTITY');
} finally {
  fs.readdirSync = originalReaddir;
}
process.stdout.write(JSON.stringify({ names: names.length, privateNames: Object.keys(privateIO).length, privateOnly: expected.privateOnly, bindingsIdentical: true, namespacesDistinct: true, dynamicIdentity: true, sharedDirectoryReads: reads, privatePathRejected: true }) + '\n');
