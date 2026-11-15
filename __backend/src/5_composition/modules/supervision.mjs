import {CallHomeAssistantService} from '../../../../__capabilities/home-control/server/application/CallHomeAssistantService.mjs';
import {PortalKeysLockdownAdapter} from '#adapters/devices/PortalKeysLockdownAdapter.mjs';
import {createArcadeSupervisionConsumers} from '../../../../__app_modules/games/arcade/server/supervision-runtime.mjs';
import {createTrustedParentalScanner} from '../../../../__app_modules/wellness/fitness/server/supervision-runtime.mjs';
import {randomUUID} from 'node:crypto';
import {createSupervisionModule,createDisabledSupervisionRouter,JsonSupervisionRepository,StateGatesSupervisionPort,HaStopActuator,KioskSessionAuthority,BrowserStopConsumer,validateConsumerManifest,readLegacyStops,AccessDenied,ApprovalWorkflow,createApprovalTokenPrimitives,HaApprovalNotifier,ApprovalCallbackAuthority,ApprovalModeProducer,validateApprovalModeConfig,EffectiveEnforcement,ActivityCatalog,NativeLeaseConsumer,NativeLeaseAuthority,NativeLeaseCredentials,EligibilitySnapshot} from '../../../../__app_modules/household/supervision/server/index.mjs';
/** Explicit configured registry; persisted authority survives config removal. */
export async function createSupervisionRuntime(options){
  const {configService,householdId,clock={now:()=>Date.now()},logger,makeId=randomUUID}=options;
  const repository=options.repository??new JsonSupervisionRepository({path:configService.getHouseholdPath('supervision/current.json',householdId)});
  const requested=options.configuration??configService?.getHouseholdAppConfig(householdId,'supervision');
  if(!requested?.enabled && repository.hasPersistedState && !await repository.hasPersistedState()){
    await repository.close?.();return {enabled:false,router:createDisabledSupervisionRouter(),dispose(){}};
  }
  const persisted=await repository.read();
  const retained=persisted.configuration!=null || Object.keys(persisted.devices).length>0 || persisted.epoch>0 || persisted.outbox.length>0;
  if(!requested?.enabled && !retained){await repository.close?.();return {enabled:false,router:createDisabledSupervisionRouter(),dispose(){}};}
  const configuration=requested?.enabled?requested:persisted.configuration??{scopes:{'child-public':Object.keys(persisted.devices)},devices:Object.keys(persisted.devices).map(id=>({id,required_capabilities:['unconfigured-enforcement']}))};
  if(requested?.enabled)await repository.transaction(state=>{state.configuration=structuredClone(configuration);});
  const credentials=options.credentials??configService?.getHouseholdAuth?.(configuration.credentials_auth_ref??'supervision',householdId);
  // Missing keys retain the locked runtime and parent password recovery, never disabled mode.
  const verifyScan=createTrustedParentalScanner({credentials,clock,scannerId:configuration.scanner_id});
  const kiosk=credentials?.secret?new KioskSessionAuthority({...credentials,householdId,clock,makeId,delegations:configuration.delegations??{}}):null;
  const stateGates=options.stateGates??new StateGatesSupervisionPort({householdId,principal:options.principal,modePrincipal:options.modePrincipal,ingress:options.stateGatesModule.ingress,getCurrentEntitlements:options.stateGatesModule.container.getCurrentEntitlements});
  const approvalConfigured=configuration.approval_mode?.enabled===true,errors=[];
  let modeConfiguration;
  try{modeConfiguration=validateApprovalModeConfig(configuration.approval_mode);}catch{errors.push('APPROVAL_CONDITION_INVALID');modeConfiguration={enabled:true,entityId:'supervision.invalid_configuration',normalStates:['validated'],approvalRequiredStates:['unknown'],maxAgeMs:60000,refreshMs:30000};}
  const devices=configuration.devices.map(device=>({id:device.id,requiredCapabilities:[...new Set([...(device.required_capabilities??[]),...(approvalConfigured?(device.native_packages??[]).map(name=>`native-lease:${name}`):[])])]}));
  let catalog;
  const getLearners=options.getLearners??(()=>[]);
  try{catalog=new ActivityCatalog({activities:configuration.activities??[],devices,getLearners});}catch{errors.push('APPROVAL_CATALOG_INVALID');catalog=new ActivityCatalog({devices,getLearners});}
  if(approvalConfigured){
    if(typeof credentials?.callback_credential!=='string' || credentials.callback_credential.length<32 || !modeConfiguration.recipientId)errors.push('APPROVAL_CALLBACK_CONFIGURATION_REQUIRED');
    if(!/^notify\.[a-zA-Z0-9_]+$/.test(modeConfiguration.notifyService??''))errors.push('APPROVAL_NOTIFY_TARGET_REQUIRED');
    if(typeof options.baselineEligibility!=='function')errors.push('APPROVAL_BASELINE_PORTS_REQUIRED');
    if(!configuration.activities?.length || !options.getLearners)errors.push('APPROVAL_CATALOG_REQUIRED');
  }
  const gateway={callService:(...args)=>options.getHaGateway?.()?.callService(...args)??Promise.resolve({ok:false}),getState:(...args)=>options.getHaGateway?.()?.getState(...args)??Promise.resolve(null)};
  const eligibility=new EligibilitySnapshot({clock,read:options.baselineEligibility??(async()=>({allowed:false}))});
  let notifier=null;
  if(approvalConfigured && !errors.some(error=>error.includes('CALLBACK') || error.includes('NOTIFY'))){
    notifier=new HaApprovalNotifier({callHomeAssistant:options.callHomeAssistant??new CallHomeAssistantService({haGateway:gateway,logger}),notifyService:modeConfiguration.notifyService,recipientId:modeConfiguration.recipientId,clock,logger,timezone:configService?.getHouseholdTimezone?.(),learnerName:id=>(options.learnerName?.(id)),deviceName:id=>configuration.devices.find(device=>device.id===id)?.label});
  }
  const browsers=devices.filter(device=>device.requiredCapabilities.includes('browser')).map(device=>new BrowserStopConsumer({deviceId:device.id,clock}));
  const configuredConsumers=()=>{
    const native=createArcadeSupervisionConsumers({configuration,devicesConfig:configService.getHouseholdDevices(householdId),configService,httpClient:options.httpClient,logger,clock,householdId,gamesCatalog:options.gamesCatalog});
    for(const device of configuration.devices){
      if(device.portal_keys){
        const auth=configService.getHouseholdAuth?.(device.portal_keys.auth_ref,householdId);
        const adapter=new PortalKeysLockdownAdapter({baseUrl:device.portal_keys.base_url,token:typeof auth==='string'?auth:auth?.token,logger});
        native.push({deviceId:device.id,capability:'portal-keys',capabilities:['portal-keys'],stop:input=>adapter.stop(input),release:input=>adapter.release(input)});
      }
      if(device.ha_stop){
        const gateway={callService:(...args)=>options.getHaGateway?.()?.callService(...args)??Promise.resolve({ok:false}),getState:(...args)=>options.getHaGateway?.()?.getState(...args)??Promise.resolve(null)};
        const actuator=new HaStopActuator({gateway,clock,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),entities:device.ha_stop.observation_entities});
        native.push({deviceId:device.id,capability:'ha-stop',capabilities:['ha-stop'],stop:input=>actuator.stop(input),release:input=>actuator.release(input)});
      }
    }
    return native;
  };
  const ownerConsumers=options.consumers??(configService?configuredConsumers():[]);
  const nativeLeases=approvalConfigured?devices.flatMap(device=>device.requiredCapabilities.filter(capability=>capability.startsWith('native:')).map(capability=>new NativeLeaseConsumer({deviceId:device.id,packageName:capability.slice(7),clock}))):[];
  const consumers=[...browsers,...ownerConsumers,...nativeLeases.filter(consumer=>!ownerConsumers.some(value=>value.deviceId===consumer.deviceId && value.capability===consumer.capability))];
  const nativeCredentials=new NativeLeaseCredentials({entries:credentials?.native_devices});
  for(const consumer of nativeLeases)if(typeof credentials?.native_devices?.[consumer.deviceId]?.credential!=='string' || credentials.native_devices[consumer.deviceId].credential.length<32 || !credentials.native_devices[consumer.deviceId].packages?.includes(consumer.packageName))errors.push('NATIVE_LEASE_CREDENTIAL_REQUIRED');
  let nativeLeaseAuthority;
  const coverage=validateConsumerManifest({devices,consumers});
  let runtime;
  const authenticateKiosk=async req=>{if(!kiosk)throw new AccessDenied('KIOSK_CONFIGURATION_REQUIRED');return kiosk.authenticate(req);};
  const cookie=(req,name,value,maxAge)=>`${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${req.secure?'; Secure':''}`;
  const attempts=new Map();
  const verifyParentCredentials=async(input,req)=>{
    const key=`${req?.ip??'internal'}:${String(input.username).toLowerCase()}`,now=clock.now();const recent=(attempts.get(key)??[]).filter(at=>now-at<600000);
    if(recent.length>=10)throw new AccessDenied('PARENT_AUTH_RATE_LIMITED');attempts.set(key,[...recent,now]);
    return options.verifyParentCredentials?.(input,req);
  };
  const health=async()=>({...coverage,errors:[...errors],activationAllowed:errors.length===0 && coverage.activationAllowed && (await Promise.all(devices.map(device=>runtime.reconciler.isReady({deviceId:device.id})))).every(Boolean),consumers:runtime.reconciler.health()});
  runtime=await createSupervisionModule({...options,repository,stateGates,clock,makeId,legacy:options.legacy??(configService?readLegacyStops({configService,householdId}):{}),scopes:configuration.scopes,scopeId:configuration.scope_id??'child-public',consumers,
    enforcementReady:({deviceId})=>!coverage.missing.some(item=>item.deviceId===deviceId),
    verifyParentCredentials,authenticateKiosk,
    authenticateParent:options.authenticateParent??(async()=>{throw new AccessDenied('PARENT_AUTHENTICATION_REQUIRED');}),
    getHealth:async()=>({activationAllowed:(await health()).activationAllowed,consumers:runtime.reconciler.health()}),
    getCatalog:context=>catalog.list(context),
    renewNativeLease:input=>nativeLeaseAuthority.renew({...nativeCredentials.authenticate(input),ack:input.ack}),
    createWorkflow:({service})=>new ApprovalWorkflow({repository,service,clock,makeId,...createApprovalTokenPrimitives(),recipientId:modeConfiguration.recipientId,notifier,resolveActivity:context=>catalog.resolve(context),baselineEligibility:eligibility.port(),logger}),
    createCallbackAuthority:({workflow})=>notifier?new ApprovalCallbackAuthority({credential:credentials.callback_credential,recipientId:modeConfiguration.recipientId,principalId:'home-assistant-supervision',lookupAction:input=>workflow.findAction(input)}):null,
    createEnforcement:({service,workflow})=>new EffectiveEnforcement({repository,service,workflow,clock,devices,nativeActivity:(target,capability)=>target.owner==='arcade' && capability===`native:${target.nativePackage}`}),
    getDiagnostics:async()=>{
      const state=await repository.read(),now=clock.now();return {condition:{enabled:modeConfiguration.enabled,entityId:modeConfiguration.entityId??null,normalStates:modeConfiguration.normalStates??[],approvalRequiredStates:modeConfiguration.approvalRequiredStates??[]},mode:{required:state.mode?.required!==false || state.mode?.expiresAt<=now,known:!!state.mode && state.mode.expiresAt>now,observedAt:state.mode?.observedAt??null,expiresAt:state.mode?.expiresAt??null},epoch:state.epoch,scanner:verifyScan.health(),enforcement:await health(),requests:Object.values(state.requests).map(request=>({id:request.id,deviceId:request.deviceId,learnerId:request.learnerId,activityId:request.activityId,status:request.status,epoch:request.epoch,createdAt:request.createdAt,expiresAt:request.expiresAt,decidedAt:request.decidedAt??null,decisionActorId:request.decisionActorId??null,reason:request.reason??null,notification:{status:request.notification.status,attempt:request.notification.attempt}}))};
    },
    getBootstrap:async req=>{
      let identity;
      try{identity=await authenticateKiosk(req);}catch{
        try{const renewed=await kiosk?.renew(req);if(renewed){req.res.append('Set-Cookie',cookie(req,'daylight_kiosk',renewed.token,600));identity={deviceId:renewed.deviceId,sessionId:renewed.sessionId};}}catch{}
      }
      if(!identity)return {enabled:true,pairingRequired:true,devices:devices.map(device=>device.id)};
      await runtime.enforcement.refresh();const status=await runtime.service.status(identity);return {enabled:true,...identity,active:status.active,epoch:status.epoch,commandRevision:(await runtime.enforcement.revisions())[identity.deviceId]};
    },
    enrollKiosk:async(req,res)=>{
      if(!kiosk)throw new AccessDenied('KIOSK_CONFIGURATION_REQUIRED');
      const deviceId=req.body.deviceId;const bootstrap=kiosk.provision({deviceId});
      res.append('Set-Cookie',cookie(req,'daylight_kiosk_bootstrap',bootstrap,2592000));
      const renewed=await kiosk.renew({headers:{cookie:`daylight_kiosk_bootstrap=${bootstrap}`}});res.append('Set-Cookie',cookie(req,'daylight_kiosk',renewed.token,600));
      logger?.info?.('supervision.kiosk.enrolled',{deviceId});
    },
    ackConsumer:async(identity,input)=>{
      await runtime.enforcement.refresh();const revisions=await runtime.enforcement.revisions();
      if(input.commandRevision!==revisions[identity.deviceId])throw new AccessDenied('SUPERVISION_STALE_ACK');
      const consumer=browsers.find(item=>item.deviceId===identity.deviceId);if(!consumer)throw new AccessDenied('SUPERVISION_DEVICE_UNKNOWN');
      consumer.acknowledge(input);void runtime.reconciler.reconcile({deviceId:identity.deviceId,capability:'browser'});
    },
  });
  nativeLeaseAuthority=new NativeLeaseAuthority({repository,service:runtime.service,workflow:runtime.workflow,enforcement:runtime.enforcement,clock,consumers:nativeLeases,observeNative:options.observeNative??(async input=>ownerConsumers.find(consumer=>consumer.deviceId===input.deviceId && consumer.capability===`native:${input.packageName}`)?.observe?.())});
  const modeProducer=new ApprovalModeProducer({configuration:modeConfiguration,clock,publishMode:payload=>runtime.service.publishMode(payload),readState:async entityId=>{
    if(errors.length || !coverage.activationAllowed)return {state:'unknown'};
    return gateway.getState(entityId);
  },scheduleEvery:options.scheduleEvery,logger});
  await modeProducer.start();await runtime.enforcement.refresh();
  const dispose=runtime.dispose;
  return {...runtime,enabled:true,configuration,kiosk,repository,health,modeProducer,verifyScan,resolveContext:(req,metadata)=>{if(!kiosk)throw new AccessDenied('KIOSK_CONFIGURATION_REQUIRED');return kiosk.resolveContext(req,metadata);},dispose(){modeProducer.dispose();dispose();void repository.close?.();}};
}

/** Queued legacy work keeps the epoch at admission; it is never fresh approval. */
export function createDoNowSupervisionAuthority(runtime){
  return async(record,effect)=>{
    const deviceId=runtime.configuration.surface_devices?.[record.surface];if(!deviceId)throw new AccessDenied('KIOSK_CONTEXT_REQUIRED');
    if(record.approvalId){const status=await runtime.service.status({deviceId});if(!Number.isSafeInteger(record.accessContext?.admittedEpoch) || record.accessContext.admittedEpoch!==status.epoch)throw new AccessDenied('SUPERVISION_EPOCH_REVOKED');}
    const activityId=record.activityId??runtime.configuration.surface_activities?.[record.surface]??record.surface;
    return runtime.guard.runAuthorized({...record.accessContext,deviceId,activityId,learnerId:record.learnerId},effect);
  };
}
