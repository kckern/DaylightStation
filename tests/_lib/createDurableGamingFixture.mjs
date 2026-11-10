// Shared disposable fixture for production persistence and application authority.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {createGamingSessionRuntime} from '../../__capabilities/gaming/server/composition/session-runtime.mjs';
import {YamlGamingDefinitionStore} from '../../__app_modules/games/party-games/server/adapters/persistence/YamlGamingDefinitionStore.mjs';
import {GamingApplication} from '../../__app_modules/games/party-games/server/application/runtime/GamingApplication.mjs';

export async function createDurableGamingFixture({definition,definitionId,rulesets,manifest,clock={now:()=>new Date()}}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gaming-authority-')),directory=path.join(root,'definitions',definitionId);fs.mkdirSync(directory,{recursive:true});
 const {rule_module,experience,artifact:_artifact,...content}=definition;
 fs.writeFileSync(path.join(directory,'rules.yml'),YAML.stringify({artifact:{kind:'gaming-rules',version:1,id:definitionId},rule_module,experience}));
 fs.writeFileSync(path.join(directory,'content.yml'),YAML.stringify({artifact:{kind:'gaming-content',version:1,id:definitionId},...content}));
 const restart=()=>{
  const definitions=new YamlGamingDefinitionStore({definitionsDir:path.join(root,'definitions'),archiveDir:path.join(root,'archive')});
  const authority=createGamingSessionRuntime({definitions,snapshotsDir:path.join(root,'snapshots'),journalsDir:path.join(root,'journals'),rulesets,clock,createIds:()=>({session:()=>`game:${crypto.randomUUID()}`,command:()=>`cmd:${crypto.randomUUID()}`,seed:()=>7})});
  const application=new GamingApplication({coordinator:authority.coordinator,definitions,manifestStore:{get:(id,version)=>id===manifest.id&&version===manifest.version?manifest:null,list:()=>[manifest]}});
  return{...authority,application,definitions};
 };
 return{...restart(),root,restart,dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
