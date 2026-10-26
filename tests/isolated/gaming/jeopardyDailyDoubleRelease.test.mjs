// @vitest-environment node
import fs from 'node:fs';
import YAML from 'yaml';
import {afterEach,it,expect} from 'vitest';
import {createDurableJeopardyFixture} from '../../_lib/createDurableJeopardyFixture.mjs';
import {commandContext} from '../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
const fixtures=[];afterEach(()=>{for(const f of fixtures.splice(0))f.dispose();});
it.each(['jeremiah-open-book.yml','isaiah-practice/content.yml'])('newly compiled %s loses a wrong DD wager exactly once across restart',async name=>{
 const definition=YAML.parse(fs.readFileSync(new URL('../../_fixtures/group-play/'+name,import.meta.url),'utf8'));definition.rounds=definition.rounds.map(r=>({...r,mode:'hosted'}));
 const f=await createDurableJeopardyFixture({definition});fixtures.push(f);const viewer={role:'host'};
 let session=await f.application.createSession({definitionId:'jeopardy:test',seats:[{id:'blue'},{id:'gold'}],viewer});
 const go=async command=>{const envelope={command_id:`cmd:${session.header.revision}`,actor_id:'host',expected_revision:session.header.revision,logical_time:Date.now(),command:{...command,expectedContext:commandContext(session.state)}};session=await f.application.dispatch(session.header.session_id,envelope,viewer);return envelope;};
 await go({type:'BUZZER_SETUP',epoch:'test'});
 for(const teamId of ['blue','gold'])for(const kind of ['assign','test'])await go({type:'BUZZER_REPORT',kind,epoch:'test',teamId,generation:session.state.buzzerSetup.teams[teamId].generation,slot:`gamepad:${teamId}:Pad`});
 expect(session.state.set.rounds.map(r=>r.daily_double_penalize_wrong)).toEqual([true,true]);
 await go({type:'START_ROUND'});const cat=definition.rounds[0].categories.findIndex(c=>c.clues.some(q=>q.daily_double));const row=definition.rounds[0].categories[cat].clues.findIndex(q=>q.daily_double);
 await go({type:'SELECT_AT',cat,row});expect(session.state.phase).toBe('wager');await go({type:'SET_WAGER',amount:300});await go({type:'REVEAL'});
 const judged=await go({type:'JUDGE',correct:false});expect(session.state.scores.blue).toBe(-300);expect(session.state.answerReview.scoreDelta).toBe(-300);
 const restarted=f.restart();const duplicate=await restarted.application.dispatch(session.header.session_id,judged,viewer);expect(duplicate.duplicate).toBe(true);expect(duplicate.state.scores.blue).toBe(-300);
 expect((await restarted.application.resumeSession(session.header.session_id,viewer)).state.answerReview.scoreDelta).toBe(-300);
});
