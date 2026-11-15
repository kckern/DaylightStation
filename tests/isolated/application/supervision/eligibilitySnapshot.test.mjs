import {it,expect} from 'vitest';
import {EligibilitySnapshot} from '../../../../__app_modules/household/supervision/server/application/EligibilitySnapshot.mjs';
it('slow owner reads never hold Stop admission and missing/stale eligibility denies until refreshed',async()=>{
 let now=100000,resolve,calls=0;const cache=new EligibilitySnapshot({clock:{now:()=>now},read:async()=>{calls++;return new Promise(r=>{resolve=r;});}}),context={deviceId:'portal',learnerId:'user_5',activityId:'school:workspace'};
 expect(await cache.check(context)).toMatchObject({allowed:false});expect(calls).toBe(1);resolve({allowed:true});await Promise.resolve();await Promise.resolve();expect(await cache.check(context)).toMatchObject({allowed:true});expect(await cache.check({...context,learnerId:'sibling'})).toMatchObject({allowed:false});now=102001;expect(await cache.check(context)).toMatchObject({allowed:false});
});
