import { describe, it, expect } from 'vitest';
import { validateParticipantContext, validateParticipantSelector, selectParticipants, createParticipantContext } from './participants.mjs';
const roster = [
  { key:'a', participant_id:'u', identity:{kind:'user',id:'u'}, display:{name:'User',avatar:null} },
  { key:'b', participant_id:'guest:g', identity:{kind:'guest',id:'g'}, display:{name:'Guest',avatar:null} },
  { key:'c', participant_id:'anon:p:c', identity:{kind:'anonymous',scope_id:'p',slot_id:'c'}, display:{name:'Guest 2',avatar:null} },
];
const all = {schema:'participant-selector/v1',mode:'all'};
describe('shared participants', () => {
  it('selects all or an ordered replacement including empty', () => {
    expect(selectParticipants({roster,selector:all})).toEqual(roster);
    expect(selectParticipants({roster,selector:{schema:all.schema,mode:'explicit',keys:['c','a']}})).toEqual([roster[2],roster[0]]);
    expect(selectParticipants({roster,selector:{schema:all.schema,mode:'explicit',keys:[]}})).toEqual([]);
    expect(() => selectParticipants({roster,selector:{schema:all.schema,mode:'explicit',keys:['missing']}})).toThrow();
    expect(() => validateParticipantSelector({schema:all.schema,mode:'explicit',keys:['a','a']})).toThrow();
  });
  it('validates identities and uniqueness', async () => {
    const context = await createParticipantContext({scope:{provider:'test',id:'p',revision:1},participants:roster});
    expect(validateParticipantContext(context)).toEqual(context);
    for (const participants of [[roster[0],roster[0]], [roster[0],{...roster[1],participant_id:roster[0].participant_id}], [{...roster[0],participant_id:'wrong'}], [{...roster[0],identity:{kind:'unknown'}}], [{...roster[0],display:{name:' ',avatar:null}}]]) {
      expect(() => validateParticipantContext({...context,participants})).toThrow();
    }
  });
  it('hashes canonical content independent of object key order and sensitive to roster order', async () => {
    const a = await createParticipantContext({scope:{provider:'test',id:'p',revision:1},participants:roster});
    const b = await createParticipantContext({scope:{revision:1,id:'p',provider:'test'},participants:roster.map(({display,identity,participant_id,key}) => ({display,identity,participant_id,key}))});
    expect(a.context_id).toBe(b.context_id);
    expect((await createParticipantContext({scope:a.scope,participants:[...roster].reverse()})).context_id).not.toBe(a.context_id);
  });
});
