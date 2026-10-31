import { describe, it, expect } from 'vitest';
import { initJeopardy, jeopardyReducer, scoreDelta, boardDone } from "../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/stateMachine.mjs";

const TEAM_IDS = ['team_1', 'team_2'];

function makeSet({ mode = 'hosted', withFinal = true, penalize = true } = {}) {
  return {
    id: 's', title: 'S', description: '',
    rounds: [{
      name: 'R1', mode, multiplier: 1, timer_seconds: null, penalize_wrong: penalize,
      categories: [
        { name: 'CatA', clues: [
          { value: 100, clue: 'a1', answer: 'A1', media: null, daily_double: false },
          { value: 200, clue: 'a2', answer: 'A2', media: null, daily_double: true },
        ] },
        { name: 'CatB', clues: [
          { value: 100, clue: 'b1', answer: 'B1', media: null, daily_double: false },
        ] },
      ],
    }],
    final: withFinal ? { category: 'Fin', clue: 'f', answer: 'F', media: null } : null,
  };
}

function toBoard(set = makeSet()) {
  let s = initJeopardy(set, TEAM_IDS);
  expect(s.phase).toBe('round-intro');
  s = jeopardyReducer(s, { type: 'START_ROUND' });
  expect(s.phase).toBe('board');
  return s;
}

describe('jeopardyReducer — hosted mode', () => {
  it('select → buzz → correct: scores, marks used, winner picks next', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' }); // cursor at 0,0
    expect(s.phase).toBe('clue');
    expect(s.active.clue.clue).toBe('a1');
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    expect(s.phase).toBe('judging');
    expect(scoreDelta(s, true)).toEqual({ teamId: 'team_2', delta: 100 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
    expect(s.used['0:0:0']).toBe(true);
    expect(s.turnTeamId).toBe('team_2');
  });

  it('wrong answer re-opens the clue for remaining teams; all-wrong reveals', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' });
    expect(scoreDelta(s, false)).toEqual({ teamId: 'team_1', delta: -100 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.phase).toBe('clue');
    expect(s.attempted).toEqual(['team_1']);
    expect(s.answeringTeamId).toBe(null);
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' }); // repeat buzz ignored
    expect(s.phase).toBe('clue');
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.revealed).toBe(true); // everyone missed → answer shows
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s.phase).toBe('board');
    expect(s.used['0:0:0']).toBe(true);
  });

  it('no penalty when penalize_wrong is false', () => {
    let s = toBoard(makeSet({ penalize: false }));
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' });
    expect(scoreDelta(s, false)).toEqual({ teamId: 'team_1', delta: 0 });
  });

  it('timeout reveals; return marks used', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'TIMEOUT' });
    expect(s.revealed).toBe(true);
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s.used['0:0:0']).toBe(true);
  });
});

describe('daily double', () => {
  it('selecting a daily-double goes to wager; delta uses the wager', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'MOVE_CURSOR', dir: 'down' }); // row 1 (a2, DD)
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    expect(s.phase).toBe('wager');
    expect(s.isDailyDouble).toBe(true);
    expect(s.answeringTeamId).toBe('team_1'); // turn team answers a DD
    s = jeopardyReducer(s, { type: 'SET_WAGER', amount: 500 });
    expect(s.phase).toBe('clue');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(scoreDelta(s, true)).toEqual({ teamId: 'team_1', delta: 500 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.phase).toBe('board'); // DD: only one team answers, straight back
    expect(s.used['0:0:1']).toBe(true);
  });
});

describe('turns mode', () => {
  it('active team answers, rotation advances after every clue', () => {
    let s = toBoard(makeSet({ mode: 'turns' }));
    expect(s.turnTeamId).toBe('team_1');
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    expect(s.answeringTeamId).toBe('team_1');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
    expect(s.turnTeamId).toBe('team_2'); // rotated regardless of outcome
  });
});

describe('self mode', () => {
  it('buzz → auto-reveal → single judge', () => {
    let s = toBoard(makeSet({ mode: 'self' }));
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    expect(s.phase).toBe('judging');
    expect(s.revealed).toBe(true); // self mode reveals on buzz
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
  });
});

describe('round + final progression', () => {
  function clearBoard(s) {
    // exhaust all three clues via timeout
    const picks = [['SELECT_TILE'], ['MOVE_CURSOR', 'down'], ['SELECT_TILE'], ['MOVE_CURSOR', 'right'], ['SELECT_TILE']];
    for (const [type, dir] of picks) {
      s = jeopardyReducer(s, { type, dir });
      if (s.phase === 'wager') s = jeopardyReducer(s, { type: 'SET_WAGER', amount: 5 });
      if (s.phase === 'clue') {
        s = jeopardyReducer(s, { type: 'TIMEOUT' });
        s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
      }
    }
    return s;
  }

  it('clearing the last round moves to final; wagers → clue → judging → done', () => {
    let s = clearBoard(toBoard());
    expect(boardDone(s)).toBe(true);
    expect(s.phase).toBe('final-category');
    s = jeopardyReducer(s, { type: 'START_ROUND' }); // advance from final category card
    expect(s.phase).toBe('final-wager');
    s = jeopardyReducer(s, { type: 'SET_FINAL_WAGER', teamId: 'team_1', amount: 100 });
    expect(s.phase).toBe('final-wager'); // still waiting on team_2
    s = jeopardyReducer(s, { type: 'SET_FINAL_WAGER', teamId: 'team_2', amount: 200 });
    expect(s.phase).toBe('final-clue');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(s.phase).toBe('final-judging');
    s = jeopardyReducer(s, { type: 'JUDGE_FINAL', teamId: 'team_1', correct: true });
    expect(s.phase).toBe('final-judging');
    s = jeopardyReducer(s, { type: 'JUDGE_FINAL', teamId: 'team_2', correct: false });
    expect(s.phase).toBe('done');
    expect(s.finalWagers).toEqual({ team_1: 100, team_2: 200 });
  });

  it('a set with no final goes straight to done', () => {
    const s = clearBoard(toBoard(makeSet({ withFinal: false })));
    expect(s.phase).toBe('done');
  });

  it('SELECT_AT jumps to a specific tile and opens it (phone tile picker)', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_AT', cat: 1, row: 0 }); // CatB $100
    expect(s.phase).toBe('clue');
    expect(s.active.clue.clue).toBe('b1');
    // out-of-range / used tiles are ignored
    let s2 = toBoard();
    expect(jeopardyReducer(s2, { type: 'SELECT_AT', cat: 5, row: 5 })).toBe(s2);
  });

});

it('lets the host reveal a hidden answer after a hosted buzz',()=>{
 let s=toBoard(); s=jeopardyReducer(s,{type:'SELECT_TILE'}); s=jeopardyReducer(s,{type:'BUZZ',teamId:'team_1'});
 s=jeopardyReducer(s,{type:'REVEAL'}); expect(s.phase).toBe('judging'); expect(s.revealed).toBe(true);
});

it.each(['correct','wrong','timeout'])('rotates three anonymous teams after %s',outcome=>{
 let s=jeopardyReducer(initJeopardy(makeSet({mode:'turns'}),['blue','gold','green']),{type:'START_ROUND'});
 for(const [index,pick] of [{cat:0,row:0},{cat:0,row:1},{cat:1,row:0}].entries()) {
  expect(s.turnTeamId).toBe(['blue','gold','green'][index]);
  s=jeopardyReducer(s,{type:'SELECT_AT',...pick});
  if(s.phase==='wager')s=jeopardyReducer(s,{type:'SET_WAGER',amount:100});
  if(outcome==='timeout') { s=jeopardyReducer(s,{type:'TIMEOUT'}); s=jeopardyReducer(s,{type:'RETURN_TO_BOARD'}); }
  else {s=jeopardyReducer(s,{type:'REVEAL'});expect(scoreDelta(s,outcome==='correct').teamId).toBe(['blue','gold','green'][index]);s=jeopardyReducer(s,{type:'JUDGE',correct:outcome==='correct'});}
 }
 expect(s.turnTeamId).toBe('blue'); expect(s.phase).toBe('final-category');
});

it('advances the cursor to an unused question after closing a clue',()=>{
 let s=toBoard(makeSet({mode:'turns'}));s=jeopardyReducer(s,{type:'SELECT_TILE'});
 s=jeopardyReducer(s,{type:'TIMEOUT'});s=jeopardyReducer(s,{type:'RETURN_TO_BOARD'});
 expect(s.cursor).toEqual({cat:1,row:0});
 s=jeopardyReducer(s,{type:'SELECT_TILE'});expect(s.active.clue.clue).toBe('b1');
});
it('selects a playable question when resuming a legacy cursor on a used tile',()=>{
 const s={...toBoard(),used:{'0:0:0':true}};
 const next=jeopardyReducer(s,{type:'SELECT_TILE'});expect(next.phase).toBe('clue');expect(next.active.clue.clue).toBe('b1');
});
it('skips used and missing cells without trapping the cursor on sparse boards',()=>{
 let s={...toBoard(),cursor:{cat:1,row:0},used:{'0:0:0':true}};
 s=jeopardyReducer(s,{type:'MOVE_CURSOR',dir:'left'});expect(s.cursor).toEqual({cat:0,row:1});
 s=jeopardyReducer(s,{type:'MOVE_CURSOR',dir:'right'});expect(s.cursor).toEqual({cat:1,row:0});
});

it('can reach every remaining question on every nonempty 3-by-3 board',()=>{
 const set={id:'sparse',title:'Sparse',rounds:[{name:'Round',mode:'turns',categories:Array.from({length:3},(_,cat)=>({name:`C${cat}`,clues:Array.from({length:3},()=>({value:100,clue:'Question',answer:'Answer'}))}))}]};
 const cells=Array.from({length:9},(_,index)=>({cat:index%3,row:Math.floor(index/3)}));
 for(let mask=1;mask<512;mask++){
  const remaining=cells.filter((_,index)=>mask&(1<<index));
  const used=Object.fromEntries(cells.filter((_,index)=>!(mask&(1<<index))).map(c=>[`0:${c.cat}:${c.row}`,true]));
  const state={...initJeopardy(set,TEAM_IDS),phase:'board',used,cursor:remaining[0]};
  const seen=new Set(),queue=[remaining[0]];
  while(queue.length){
   const cell=queue.shift(),key=`${cell.cat}:${cell.row}`;if(seen.has(key))continue;seen.add(key);
   for(const dir of ['left','right','up','down']){
    const next=jeopardyReducer({...state,cursor:cell},{type:'MOVE_CURSOR',dir});
    if(!seen.has(`${next.cursor.cat}:${next.cursor.row}`))queue.push(next.cursor);
   }
  }
  expect([...seen].sort(),`remaining board mask ${mask}`).toEqual(remaining.map(c=>`${c.cat}:${c.row}`).sort());
 }
});

describe('learn notes', () => {
  const LEARN = { ref: 'Jer 1:5', text: 'Before I formed you…' };
  function learnSet() {
    const set = makeSet();
    set.rounds[0].categories[0].clues[0].learn = LEARN;
    set.final.learn = LEARN;
    return set;
  }
  const v2Board = () => {
    let s = initJeopardy(learnSet(), TEAM_IDS);
    s = jeopardyReducer(s, { type: 'ENABLE_EXPERIENCE_V2' });
    expect(s.jeopardyFlowVersion).toBe(2);
    return jeopardyReducer(s, { type: 'START_ROUND' });
  };

  it('v2: opens in answer review once judged, never while a judgment is owed', () => {
    let s = jeopardyReducer(v2Board(), { type: 'SELECT_TILE' });
    expect(jeopardyReducer(s, { type: 'SHOW_LEARN' })).toBe(s);
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(s.answerReview.judgmentPending).toBe(true);
    expect(jeopardyReducer(s, { type: 'SHOW_LEARN' })).toBe(s);
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('answer-review');
    s = jeopardyReducer(s, { type: 'SHOW_LEARN' });
    expect(s.learning).toBe(true);
    expect(jeopardyReducer(s, { type: 'SHOW_LEARN' })).toBe(s);
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s).toMatchObject({ phase: 'board', learning: false });
  });

  it('v1: opens once the answer is shown; HIDE_LEARN closes it', () => {
    let s = jeopardyReducer(toBoard(learnSet()), { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'TIMEOUT' });
    s = jeopardyReducer(s, { type: 'SHOW_LEARN' });
    expect(s.learning).toBe(true);
    expect(jeopardyReducer(s, { type: 'HIDE_LEARN' }).learning).toBe(false);
  });

  it('a clue without a learn note ignores SHOW_LEARN', () => {
    let s = jeopardyReducer(v2Board(), { type: 'MOVE_CURSOR', dir: 'right' }); // CatB has no learn note
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'TIMEOUT' });
    expect(s.phase).toBe('answer-review');
    expect(jeopardyReducer(s, { type: 'SHOW_LEARN' })).toBe(s);
  });

  it('the final learn note opens during final judging', () => {
    let s = { ...toBoard(learnSet()), phase: 'final-clue' };
    expect(jeopardyReducer(s, { type: 'SHOW_LEARN' })).toBe(s);
    s = jeopardyReducer(s, { type: 'REVEAL' });
    s = jeopardyReducer(s, { type: 'SHOW_LEARN' });
    expect(s).toMatchObject({ phase: 'final-judging', learning: true });
    expect(jeopardyReducer(s, { type: 'HIDE_LEARN' }).learning).toBe(false);
  });
});
