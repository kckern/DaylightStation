import {it,expect,vi} from 'vitest';
import {JournalistInputRouter} from './JournalistInputRouter.mjs';
const event=(id,type='text',callbackData)=>({type,platform:'telegram',platformUserId:id,conversationId:'telegram:b42_c'+id,messageId:'99',metadata:{senderId:id,chatId:id,chatType:'private'},payload:{text:'Journal '+id,callbackData}});
it('keeps identity, response context and KB principal request-local while concurrent users await',async()=>{
 let release;const wait=new Promise(resolve=>{release=resolve;}),entries=[];
 const router=new JournalistInputRouter({getHandleCategorySelection:()=>({execute:async input=>{if(input.userId==='sample')await wait;return {freeform:true};}}),getProcessTextEntry:()=>({execute:async input=>{entries.push(input);return input;}})},{userIdentityService:{resolveUsername:(_,id)=>id==='101'?'sample':'other'},logger:{debug(){},warn(){},error(){}}});
 const firstContext={tag:'first'},secondContext={tag:'second'},firstPrincipal=Object.freeze({username:'sample'}),secondPrincipal=Object.freeze({username:'other'});
 const first=router.route(event('101'),firstContext,{knowledgePrincipal:firstPrincipal});
 await router.route(event('202'),secondContext,{knowledgePrincipal:secondPrincipal});release();await first;
 expect(entries.find(e=>e.chatId.endsWith('101'))).toMatchObject({userId:'sample',responseContext:firstContext,knowledgePrincipal:firstPrincipal});
 expect(entries.find(e=>e.chatId.endsWith('202'))).toMatchObject({userId:'other',responseContext:secondContext,knowledgePrincipal:secondPrincipal});
});
it('routes KB callbacks before legacy paths while AI is offline and redacts callback data',async()=>{
 const legacy=vi.fn(),handleCallback=vi.fn(async()=>({handled:true,status:'applied'})),logs=[];
 const principal=Object.freeze({username:'sample'}),router=new JournalistInputRouter({getHandleCallbackResponse:()=>({execute:legacy})},{knowledgeCompanion:{handleCallback},aiGatewayAvailable:false,logger:{debug:(name,data)=>logs.push({name,data}),error(){},warn(){}}});
 const raw='kb1:opaque-token:y';expect(await router.route(event('101','callback',raw),{}, {knowledgePrincipal:principal})).toMatchObject({handled:true});
 expect(legacy).not.toHaveBeenCalled();expect(handleCallback.mock.calls[0][0]).toMatchObject({principal,callbackData:raw});expect(JSON.stringify(logs)).not.toContain(raw);
});
