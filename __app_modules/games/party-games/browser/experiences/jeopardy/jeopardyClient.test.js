import { it, expect, vi, beforeEach } from 'vitest';
import { DaylightAPI } from '@/lib/api.mjs';
import { jeopardyRuleModule as rules } from '../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { sendJeopardyCommand } from './jeopardyClient.js';
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const definition = { rounds: [{ mode: 'hosted', categories: [{ clues: [{ value: 100, clue: 'Question', answer: 'Answer' }] }] }] };
const conflict = () => Object.assign(new Error('Revision conflict'), { status: 409, body: { error: 'revision_conflict' } });
function server(phase = 'board') {
  let state = rules.createInitialState(definition, { seats: [{ id: 'red' }] });
  state = { ...state, phase, active: phase === 'clue' ? { cat: 0, row: 0, clue: definition.rounds[0].categories[0].clues[0] } : null, buzzerSetup: { epoch: 'tv', seenAt: 1000, teams: { red: { slot: 'gamepad:0:Pad', generation: 0, connected: true, tested: true } } } };
  let revision = 0;
  return {
    snapshot: () => ({ header: { revision }, state }),
    phoneCommit() { revision++; },
    post(envelope) {
      if (envelope.expected_revision !== revision) throw conflict();
      const result = rules.handleCommand(state, envelope.command, definition, { actorId: 'host', logicalTime: 1000 });
      if (result.error) throw new Error(result.error.code);
      state = result.state; revision++; return this.snapshot();
    },
  };
}
it('retries a disconnect revision conflict caused by a phone command against fresh authority state', async () => {
  const authority = server(); let posts = 0;
  DaylightAPI.mockImplementation(async (_, envelope, method) => {
    if (method !== 'POST') return authority.snapshot();
    if (++posts === 1) authority.phoneCommit();
    return authority.post(envelope);
  });
  const result = await sendJeopardyCommand('race:disconnect', { type: 'BUZZER_REPORT', kind: 'disconnect', epoch: 'tv', teamId: 'red', generation: 0, slot: 'gamepad:0:Pad' });
  expect(result.state.buzzerSetup.teams.red).toMatchObject({ connected: false, tested: false, generation: 1 });
  expect(posts).toBe(2);
});
it('serializes heartbeat and winning BUZZ in one local session lane', async () => {
  const authority = server('clue'); let release;
  const pause = new Promise(resolve => { release = resolve; });
  const committed = [];
  DaylightAPI.mockImplementation(async (_, envelope, method) => {
    if (method !== 'POST') return authority.snapshot();
    if (envelope.command.type === 'jeopardy.buzzer.presence') await pause;
    const result = authority.post(envelope); committed.push(envelope.command.type); return result;
  });
  const heartbeat = sendJeopardyCommand('race:buzz', { type: 'BUZZER_PRESENCE', epoch: 'tv' });
  await Promise.resolve(); await Promise.resolve();
  const buzz = sendJeopardyCommand('race:buzz', { type: 'BUZZ', teamId: 'red' });
  await Promise.resolve(); await Promise.resolve();
  release();
  await Promise.all([heartbeat, buzz]);
  expect(authority.snapshot().state).toMatchObject({ phase: 'judging', answeringTeamId: 'red' });
  expect(committed).toEqual(['jeopardy.buzzer.presence', 'jeopardy.buzz']);
});

it('uses an accepted revision/context without a redundant GET',async()=>{
 const state=server('clue').snapshot().state;
 const {commandContext}=await import('../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/commandContext.mjs');
 DaylightAPI.mockResolvedValue({header:{revision:11},state});
 await sendJeopardyCommand('known:revision',{type:'BUZZ',teamId:'red'},{expectedRevision:10,expectedContext:commandContext(state),commandId:'known:one',logicalTime:123});
 expect(DaylightAPI).toHaveBeenCalledTimes(1);
 expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gaming/sessions/known:revision/commands',expect.objectContaining({command_id:'known:one',logical_time:123,expected_revision:10,command:expect.objectContaining({expectedContext:commandContext(state)})}),'POST');
});
it('probes a lost accepted response using the identical envelope and scores once',async()=>{
 const authority=server('clue');let committed,firstEnvelope,commits=0;
 DaylightAPI.mockImplementation(async(_,envelope,method)=>{
  if(method!=='POST')return authority.snapshot();
  if(!committed){commits++;firstEnvelope=structuredClone(envelope);committed=authority.post(envelope);throw Object.assign(new Error('lost accepted response'),{transient:true});}
  expect(envelope).toEqual(firstEnvelope);return{...committed,duplicate:true};
 });
 const result=await sendJeopardyCommand('lost:ack',{type:'BUZZ',teamId:'red'});
 expect(result.state.answeringTeamId).toBe('red');expect(commits).toBe(1);expect(result.duplicate).toBe(true);
});
it('retains identity and logical time across an explicit uncommitted conflict',async()=>{
 const authority=server('clue');const attempts=[];
 DaylightAPI.mockImplementation(async(_,envelope,method)=>{
  if(method!=='POST')return authority.snapshot();attempts.push(structuredClone(envelope));
  if(attempts.length===1)authority.phoneCommit();return authority.post(envelope);
 });
 await sendJeopardyCommand('identity:conflict',{type:'BUZZ',teamId:'red'});
 expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual({...attempts[0],expected_revision:1});
});
it('never retries an explicitly aborted request',async()=>{
 DaylightAPI.mockImplementation(async(_,body,method)=>{if(method!=='POST')return server('clue').snapshot();throw Object.assign(new Error('aborted'),{name:'AbortError',transient:true});});
 await expect(sendJeopardyCommand('abort:request',{type:'BUZZ',teamId:'red'})).rejects.toHaveProperty('name','AbortError');
 expect(DaylightAPI.mock.calls.filter(([, ,method])=>method==='POST')).toHaveLength(1);
});

it.each(['board','stale'])('does not rebase an uncommitted presence after %s invalidates readiness',async condition=>{
 const ready=server('round-intro').snapshot();let posts=0,fresh=true;
 DaylightAPI.mockImplementation(async(_,envelope,method)=>{
  if(method!=='POST')return{...ready,header:{revision:1},state:{...ready.state,phase:condition==='board'?'board':'round-intro'}};
  posts++;fresh=condition==='board';throw conflict();
 });
 await expect(sendJeopardyCommand('presence:'+condition,{type:'BUZZER_PRESENCE',epoch:'tv'},{expectedRevision:0,expectedContext:{phase:'round-intro'},canSend:state=>fresh&&(!state||state.phase==='round-intro')})).rejects.toHaveProperty('code','command_superseded');
 expect(posts).toBe(1);
});
it('reconciles lost presence ACK with the exact envelope even after hardware becomes stale',async()=>{
 const authority=server('round-intro');let committed,firstEnvelope,fresh=true,posts=0;
 DaylightAPI.mockImplementation(async(_,envelope,method)=>{
  if(method!=='POST')return authority.snapshot();posts++;
  if(!committed){firstEnvelope=structuredClone(envelope);committed=authority.post(envelope);fresh=false;throw Object.assign(new Error('lost ACK'),{transient:true});}
  expect(envelope).toEqual(firstEnvelope);return{...committed,duplicate:true};
 });
 const result=await sendJeopardyCommand('presence:lost',{type:'BUZZER_PRESENCE',epoch:'tv'},{canSend:()=>fresh});
 expect(result.duplicate).toBe(true);expect(posts).toBe(2);
});
