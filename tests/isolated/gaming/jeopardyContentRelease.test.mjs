// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,it,expect} from 'vitest';
import YAML from 'yaml';
import {createDurableJeopardyFixture} from '../../_lib/createDurableJeopardyFixture.mjs';
import {auditJeopardyContent} from '../../../scripts/audit-jeopardy-content.mjs';
const read=name=>YAML.parse(fs.readFileSync(new URL('../../_fixtures/group-play/'+name,import.meta.url),'utf8'));
const fixtures=[];afterEach(()=>{for(const f of fixtures.splice(0))f.dispose();});
const release=raw=>({...raw,rounds:raw.rounds.map(round=>({...round,mode:'hosted'}))});
const questions=set=>[...set.rounds.flatMap(r=>r.categories.flatMap(c=>c.clues)),set.final];
it('catches the missing installed hints even while the reviewed fixture passes',async()=>{
 const expected=release(read('jeremiah-open-book.yml'));
 // Independent old authored volume: 31 questions, a timer, no reference metadata.
 // Its persisted shape mirrors the captured mounted preimage; private prompts
 // and the complete semantic diff remain in the operations release packet.
 const old={id:'fhe-jeremiah',title:'Jeremiah Jeopardy',rounds:Array.from({length:2},(_,r)=>({name:`Round ${r+1}`,mode:'hosted',multiplier:r+1,timer_seconds:25,penalize_wrong:false,categories:Array.from({length:5},(_,c)=>({name:`Category ${c+1}`,clues:Array.from({length:3},(_,q)=>({value:(q+1)*100,clue:`Old question ${r}-${c}-${q}`,answer:`Old answer ${r}-${c}-${q}`}))}))})),final:{category:'Final',clue:'Old final question',answer:'Old final answer'}};
 const fixture=await createDurableJeopardyFixture({definition:old});fixtures.push(fixture);
 const loaded=await fixture.application.getDefinition('jeopardy:test');
 const audit=auditJeopardyContent({expected,actual:loaded.definition});
 expect(audit.matches).toBe(false);expect(audit.differences.some(d=>d.path==='open_book')).toBe(true);
 expect(audit.differences.filter(d=>d.path.endsWith('.scripture_reference'))).toHaveLength(31);
 const expectedFile=path.join(fixture.root,'expected.yml'),actualFile=path.join(fixture.root,'definitions','jeopardy:test','content.yml');fs.writeFileSync(expectedFile,YAML.stringify(expected));
 const before=fs.readFileSync(actualFile,'utf8');
 const cli=spawnSync(process.execPath,['scripts/audit-jeopardy-content.mjs',expectedFile,actualFile],{encoding:'utf8'});
 expect(cli.status).toBe(1);expect(JSON.parse(cli.stdout).matches).toBe(false);
 expect(cli.stdout).not.toContain(old.final.answer);expect(cli.stdout).not.toContain(expected.final.answer);
 expect(fs.readFileSync(actualFile,'utf8')).toBe(before);
});
it.each(['jeremiah-open-book.yml','isaiah-practice/content.yml'])('real loading and new durable sessions preserve all 31 hints: %s',async name=>{
 const expected=release(read(name)),fixture=await createDurableJeopardyFixture({definition:expected});fixtures.push(fixture);
 const loaded=await fixture.application.getDefinition('jeopardy:test');expect(auditJeopardyContent({expected,actual:loaded.definition})).toMatchObject({matches:true,differences:[]});
 const session=await fixture.application.createSession({definitionId:'jeopardy:test',seats:[{id:'blue'},{id:'gold'}],viewer:{role:'host'}});
 expect(session.state.set.open_book).toBe(true);expect(questions(session.state.set)).toHaveLength(31);
 expect(questions(session.state.set).every(q=>Boolean(q.scripture_reference?.trim()))).toBe(true);
 expect(session.state.set.rounds.map(r=>r.mode)).toEqual(['hosted','hosted']);
 expect(fs.readdirSync(path.join(fixture.root,'snapshots'))).toEqual([session.header.session_id+'.json']);
 const participant=await fixture.application.resumeSession(session.header.session_id,{role:'participant',participant_id:'gold'});
 expect(JSON.stringify(participant)).not.toContain(questions(expected)[1].answer);
});
it('rejects a deliberately missing or blank hint rather than normalizing it into a match',()=>{
 const expected=release(read('jeremiah-open-book.yml'));
 for(const value of [undefined,'   ']){const actual=structuredClone(expected);actual.rounds[0].categories[0].clues[0].scripture_reference=value;expect(()=>auditJeopardyContent({expected,actual})).toThrow(/scripture_reference/);}
});
it('preserves the selected reference in public projections while unopened prompts and answers remain hidden',async()=>{
 const expected=release(read('jeremiah-open-book.yml')),fixture=await createDurableJeopardyFixture({definition:expected});fixtures.push(fixture);
 let session=await fixture.application.createSession({definitionId:'jeopardy:test',seats:[{id:'blue'},{id:'gold'}],viewer:{role:'host'}});
 const {commandContext}=await import('../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs');
 const go=async command=>{session=await fixture.application.dispatch(session.header.session_id,{command_id:`cmd:${session.header.revision}`,actor_id:'host',expected_revision:session.header.revision,logical_time:Date.now(),command:{...command,expectedContext:commandContext(session.state)}},{role:'host'});};
 await go({type:'BUZZER_SETUP',epoch:'test'});
 for(const teamId of ['blue','gold'])for(const kind of ['assign','test'])await go({type:'BUZZER_REPORT',kind,epoch:'test',teamId,generation:session.state.buzzerSetup.teams[teamId].generation,slot:`gamepad:${teamId}:Pad`});
 await go({type:'START_ROUND'});await go({type:'SELECT_AT',cat:0,row:1});
 const selected=await fixture.application.resumeSession(session.header.session_id,{role:'participant',participant_id:'gold'});
 expect(selected.state.active.clue.scripture_reference).toBe('Jeremiah 1:6');expect(selected.state.active.clue.clue).toBe(expected.rounds[0].categories[0].clues[1].clue);
 expect(selected.state.active.clue.answer).toBeUndefined();expect(JSON.stringify(selected)).not.toContain(expected.rounds[0].categories[0].clues[2].clue);
});
