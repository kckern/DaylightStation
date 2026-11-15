#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import yaml from 'js-yaml';
import {loadYaml,readFile,writeFileExclusive} from '../__backend/src/0_system/utils/FileIO.mjs';
import {INSTALLED_STATE_GATES_POLICY} from '../__backend/src/5_composition/modules/installedStateGatesPolicy.mjs';
import {YamlStateGatesPolicySource} from '../__capabilities/state-gates/server/adapters/config/YamlStateGatesPolicySource.mjs';
import {PolicyGraph} from '../__capabilities/state-gates/server/domain/aggregates/PolicyGraph.mjs';
/** Add only the Sunday definitions. Authored policy remains the household's authority. */
export function addSundayFitnessPolicy(input){
  if(input?.schema!=='daylight.state-gates-policy/v1' || !Number.isSafeInteger(input.policy_revision) || input.policy_revision<1)throw new TypeError('Valid State Gates policy required');
  const output=structuredClone(input);let changed=false;
  for(const [section,id] of [['gates','fitness.games-outside-sunday'],['entitlements','fitness.games-unsupervised']]){
    const wanted=INSTALLED_STATE_GATES_POLICY[section][id];output[section]??={};
    if(output[section][id]!==undefined){if(!isDeepStrictEqual(output[section][id],wanted))throw new Error(`Sunday policy conflict: ${section}.${id}`);}
    else{output[section][id]=structuredClone(wanted);changed=true;}
  }
  if(changed)output.policy_revision=Math.max(input.policy_revision+1,INSTALLED_STATE_GATES_POLICY.policy_revision);
  return output;
}
export async function prepareSundayPolicy({inputPath,outputPath,validationContext}){
  const output=addSundayFitnessPolicy(loadYaml(inputPath));
  const candidate=await new YamlStateGatesPolicySource({load:async()=>output}).loadCandidate('migration');
  PolicyGraph.create(candidate,validationContext);
  writeFileExclusive(outputPath,yaml.dump(output,{noRefs:true,lineWidth:120}));return output;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [inputPath,outputPath,statePath]=process.argv.slice(2);
  if(!inputPath || !outputPath || !statePath)throw new Error('Usage: migrate-fitness-sunday-policy.mjs INPUT.yml NEW_OUTPUT.yml CURRENT_STATE.json');
  const state=JSON.parse(readFile(statePath)),validationContext=(state.projection??state).activeValidationContext;
  if(!validationContext)throw new Error('Active household validation context required');
  const output=await prepareSundayPolicy({inputPath,outputPath,validationContext});process.stdout.write(`Prepared policy revision ${output.policy_revision}; source unchanged; activation required.\n`);
}
