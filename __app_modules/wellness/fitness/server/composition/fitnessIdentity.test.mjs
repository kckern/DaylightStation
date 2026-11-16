import {it,expect} from 'vitest';
import {createFitnessUserHydrator} from './fitnessApi.mjs';
import {PeopleDirectory} from '../../../../../__capabilities/household-identity/server/public.mjs';

it('hydrates shared guests through the installed directory and preserves Fitness overlays',()=>{
 const directory=new PeopleDirectory({householdDirectory:{userIds:()=>['member'],userProfile:()=>({name:'Member'})},guestStore:{read:()=>({revision:0,guests:[{id:'visitor',name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'},active:true}]})}});
 const hydrator=createFitnessUserHydrator({peopleDirectory:directory,householdId:'home',profileReader:{getProfile:id=>({username:id,display_name:'Member'})},logger:{warn(){}}});
 const result=hydrator.hydrateConfig({users:{primary:['member'],family:[{person:{kind:'guest',id:'visitor'},zones:{warm:90}}],friends:[{id:'legacy',name:'Legacy',hr:7}]},devices:{heart_rate:{'42':'visitor'}}});
 expect(result.users.primary[0]).toMatchObject({id:'member',name:'Member'});
 expect(result.users.family[0]).toMatchObject({id:'visitor',name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'},zones:{warm:90},hr:42});
 expect(result.users.friends[0]).toMatchObject({id:'legacy',name:'Legacy',hr:7});
});
