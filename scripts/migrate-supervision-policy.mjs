import {readTextFromPathAsync,writeFileExclusive} from '../__backend/src/0_system/utils/FileIO.mjs';
import {pathToFileURL} from 'node:url';
import yaml from 'js-yaml';
import {INSTALLED_STATE_GATES_POLICY} from '../__backend/src/5_composition/modules/installedStateGatesPolicy.mjs';
import {YamlStateGatesPolicySource} from '../__capabilities/state-gates/server/adapters/config/YamlStateGatesPolicySource.mjs';
import {PolicyGraph} from '../__capabilities/state-gates/server/domain/aggregates/PolicyGraph.mjs';
/** Pure additive migration; CLI writes only a new output file and never replaces the live policy. */
export async function migrateSupervisionPolicy(raw){
 const next=structuredClone(raw);
 if(next.schema!=='daylight.state-gates-policy/v1')throw new Error('Unsupported State Gates policy');
 for(const section of ['publishers','claim_types','gates','entitlements']){
  next[section]??={};
  for(const [key,value] of Object.entries(INSTALLED_STATE_GATES_POLICY[section]).filter(([key])=>key.startsWith('supervision') || (section==='publishers' && key==='household-presence'))){
   if(next[section][key] && JSON.stringify(next[section][key])!==JSON.stringify(value))throw Object.assign(new Error(`Conflicting definition: ${section}.${key}`),{code:'SUPERVISION_POLICY_CONFLICT'});
   next[section][key]=structuredClone(value);
  }
 }
 next.policy_revision=Math.max(raw.policy_revision+1,INSTALLED_STATE_GATES_POLICY.policy_revision);
 const candidate=await new YamlStateGatesPolicySource({load:async()=>next}).loadCandidate('migration');new PolicyGraph(candidate);
 return next;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);if(!input || !output)throw new Error('Usage: node scripts/migrate-supervision-policy.mjs INPUT.yml NEW_OUTPUT.yml');
 const result=await migrateSupervisionPolicy(yaml.load(await readTextFromPathAsync(input)));writeFileExclusive(output,yaml.dump(result),{mode:0o600});
}
