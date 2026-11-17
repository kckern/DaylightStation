import {loadYaml} from '#system/utils/FileIO.mjs';
/** Strict raw legacy reads: malformed state is a stop, never an implicit release. */
export function readLegacyStops({configService,householdId,load=loadYaml}){
  try{
    const fitness=load(`${configService.getHouseholdPath('fitness/log',householdId)}/emergency_lock.yml`);
    const shutdown=load(`${configService.getHouseholdPath('shutdown',householdId)}/lockdown.yml`);
    const invalidFitness=fitness!=null && (!Number.isFinite(fitness.lockedUntil) || !Number.isFinite(fitness.lockedAt) || fitness.lockedUntil<=fitness.lockedAt || typeof fitness.lockedBy!=='string' || !fitness.lockedBy);
    const until=Date.parse(shutdown?.locked_until),at=Date.parse(shutdown?.locked_at);
    const invalidShutdown=shutdown!=null && (!Number.isFinite(until) || !Number.isFinite(at) || until<=at || !Array.isArray(shutdown.targets));
    return {fitness,shutdown,invalid:!!(invalidFitness || invalidShutdown)};
  }catch{return {invalid:true};}
}
