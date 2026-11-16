import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/** One installed server is the write authority; revision checks are not multi-process CAS. */
export class YamlNamedGuestStore {
  constructor({ pathForHousehold }) {
    if (typeof pathForHousehold !== 'function') throw new Error('pathForHousehold is required');
    this.pathForHousehold = pathForHousehold;
  }
  read(householdId) {
    let document;
    try { document = readYamlFromPath(this.pathForHousehold(householdId)); }
    catch (error) { if (error.code === 'ENOENT') return { schema: 'named-guests/v1', revision: 0, guests: [] }; throw error; }
    if (document?.schema !== 'named-guests/v1' || !Number.isInteger(document.revision) || document.revision < 0 || !Array.isArray(document.guests)) throw new Error('Invalid named guest store');
    return document;
  }
  write(householdId, expectedRevision, guests) {
    const current = this.read(householdId);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) throw Object.assign(new Error('Named guest revision conflict'), {code:'revision_conflict'});
    const document = { schema: 'named-guests/v1', revision: current.revision + 1, guests };
    saveYamlToPathAtomic(this.pathForHousehold(householdId), document);
    return document;
  }
}
