import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {validateRawFixtures} from './raw-utf8-fixture.mjs';
const runner=fs.readFileSync(new URL('./run-local-app.mjs',import.meta.url),'utf8');
const admission=runner.slice(runner.indexOf('assert.ok(prepared.fixtureFiles &&'),runner.indexOf('// Explicit runtime timezone'));
const validate=fixtureFiles=>vm.runInNewContext(admission,{assert,path,prepared:{fixtureFiles}});
const exact=['data/users/user_1/apps/health/meals.yml','data/household/automotive/synthetic-array-car/service.yml','data/household/automotive/synthetic-array-car/documents.yml'];
test('stored array admission permits only three exact reviewed destinations',()=>{
 for(const destination of exact)for(const records of [[],[{id:'synthetic-control'}]]){
  const fixture={[destination]:records},before=JSON.stringify(fixture);validate(fixture);assert.equal(JSON.stringify(fixture),before);
 }
});
test('stored array admission rejects neighboring roots and path aliases',()=>{
 const forbidden=['data/users/user_2/apps/health/meals.yml','data/users/user_1/apps/health/meals.yaml','data/users/user_1/apps/health/meal-templates.yml','data/users/user_1/apps/health/observations.yml','data/users/user_1/apps/health/subdir/meals.yml','data/household-other/automotive/synthetic-array-car/service.yml','data/household/automotive/other-car/service.yml','data/household/automotive/synthetic-array-car/service.yaml','data/household/automotive/synthetic-array-car/documents.yaml','data/household/automotive/synthetic-array-car/fuel.yml','data/household/automotive/synthetic-array-car/log.yml','data/household/automotive/synthetic-array-car/service.yml/extra','data/household/automotive/synthetic-array-car/documents.yml.bak','data/users/user_1/apps/health/../health/meals.yml','/data/users/user_1/apps/health/meals.yml','data\\users\\user_1\\apps\\health\\meals.yml','data/household/automotive//synthetic-array-car/service.yml','data/household/automotive/synthetic-array-car/./service.yml'];
 for(const destination of forbidden)assert.throws(()=>validate({[destination]:[]}),destination);
});
test('stored array admission rejects scalars and adds no raw grant or collision bypass',()=>{
 for(const destination of exact){
  for(const value of [null,'text',3,true])assert.throws(()=>validate({[destination]:value}));
  const bytes=Buffer.from('- id: synthetic-control\n');const raw={destination,encoding:'utf8',sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,base64:bytes.toString('base64')};
  assert.throws(()=>validateRawFixtures({fixtureFiles:{[destination]:[]},rawUTF8Files:[raw]}),/Unreviewed raw destination/);
 }
 const bytes=Buffer.from('synthetic-control');const destination='data/content/school/language/test.yml';
 assert.throws(()=>validateRawFixtures({fixtureFiles:{[destination]:{}},rawUTF8Files:[{destination,encoding:'utf8',sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,base64:bytes.toString('base64')}]}),/Raw duplicate or JSON collision/);
});
test('stored array admission preserves prior recipe and stored fixture behavior',()=>{
 // Exact prior admission loop, frozen before this three-path extension.
 const original=String.raw`assert.ok(prepared.fixtureFiles && typeof prepared.fixtureFiles === 'object');
for (const [relative, value] of Object.entries(prepared.fixtureFiles)) {
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..') && /^data\/.+\.ya?ml$/.test(relative), 'Unsafe fixture path');
  const reviewedArray = /^(?:(?:data\/household(?:-[a-zA-Z0-9_-]+)?\/(?:finance\/transaction\.pairs|gratitude\/(?:selections|discarded)\.gratitude|calendar\/calendar|apps\/calendar)|data\/users\/[a-zA-Z0-9_-]+\/lifelog\/nutrition\/(?:food_catalog|observations))\.ya?ml|data\/users\/[a-zA-Z0-9_-]+\/(?:lifeplan-metrics|ceremony-records)\.yml)$/.test(relative);
  // Exact metadata recipe source only; no dataset/raw path or resolution grant.
  const reviewedRecipeArray = relative === 'data/content/school/generated-banks/recipes.yml';
  assert.ok(value && typeof value === 'object' && (!Array.isArray(value) || reviewedArray || reviewedRecipeArray), 'Only reviewed stored-data or exact School recipes paths may have an array root');
}
`;
 const before=fixtureFiles=>vm.runInNewContext(original,{assert,path,prepared:{fixtureFiles}});
 const existing=['data/household/finance/transaction.pairs.yml','data/household-east/gratitude/selections.gratitude.yaml','data/household/gratitude/discarded.gratitude.yml','data/household/calendar/calendar.yml','data/household/apps/calendar.yaml','data/users/u/lifelog/nutrition/food_catalog.yml','data/users/u/lifelog/nutrition/observations.yaml','data/users/u/lifeplan-metrics.yml','data/users/u/ceremony-records.yml','data/content/school/generated-banks/recipes.yml','data/content/school/generated-banks/recipes.yaml','data/users/user_1/apps/health/meal-templates.yml','data/system/config/system.yml','data/content/school/generated-banks/entities.yml','data/../system/config/system.yml','data/system/config/system.txt'];
 const accepts=(fn,fixture)=>{try{fn(fixture);return true;}catch{return false;}};
 for(const destination of existing)for(const value of [{sample:true},[],[{sample:true}],null,'text',3]){const fixture={[destination]:value};assert.equal(accepts(validate,fixture),accepts(before,fixture),destination);}
});
