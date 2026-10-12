#!/usr/bin/env node
// Pure JSON projection; no application imports, Git changes or live requests.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function project(census) {
  assert.equal(census.schema,'daylight.current-http-source-census/v1');
  assert.equal(census.roles.length,2);
  assert.deepEqual(census.roles.map(r=>r.role),['reference','candidate']);
  const roles=census.roles.map(r=>{
    assert.equal(r.parseErrors.length,0,'Unresolved parse errors prevent complete syntax projection');
    assert.equal(new Set(r.sites.map(s=>s.declarationId)).size,r.sites.length,'Duplicate source identity');
    const files=new Map(r.files.filter(f=>f.status==='included').map(f=>[f.file,f]));
    for(const s of r.sites)assert.equal(s.sourceSha256,files.get(s.file)?.sha256,'Site/source mismatch');
    const row=s=>({declarationId:s.declarationId,file:s.file,sourceSha256:s.sourceSha256,owner:s.owner,symbol:s.symbol,
      line:s.line,method:s.method,localPathTemplates:s.literalPaths,pathExpression:s.pathExpression,
      receiver:s.receiver,handlers:s.handlers,predicates:s.guards,unresolved:s.unresolved,historicalLink:s.historicalLink});
    return {role:r.role,commit:r.commit,
      localRouteDeclarations:r.sites.filter(s=>s.classification==='route-declaration').map(row),
      mountAndMiddlewareEdges:r.sites.filter(s=>s.classification==='mount-or-middleware').map(row),
      unresolvedRegistrationCandidates:r.sites.filter(s=>!['route-declaration','mount-or-middleware'].includes(s.classification)).map(row),
      helperCalls:r.files.filter(f=>f.status==='included'&&f.helperCalls.length).map(f=>({file:f.file,sha256:f.sha256,imports:f.imports,calls:f.helperCalls})),
      historicalCases:r.sites.filter(s=>s.historicalLink?.cases.length).map(s=>({declarationId:s.declarationId,cases:s.historicalLink.cases,currentBehaviorCredit:false}))};
  });
  const candidateIds=new Set(census.roles[1].sites.map(s=>s.declarationId));
  const referenceIds=new Set(census.roles[0].sites.map(s=>s.declarationId));
  return {schema:'daylight.current-http-source-projection/v1',productionMethodTemplateDenominator:null,
    sourceIdentityPair:{sameIds:[...referenceIds].filter(x=>candidateIds.has(x)),referenceOnly:[...referenceIds].filter(x=>!candidateIds.has(x)),candidateOnly:[...candidateIds].filter(x=>!referenceIds.has(x))},roles,
    scope:'Local source method/path templates, construction predicates and symbolic mount/helper edges. Prefix composition, wrapped/external router reachability and configured activation remain unresolved; this is not an installed URL denominator.',
    boundaries:census.unresolvedBoundaries,nativeExecuted:false,currentBehaviorCredit:false};
}
if(process.argv.includes('--controls')){
  const site={declarationId:'a',classification:'route-declaration',sourceSha256:'h',file:'x',literalPaths:['/x']};
  const role=n=>({role:n,commit:n,parseErrors:[],sites:[site],files:[{status:'included',file:'x',sha256:'h',helperCalls:[]}]});
  const x={schema:'daylight.current-http-source-census/v1',roles:[role('reference'),role('candidate')],unresolvedBoundaries:[]};
  assert.equal(project(x).productionMethodTemplateDenominator,null);
  assert.deepEqual(project(x).sourceIdentityPair.sameIds,['a']);
  for(const mutate of [x=>x.roles[0].parseErrors.push('error'),x=>x.roles[0].sites.push(site),x=>x.roles[0].files[0].sha256='wrong']){
    const bad=structuredClone(x);mutate(bad);assert.throws(()=>project(bad));
  }
  console.log(JSON.stringify({controlsPassed:5,nativeExecuted:false}));
}else{
  const [input,output]=process.argv.slice(2);if(!output)throw Error('Usage: project-http-source-census.mjs census output');
  const bytes=fs.readFileSync(input),result=project(JSON.parse(bytes));
  result.census={path:input,sha256:sha(bytes)};result.projectorSha256=sha(fs.readFileSync(new URL(import.meta.url)));
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,sha256:sha(fs.readFileSync(output)),sourceIdentityPair:{same:result.sourceIdentityPair.sameIds.length,referenceOnly:result.sourceIdentityPair.referenceOnly.length,candidateOnly:result.sourceIdentityPair.candidateOnly.length},productionMethodTemplateDenominator:null}));
}
