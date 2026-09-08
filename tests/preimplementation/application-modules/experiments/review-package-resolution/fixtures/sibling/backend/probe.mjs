import assert from 'node:assert/strict';
const facets = process.argv[2] === 'reverse' ? ['cli','web','server'] : ['server','web','cli'];
const loaded = {};
for (const facet of facets) loaded[facet] = await import('@proof/fitness/' + facet + '/value');
const versions = Object.fromEntries(Object.entries(loaded).map(([key, val]) => [key,val.moment.timezoneVersion]));
assert.deepEqual(versions, {server:'0.6.0',web:'0.5.47',cli:'0.5.46'});
assert.notEqual(loaded.server.moment,loaded.cli.moment);
assert.notEqual(loaded.web.moment,loaded.cli.moment);
assert.notEqual(loaded.web.moment,loaded.server.moment);
for (const facet of facets) {
  const direct = await import('../modules/fitness/' + facet + '/value.mjs');
  assert.equal(loaded[facet].moment, direct.moment);
  assert.equal(loaded[facet].version, direct.version);
}
await assert.rejects(import('@proof/fitness/server/value.mjs'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
console.log(JSON.stringify({facets,versions,separateInstances:true,sameFacetIdentity:true,privateImportRejected:true}));
