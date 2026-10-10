import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {validateRawFixtures} from './raw-utf8-fixture.mjs';
const runner=fs.readFileSync(new URL('./run-local-app.mjs',import.meta.url),'utf8');
const admission=runner.slice(runner.indexOf('assert.ok(prepared.fixtureFiles &&'),runner.indexOf('// Explicit runtime timezone'));
const validateJSONFixtures=fixture=>vm.runInNewContext(admission,{assert,path,prepared:fixture});
const recipePath='data/content/school/generated-banks/recipes.yml';
const recipes=[{bankId:'synthetic/geography/capitals',entities:'synthetic-countries',collections:['geography'],available:true}];
test('JSON fixture admission permits only the exact reviewed recipe array destination',()=>{
 const fixture={fixtureFiles:{[recipePath]:recipes}};const before=JSON.stringify(fixture);
 validateJSONFixtures(fixture);assert.equal(JSON.stringify(fixture),before);
 for(const destination of ['data/content/school/generated-banks/recipes.yaml','data/content/school/generated-banks/entities.yml','data/content/school/generated-banks/other-recipes.yml','data/content/school/generated-banks/recipes.yml/extra','data/content/school/../school/generated-banks/recipes.yml','/data/content/school/generated-banks/recipes.yml','data\\content\\school\\generated-banks\\recipes.yml'])assert.throws(()=>validateJSONFixtures({fixtureFiles:{[destination]:recipes}}),destination);
});
test('recipe array admission adds no raw grant and preserves raw/JSON collision rejection',()=>{
 const bytes=Buffer.from('- bankId: synthetic/geography/capitals\n');
 const raw=destination=>({destination,encoding:'utf8',sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,base64:bytes.toString('base64')});
 assert.throws(()=>validateRawFixtures({fixtureFiles:{[recipePath]:recipes},rawUTF8Files:[raw(recipePath)]}),/Unreviewed raw destination/);
 const allowed='data/content/school/language/test.yml';
 assert.throws(()=>validateRawFixtures({fixtureFiles:{[allowed]:{}},rawUTF8Files:[raw(allowed)]}),/Raw duplicate or JSON collision/);
});
test('JSON admission preserves original allowed and rejected fixture behavior',()=>{
 // Actual pre-change loop frozen verbatim from the admission that rejected this
 // recipe, executed without an application/listener or test copy of its regex.
 const original=String.raw`assert.ok(prepared.fixtureFiles && typeof prepared.fixtureFiles === 'object');
for (const [relative, value] of Object.entries(prepared.fixtureFiles)) {
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..') && /^data\/.+\.ya?ml$/.test(relative), 'Unsafe fixture path');
  const reviewedArray = /^(?:(?:data\/household(?:-[a-zA-Z0-9_-]+)?\/(?:finance\/transaction\.pairs|gratitude\/(?:selections|discarded)\.gratitude|calendar\/calendar|apps\/calendar)|data\/users\/[a-zA-Z0-9_-]+\/lifelog\/nutrition\/(?:food_catalog|observations))\.ya?ml|data\/users\/[a-zA-Z0-9_-]+\/(?:lifeplan-metrics|ceremony-records)\.yml)$/.test(relative);
  assert.ok(value && typeof value === 'object' && (!Array.isArray(value) || reviewedArray), 'Only reviewed Finance, Gratitude, Calendar, Health, or Life stored-data paths may have an array root');
}
`;
 const old=fixture=>vm.runInNewContext(original,{assert,path,prepared:fixture});
 const existing=['data/household/finance/transaction.pairs.yml','data/household-west/calendar/calendar.yml','data/household/apps/calendar.yml','data/users/u/lifelog/nutrition/observations.yaml','data/users/u/lifeplan-metrics.yml','data/users/u/ceremony-records.yml','data/content/music/scales/modes.yml','data/system/config/system.yml','data/content/school/generated-banks/dataset.yml','data/../system/config/system.yml','/data/users/u/profile.yml','data/users/u/profile.txt'];
 for(const destination of existing)for(const value of [{sample:true},[],null,'text',3]) {
  const fixture={fixtureFiles:{[destination]:value}};const accepts=fn=>{try{fn(fixture);return true;}catch{return false;}};
  assert.equal(accepts(validateJSONFixtures),accepts(old),destination+':'+JSON.stringify(value));
 }
});
test('Automotive stored history arrays require exactly the three reviewed synthetic destinations',()=>{
 const exact=['data/household/automotive/log/synthetic-array-car/2026-10-01.yml','data/household/automotive/log/synthetic-array-car/2026-10-02.yml','data/household/automotive/synthetic-array-car/fuel.yml'];
 for(const destination of exact){const fixture={fixtureFiles:{[destination]:[{fixture:true}]}};const before=JSON.stringify(fixture);validateJSONFixtures(fixture);assert.equal(JSON.stringify(fixture),before);for(const value of [null,0,'scalar'])assert.throws(()=>validateJSONFixtures({fixtureFiles:{[destination]:value}}));}
 for(const destination of ['data/household/automotive/log/synthetic-array-car/2026-10-03.yml','data/household/automotive/log/other-car/2026-10-01.yml','data/household/automotive/log/synthetic-array-car/2026-10-01.yaml','data/household/automotive/other-car/fuel.yml','data/household/automotive/synthetic-array-car/fuel.yaml','data/household/automotive/synthetic-array-car/fuel-extra.yml','data/household/automotive/log/synthetic-array-car/trips/2026-10/trip-one.yml','data/household/automotive/log/synthetic-array-car/../2026-10-01.yml'])assert.throws(()=>validateJSONFixtures({fixtureFiles:{[destination]:[]}}),destination);
 for(const destination of exact){const bytes=Buffer.from('- fixture: true\n');assert.throws(()=>validateRawFixtures({fixtureFiles:{},rawUTF8Files:[{destination,encoding:'utf8',sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,base64:bytes.toString('base64')}]}),/Unreviewed raw destination/);}
});
