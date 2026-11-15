import {it,expect} from 'vitest';
import {screenActionActivity} from './supervisionScope.mjs';
it('screen selection derives exact scope from actual action; queues, snapshots and unknown display work cannot borrow a grant',()=>{
 expect(screenActionActivity('menu:open',{menuId:'school'})).toBe('school:workspace');
 expect(screenActionActivity('media:play',{contentId:'plex:42'})).toBe('media:plex:42');
 for(const action of ['media:queue','media:queue-op','media:restore-snapshot','display:overlay','display:content'])expect(screenActionActivity(action,{contentId:'plex:42'})).toBe('unsupported');
 expect(screenActionActivity('escape',{})).toBeNull();
});

it.each(['retry','pause','play','toggle'])('scopes %s to the canonical current item, never payload selection',command=>{
 const snapshot={currentItem:{contentId:'plex:42'}};
 expect(screenActionActivity('media:playback',{command,contentId:'plex:other'},snapshot)).toBe('media:plex:42');
 expect(screenActionActivity('media:playback',{command,contentId:'plex:42'})).toBe('unsupported');
 expect(screenActionActivity('media:playback',{command},{currentItem:null})).toBe('unsupported');
});

it.each(['skipNext','skipPrev','next','previous','clear'])('%s cannot borrow current-item authority to change the visit',command=>{
 expect(screenActionActivity('media:playback',{command},{currentItem:{contentId:'plex:42'}})).toBe('unsupported');
});
