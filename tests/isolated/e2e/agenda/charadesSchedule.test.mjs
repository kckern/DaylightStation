import {it,expect} from 'vitest';
import {assertCharadesSchedule} from '../../../live/flow/agenda/charadesSchedule.mjs';
const session={definition:{clues_per_turn:2},state:{turn_order:['a','b','c'],clue_presentations:['reader','reader','image','image','text','text']}};
const modes=new Map([['a','reader'],['b','image'],['c','text']]);
it('requires a complete nonempty schedule with every clue matched to its turn',()=>{
 expect(()=>assertCharadesSchedule(session,modes)).not.toThrow();
 expect(()=>assertCharadesSchedule({...session,state:{...session.state,clue_presentations:[]}},modes)).toThrow();
 expect(()=>assertCharadesSchedule({...session,state:{...session.state,clue_presentations:['reader']}},modes)).toThrow();
 expect(()=>assertCharadesSchedule({...session,state:{...session.state,clue_presentations:['reader','reader','text','image','text','text']}},modes)).toThrow();
 expect(()=>assertCharadesSchedule({...session,state:{...session.state,turn_order:['a','a','c']}},modes)).toThrow();
});
