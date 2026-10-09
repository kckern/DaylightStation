import {HttpJamCorderSource} from "#adapters/jamcorder/HttpJamCorderSource.mjs";
import {FsJamCorderArchive} from '../adapters/jamcorder/FsJamCorderArchive.mjs';
import {HarvestMidiRecordings} from "#apps/midi/HarvestMidiRecordings.mjs";
import {JamCorderHarvester} from "#adapters/harvester/other/JamCorderHarvester.mjs";
export function registerPianoJamCorderHarvester({httpClient,registerHarvester,configService,logger}){
  if (httpClient) {
    registerHarvester('jamcorder', () => {
      // Recorder address comes from the device registry (hardware/devices.yml),
      // not an app config — it is a device, not an app.
      const host = configService?.getDeviceConfig?.('midi-recorder')?.host || '10.0.0.243';
      const source = new HttpJamCorderSource({ httpClient, host, logger });
      const archive = new FsJamCorderArchive({ configService, logger });
      const harvestUseCase = new HarvestMidiRecordings({ source, archive, logger });
      return new JamCorderHarvester({ harvestUseCase, logger });
    });
  }
}
