import {main60NodeSelected} from './main60-selected.mjs';
import {mainCurrentJestSelected} from './main-current-selected.mjs';
import {retainedVitest,retainedNode} from './retained-supplement-selected.mjs';
import {remainingNode,remainingJest} from './remaining-selected.mjs';
import {gamingNotationNode} from './gaming-notation-selected.mjs';
/** Four reviewed populations; runtime inputs select relocation, never arbitrary tests. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {botsDisplaysNode,botsDisplaysJest} from './bots-displays-selected.mjs';
import {mediaContentNode,mediaContentJest} from './media-content-selected.mjs';
const populations={'main60-node':main60NodeSelected,'main-current-jest':mainCurrentJestSelected,'retained-supplement-node':retainedNode,'piano-retained-node':['backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs','backend/src/3_applications/devices/services/PianoBridgeSupervisorService.test.mjs','backend/src/5_composition/modules/pianoBridgeSupervisor.test.mjs'],'remaining-node':remainingNode,'remaining-jest':remainingJest,'gaming-notation-node':gamingNotationNode,
  'bots-displays-node':botsDisplaysNode,'bots-displays-jest':botsDisplaysJest,
  'media-content-node':mediaContentNode,'media-content-jest':mediaContentJest,
};
export function fixedRunnerSelection(profile) {
  const selected=populations[profile];
  if(!selected)throw new Error('Unknown fixed runner profile');
  const root=fileURLToPath(new URL('../../../../',import.meta.url));
  const target=process.env.PRE_TARGET;
  if(!['baseline','candidate'].includes(target)||!process.env.PRE_RUN_ROOT||!process.env.PRE_TOOLCHAIN_ROOT)throw new Error('Explicit isolated runner inputs required');
  let moves={};
  if(target==='candidate'){
    if(!process.env.PRE_BASELINE_EVIDENCE||!fs.existsSync(process.env.PRE_BASELINE_EVIDENCE)||!process.env.PRE_SELECTED_MOVES)throw new Error('Candidate requires baseline evidence and reviewed selected move map');
    moves=JSON.parse(fs.readFileSync(process.env.PRE_SELECTED_MOVES,'utf8'));
    if(!moves||typeof moves!=='object'||Array.isArray(moves))throw new Error('Expected flat reviewed source-to-destination map');
  }
  const files=selected.map(source=>{
    const destination=Object.hasOwn(moves,source)?moves[source]:source;
    if(typeof destination!=='string'||path.isAbsolute(destination)||destination.split(/[\\/]/).includes('..'))throw new Error('Unsafe selected destination');
    const file=path.join(root,destination);
    if(!fs.statSync(file).isFile())throw new Error('Missing selected oracle: '+destination);
    return file;
  });
  if(new Set(files).size!==selected.length)throw new Error('Selected oracle collision');
  return {root,files,selected:[...selected],target,scratch:fs.realpathSync(process.env.PRE_RUN_ROOT),toolRoot:fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT)};
}
