import {AgendaMigration} from './application/AgendaMigration.mjs';
import {AgendaMigrationStore} from './adapters/AgendaMigrationStore.mjs';
import {createAgendaMigrationRouter} from './api/agendaMigration.mjs';
import {randomUUID} from 'node:crypto';
import {AgendaPlanningService, AgendaParticipantContextProvider, createAgendaActivityValidator, AgendaLaunchRefCodec, YamlAgendaRepository, YamlAgendaLaunchLedger, createAdminAgendasRouter} from './agenda.mjs';
import {AgendaContentAdapter, AgendaMenuProjector} from './content.mjs';
import {AgendaResourceAliases} from './AgendaResourceAliases.mjs';
import {ParticipantSetupResolver} from '../../../../__capabilities/content-catalog/server/participant-launch.mjs';

/** Assemble the Agenda-owned parts; the shared launch service is installed by the caller. */
export function createAgendaRuntime({configService,peopleDirectory,listCodec,listProjector,consumerRegistry,gaming,logger,clock=()=>new Date(),ownership}) {
  if (!configService || !peopleDirectory || !listCodec || !listProjector || !consumerRegistry || !gaming?.resolveTarget || !gaming?.resolveItemImage || !logger) throw Error('Agenda runtime dependencies required');
  const householdId=configService.getDefaultHouseholdId();
  const pathForHousehold=id=>configService.getHouseholdPath('',id);
  const repository=new YamlAgendaRepository({pathForHousehold,listCodec,assertWritable:ownership?.assertAgendaWritable});
  const launchStore=new YamlAgendaLaunchLedger({repository,pathForHousehold});
  const codec=new AgendaLaunchRefCodec();
  const authorized=viewer=>Boolean(viewer?.participant_id && viewer.householdId===householdId);
  const contextProvider=new AgendaParticipantContextProvider({repository,store:launchStore,codec,clock,directory:peopleDirectory,authorize:async({householdId:id,viewer})=>id===householdId && authorized(viewer),resolveTarget:gaming.resolveTarget});
  const setupResolver=new ParticipantSetupResolver({registry:consumerRegistry});
  const ids=Object.fromEntries(['plan','section','item','rosterEntry'].map(key=>[key,()=>randomUUID()]));
  const planning=new AgendaPlanningService({repository,clock,ids,validateActivities:createAgendaActivityValidator({provider:contextProvider,setupResolver}),logger,resolveDisplay:args=>peopleDirectory.resolve(args),remapActivitySettings:args=>consumerRegistry.remapActivitySettings(args),householdTimezone:configService.getHouseholdTimezone?.(householdId),resolveItemImage:gaming.resolveItemImage});
  const projector=new AgendaMenuProjector({listProjector,codec,resolveTarget:gaming.resolveTarget,registry:consumerRegistry,logger});
  const contentAdapter=new AgendaContentAdapter({repository,projector,clock,resolveHousehold:async({viewer,seriesId})=>{if (!authorized(viewer)) throw Object.assign(Error('Agenda authority required'),{code:'authorization_denied'});ownership?.assertAgendaWritable({householdId,seriesId});return householdId;}});
  const resourceAliases=gaming.resourceAliases ?? ownership?.aliases ?? new AgendaResourceAliases();
  let migration=null;
  if(ownership?.configuration){
    const configuration=ownership.configuration;
    const store=new AgendaMigrationStore({...configuration,repository,ownership,reloadFitness:()=>configService.reloadHouseholdAppConfig(householdId,'fitness')});
    migration=new AgendaMigration({...configuration,store,repository,listCodec,clock,timezone:configService.getHouseholdTimezone(householdId),resolvePerson:person=>peopleDirectory.resolve({householdId,person}),validateActivities:createAgendaActivityValidator({provider:contextProvider,setupResolver})});
  }
  const migrationRouter=createAgendaMigrationRouter({householdId,migration,logger});
  return {migration,migrationRouter,repository,adminRouter:createAdminAgendasRouter({householdId,planning,logger}),contentAdapter,contextProvider,launchStore,resourceAliases};
}

export {AgendaResourceAliases};

export {createConfiguredMigrationOwnership} from './adapters/migrationConfiguration.mjs';
