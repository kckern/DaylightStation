import {beforeEach, expect, it, vi} from 'vitest';
import {DaylightAPI} from '@/lib/api.mjs';
import {sendJeopardyCommand} from '../../../../../__app_modules/games/party-games/browser/experiences/jeopardy/jeopardyClient.js';
import {jeopardyRuleModule as rules} from '../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
vi.mock('@/lib/api.mjs',()=>({DaylightAPI:vi.fn()}));
beforeEach(()=>DaylightAPI.mockReset());
const pack={open_book:true,rounds:[{name:'Round',mode:'hosted',categories:[{name:'C',clues:[{value:200,clue:'First',answer:'A'},{value:300,clue:'Second',answer:'B'}]}]}]};
function fixture(changeClue){
 let state={...rules.createInitialState(pack,{seats:[{id:'blue'},{id:'gold'}],setup:{jeopardy_flow_version:2}}),phase:'board'};
 state=rules.handleCommand(state,{type:'jeopardy.select.at',cat:0,row:0},pack,{actorId:'host',revision:9}).state;
 let revision=10,posts=0;const targets=[];
 DaylightAPI.mockImplementation(async(_url,body,method)=>{
  if(method==='POST'){
   posts++;
   if(posts===1){
    revision=14;
    if(changeClue)state={...state,phase:'clue',active:{cat:0,row:1,clue:pack.rounds[0].categories[0].clues[1]},used:{'0:0:0':true},answeringTeamId:null};
    throw Object.assign(new Error('revision changed'),{status:409,code:'revision_conflict'});
   }
   targets.push(state.active.row);
   const result=rules.handleCommand(state,body.command,pack,{actorId:'host',revision});
   if(result.error)throw Object.assign(new Error(result.error.message),{code:result.error.code});
   state=result.state;revision++;
  }
  return{header:{revision},state:structuredClone(state)};
 });
 return{current:()=>state,targets};
}
it('control: a heartbeat revision conflict still permits the original clue buzz',async()=>{
 const h=fixture(false);
 await sendJeopardyCommand('diagnostic-retry-same',{type:'BUZZ',teamId:'blue'});
 expect(h.current().active.row).toBe(0);expect(h.current().answeringTeamId).toBe('blue');
});
it('a buzz pressed for the first clue cannot be retargeted to the next clue during retry',async()=>{
 const h=fixture(true);
 await sendJeopardyCommand('diagnostic-retry-next',{type:'BUZZ',teamId:'blue'}).catch(()=>{});
 expect(h.targets).not.toContain(1);
 expect(h.current().answeringTeamId).toBeNull();
});
