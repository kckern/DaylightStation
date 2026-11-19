import {JsonSupervisionRepository,createLedgerWriterGate} from '../../../../../__app_modules/household/supervision/server/index.mjs';
import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { ShutdownState } from '#domains/shutdown/ShutdownState.mjs';

/** One deliberately hand-editable record; it is never deleted on expiry. */
export class YamlShutdownDatastore {
  #config; #load; #save;
  constructor({ configService, load = loadYaml, save = saveYamlToPathAtomic } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlShutdownDatastore: configService required');
    this.#config = configService; this.#load = load; this.#save = save;
  }
  /**
   * Who may write the incident ledger. `gateOptions` takes shutdown config's
   * `writer` block plus the runtime facts (environment, hostId, platform,
   * isDocker); keys left out are read from this process. See LedgerWriterGate.mjs.
   */
  incidentWriterGate(gateOptions={}){return createLedgerWriterGate({...gateOptions,ledger:'The shutdown incident ledger'});}
  incidentRepository({writerGate,...gateOptions}={}){
    return new JsonSupervisionRepository({path:`${this.#config.getHouseholdPath('shutdown')}/enforcement-incidents.json`,writerGate:writerGate??this.incidentWriterGate(gateOptions)});
  }
  path() { return `${this.#config.getHouseholdPath('shutdown')}/lockdown.yml`; }
  async read() {
    try {
      // loadYaml deliberately propagates a YAML parse failure.  A permissive
      // loader would turn malformed hand-edits into an unlocked kiosk.
      const raw = this.#load(this.path());
      if (!raw) return { state: null, invalid: false };
      return { state: new ShutdownState(raw), invalid: false };
    } catch (error) { return { state: null, invalid: true, error }; }
  }
  async save(state) {
    this.#save(this.path(), {
      schema_version: 1,
      locked_at: state.lockedAt,
      locked_until: state.lockedUntil,
      targets: state.targets,
      source: state.source,
    });
  }
}
