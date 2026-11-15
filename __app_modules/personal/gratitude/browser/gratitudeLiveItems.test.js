import { it,expect } from 'vitest';
import { mergeGratitudeItems,shouldPersistIncoming } from './gratitudeLiveItems.js';
it('merges server-persisted selections without echoing another write',()=>{
  const item={id:'school-gratitude:child:2026-11-16',text:'Toys'};
  expect(mergeGratitudeItems([item],[{...item,userId:'child'}])).toEqual([{...item,userId:'child'}]);
  expect(shouldPersistIncoming({source:'school',persisted:true})).toBe(false);
  expect(shouldPersistIncoming({source:'homebot'})).toBe(false);
  expect(shouldPersistIncoming({source:'legacy'})).toBe(true);
});
