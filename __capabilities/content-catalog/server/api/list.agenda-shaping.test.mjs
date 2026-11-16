import { describe, it, expect } from 'vitest';
import { toListItem } from './list.mjs';

describe('runtime list presentation', () => {
  it('preserves typed references and disabled navigation without synthesized actions', () => {
    const ref = {schema:'participant-launch-ref/v1',provider:'agenda',ref:'001'};
    const item = {id:'agenda:series/plans/001',title:'Week',itemType:'container',disabled:true,
      participantLaunches:{open:ref}, actions:{open:{app:'test'}}};
    const result = toListItem(item,{capabilities:['listable']});
    expect(result.disabled).toBe(true);
    expect(result.participantLaunches.open).toEqual(ref);
    expect(result.open).toBeUndefined();
    expect(result.queue).toBeUndefined();
    expect(result.list).toBeUndefined();
  });
});

it('keeps explicit false presentation and whitelists only typed action references', () => {
 const item={id:'files:1',title:'One',disabled:false,participantLaunches:{open:{schema:'participant-launch-ref/v1',provider:'001',ref:'002',secret:'discard'},list:{schema:'participant-launch-ref/v1',provider:'x',ref:'y'}}};
 const result=toListItem(item);
 expect(result.disabled).toBe(false);
 expect(result.participantLaunches).toEqual({open:{schema:'participant-launch-ref/v1',provider:'001',ref:'002'}});
});
