import {it,expect,vi} from 'vitest';
import {createParticipantTargetResolver} from './targetResolver.mjs';

it('resolves authored and direct app inputs through the same owner and rejects unknown apps', async () => {
 const owner=vi.fn(async ({path})=>({kind:'app',appId:'party-games',definitionId:path,participantConsumer:{id:'party-games',version:1}}));
 const resolve=createParticipantTargetResolver({apps:{'party-games':owner},resolveContent:async()=>null});
 const viewer={participant_id:'u',householdId:'home',role:'host'};
 const authored=await resolve({action:'open',target:{kind:'authored-action',value:'party-games/charades:test'},viewer});
 const direct=await resolve({action:'open',target:{kind:'app',appId:'party-games',definitionId:'charades:test',participantConsumer:{id:'spoof',version:9}},viewer});
 expect(direct).toEqual(authored);
 expect(owner).toHaveBeenCalledTimes(2);
 await expect(resolve({action:'open',target:{kind:'authored-action',value:'unknown/a'},viewer})).rejects.toMatchObject({code:'invalid_target'});
});

it('delegates ordinary app and content targets to their owners', async () => {
 const viewer={participant_id:'u',householdId:'home',role:'host'};
 const ordinary=vi.fn(async ({path})=>({kind:'app',appId:'webcam',path}));
 const content=vi.fn(async ({action,target})=>({kind:'content',source:'files',id:target.value,capabilities:{[action]:{action}}}));
 const resolve=createParticipantTargetResolver({apps:{webcam:ordinary},resolveContent:content});
 await expect(resolve({target:{kind:'authored-action',value:'webcam'},action:'open',viewer})).resolves.toEqual({kind:'app',appId:'webcam',path:null});
 await expect(resolve({target:{kind:'authored-action',value:'files:video'},action:'play',viewer})).resolves.toEqual({kind:'content',source:'files',id:'files:video',capabilities:{play:{action:'play'}}});
 expect(content).toHaveBeenCalledWith({target:{kind:'authored-action',value:'files:video'},action:'play',viewer});
});

it('resolves content through its catalog owner and rejects spoofed capabilities', async () => {
 const {createContentTargetResolver}=await import('./targetResolver.mjs');
 const catalog={getItem:vi.fn(async()=>({id:'files:song'})),capabilities:vi.fn(()=>['playable'])};
 const resolver=createContentTargetResolver({contentIdResolver:{resolve:()=>({source:'files',localId:'song'})},contentCatalog:catalog,authorize:async({viewer})=>viewer.householdId==='home'});
 const viewer={participant_id:'u',householdId:'home'};
 await expect(resolver({target:{kind:'content',id:'files:song',capabilities:{playable:{participantConsumer:{id:'spoof',version:1}}}},action:'play',viewer})).resolves.toEqual({kind:'content',source:'files',id:'files:song',capabilities:{playable:{action:'play'}}});
 await expect(resolver({target:{kind:'authored-action',value:{contentId:'files:song'}},action:'play',viewer:{participant_id:'u',householdId:'other'}})).rejects.toMatchObject({code:'authorization_denied'});
});

it('resolves ordinary list navigation through actual owner capabilities', async () => {
 const {createContentTargetResolver}=await import('./targetResolver.mjs');
 const resolver=createContentTargetResolver({contentIdResolver:{resolve:()=>({source:'menu',localId:'songs'})},contentCatalog:{getItem:async()=>({id:'menu:songs'}),capabilities:()=>['listable']},authorize:async()=>true});
 await expect(resolver({target:{kind:'authored-action',value:{contentId:'menu:songs'}},action:'list',viewer:{}})).resolves.toEqual({kind:'content',source:'menu',id:'menu:songs',capabilities:{listable:{action:'list'}}});
});

it('retains only an exact owner-declared content consumer for the selected item and action', async () => {
 const {ContentSourceRegistry}=await import('../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs');
 const {RegistryContentCatalogGateway}=await import('../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs');
 const {ContentIdResolver}=await import('../../../../__capabilities/content-catalog/server/application/ContentIdResolver.mjs');
 const {ParticipantConsumerRegistry}=await import('../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const {createContentTargetResolver}=await import('./targetResolver.mjs');
 const sources=new ContentSourceRegistry();sources.register({source:'test',prefixes:[],getItem:async id=>({id}),getList:async()=>({items:[]}),getCapabilities:()=>['displayable'],describeParticipantAction:(item,action)=>item.id==='aware' && action==='display'?{participantConsumer:{id:'fake',version:1}}:null});
 const catalog=new RegistryContentCatalogGateway({registry:sources});const resolve=createContentTargetResolver({contentIdResolver:new ContentIdResolver(catalog),contentCatalog:catalog,authorize:async()=>true});
 const consumer={id:'fake',version:1,targets:[{action:'display',kind:'content',source:'test',capability:'displayable'}],describe:()=>({}),prepareSetup:async()=>{},begin:async()=>{}};const registry=new ParticipantConsumerRegistry();registry.register({consumer});
 const aware=await resolve({target:{kind:'content',id:'test:aware'},action:'display',viewer:{}});
 expect(registry.resolve({target:aware,action:'display'})).toBe(consumer);
 const ordinary=await resolve({target:{kind:'content',id:'test:other',capabilities:{displayable:{participantConsumer:{id:'fake',version:1}}}},action:'display',viewer:{}});
 expect(registry.resolve({target:ordinary,action:'display'})).toBeNull();
});
