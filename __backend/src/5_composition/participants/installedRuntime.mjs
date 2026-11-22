import {SCREEN_APP_IDS} from '../../../../__capabilities/screen-host/portable/appIds.mjs';
import {ParticipantConsumerRegistry,ParticipantLaunchService,createParticipantLaunchesRouter} from '../../../../__capabilities/content-catalog/server/participant-launch.mjs';
import {EmbeddedListCodec} from '../../../../__capabilities/content-catalog/server/list-codec.mjs';
import {ListMenuProjector} from '../../../../__capabilities/content-catalog/server/list-menu-projector.mjs';
import {createListArtworkResolver} from '../../../../__capabilities/content-catalog/server/list-artwork.mjs';
import {createPeopleRouter} from '../../../../__capabilities/household-identity/server/public.mjs';
import {createAgendaRuntime,AgendaResourceAliases} from '../../../../__app_modules/household/agenda/server/composition.mjs';
import {createAdminAgendasRouter} from '../../../../__app_modules/household/agenda/server/agenda.mjs';
import {createPartyGamesParticipantConsumer,createPartyGamesTargetResolver} from '../../../../__app_modules/games/party-games/server/participants.mjs';
import {createContentTargetResolver,createParticipantTargetResolver} from './targetResolver.mjs';

export function installParticipantRuntime({enabled,configService,peopleDirectory,contentRegistry,contentServices,gaming,logger,clock,ownership,resourceAliases = ownership?.aliases ?? new AgendaResourceAliases()}) {
 const householdId=configService.getDefaultHouseholdId();
 if (enabled !== true) return {participantRouter:createParticipantLaunchesRouter({householdId,service:null,logger}),peopleRouter:createPeopleRouter({householdId,directory:peopleDirectory ?? null,logger}),agenda:{adminRouter:createAdminAgendasRouter({householdId,planning:null,logger})}};
 const registry=new ParticipantConsumerRegistry();
 registry.register({consumer:createPartyGamesParticipantConsumer({definitions:gaming.definitions,manifestStore:gaming.manifestStore,clueHistory:gaming.clueHistory,gamingApplication:gaming.gamingApplication})});
 const isHouseholdViewer=viewer=>Boolean(viewer?.participant_id && viewer.householdId===householdId);
 const resolveContent=createContentTargetResolver({...contentServices,authorize:async({viewer})=>isHouseholdViewer(viewer)});
 const party=createPartyGamesTargetResolver({gamingApplication:gaming.gamingApplication,householdId});
 const apps=Object.fromEntries(SCREEN_APP_IDS.filter(id=>id!=='party-games').map(appId=>[appId,async({path,viewer})=>{
  if (!isHouseholdViewer(viewer)) throw Object.assign(Error('Household authority required'),{code:'authorization_denied'});
  if (path != null && (typeof path !== 'string' || /[\u0000-\u001f]/.test(path))) throw Object.assign(Error('Invalid app path'),{code:'invalid_target'});
  return {kind:'app',appId,path};
 }]));
 apps['party-games']=party;
 const resolveDirectTarget=createParticipantTargetResolver({apps,resolveContent});
 const resolveTarget=({item,action,viewer})=>resolveDirectTarget({target:{kind:'authored-action',value:item[action]},action,viewer});
 const artwork=createListArtworkResolver({mediaDir:configService.getMediaDir()});
 const agenda=createAgendaRuntime({configService,peopleDirectory,listCodec:EmbeddedListCodec,listProjector:new ListMenuProjector({registry:contentRegistry,artworkForUid:uid=>artwork({item:{uid}})}),consumerRegistry:registry,gaming:{resolveTarget,resolveItemImage:artwork,resourceAliases},logger,clock,ownership});
 contentRegistry.register(agenda.contentAdapter);
 const service=new ParticipantLaunchService({registry,providers:[agenda.contextProvider],resolveDirectTarget,logger});
 return {participantRouter:createParticipantLaunchesRouter({householdId,service,logger}),peopleRouter:createPeopleRouter({householdId,directory:peopleDirectory,logger}),agenda,registry,service};
}
