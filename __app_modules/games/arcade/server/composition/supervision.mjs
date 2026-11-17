import {TrustedNativeActivityProbe} from '../adapters/TrustedNativeActivityProbe.mjs';
import {buildContentResolver} from './arcadeGameSessions.mjs';
import {AdbAdapter} from '#adapters/devices/AdbAdapter.mjs';
import {createArcadeKioskClient} from './kioskClients.mjs';
import {KioskArcadeGameTerminator} from '../adapters/devices/KioskArcadeGameTerminator.mjs';
/** Only explicitly declared native packages become supervised consumers. */
export function createArcadeSupervisionConsumers({configuration,devicesConfig,configService,httpClient,logger,clock={now:()=>Date.now()},gamesCatalog,householdId}){
  return (configuration?.devices??[]).flatMap(declared=>{
    const device=devicesConfig?.devices?.[declared.id];const control=device?.content_control??{};const fallback=control.fallback;
    if(!declared.native_packages?.length || fallback?.provider!=='adb' || !fallback.host)return [];
    const adbByDevice=new Map([[declared.id,new AdbAdapter({host:fallback.host,port:fallback.port},{logger})]]);
    // Fully's REST client or the Android kiosk app's, by the device's provider; used to bring the kiosk back after a stop.
    const kiosk=control.host?createArcadeKioskClient({deviceId:declared.id,control,configService,httpClient,logger}):null;
    const kioskByDevice=kiosk?new Map([[declared.id,kiosk]]):new Map();
    const gamesConfig=configService.getHouseholdAppConfig?.(householdId,'games');
    const resolveContent=buildContentResolver(gamesCatalog,gamesConfig);
    return declared.native_packages.map(packageName=>{
      const terminator=new KioskArcadeGameTerminator({adbByDevice,kioskByDevice,packageName,logger}),capability=`native:${packageName}`;
      const probe=new TrustedNativeActivityProbe({adbAdapter:adbByDevice.get(declared.id),packageName,logDir:gamesConfig?.source?.logs_path??'/storage/emulated/0/RetroArch/logs',clock,resolveContent});
      return {observe:()=>probe.observe(),deviceId:declared.id,capability,capabilities:[capability],stop:input=>terminator.stop(input),release:input=>terminator.release(input)};
    });
  });
}
