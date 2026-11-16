import { readTextFromPath } from '#system/utils/FileIO.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AgendaResourceAliases } from '../AgendaResourceAliases.mjs';
const phases = new Set(['prepared', 'identities', 'installed', 'owned', 'retired', 'complete', 'backout-prepared', 'backout-exported', 'backed-out', 'aborting', 'aborted']);
const agendaPhases = new Set(['owned', 'retired', 'complete', 'backout-prepared', 'backout-exported']);
const fail = code => {
  throw Object.assign(Error('Migration ownership unavailable'), {
    code
  });
};
export function readOwnership(manifestPath, {
  householdId,
  aliases
}) {
  const value = JSON.parse(readTextFromPath(manifestPath));
  if (value?.schema !== 'agenda-migration-ownership/v1' || value.householdId !== householdId || !phases.has(value.phase) || !/^\w[\w.-]*$/.test(value.seriesId) || !/^\w[\w.-]*$/.test(value.planId) || !/^[a-f0-9]{64}$/.test(value.digest) || JSON.stringify(value.aliases) !== JSON.stringify(aliases) || aliases.some(a => a.canonicalContentId !== `agenda:${value.seriesId}`)) fail('ownership_unavailable');
  const {
    digest,
    ...review
  } = JSON.parse(readTextFromPath(path.join(`${manifestPath}.transactions`, value.digest, 'review.json')));
  if (digest !== value.digest || createHash('sha256').update(JSON.stringify(review)).digest('hex') !== digest || review.householdId !== householdId || review.seriesId !== value.seriesId || review.documents?.plan?.plan_id !== value.planId || JSON.stringify(review.aliases) !== JSON.stringify(aliases)) fail('ownership_unavailable');
  if (value.phase.startsWith('backout-') && (!/^[a-f0-9]{64}$/.test(value.backoutHash) || typeof value.backoutPlanId !== 'string')) fail('ownership_unavailable');
  return value;
}
/** One live adapter, injected into the one alias object used by reads and writes. */
export function createMigrationOwnership({
  manifestPath = null,
  aliases = [],
  householdId
}) {
  let transitioning = false;
  const read = () => readOwnership(manifestPath, {
    householdId,
    aliases
  });
  const resourceAliases = new AgendaResourceAliases({
    registrations: aliases,
    authority: () => manifestPath ? agendaPhases.has(read().phase) : false
  });
  const manages = seriesId => aliases.some(a => a.canonicalContentId === `agenda:${seriesId}`);
  return {
    aliases: resourceAliases,
    read,
    assertLegacyWritable({
      kind,
      id
    }) {
      if (!aliases.some(a => a.kind === kind && a.id === id)) return;
      if (transitioning) fail('migration_busy');
      if (resourceAliases.resolve({
        kind,
        id
      })) fail('resource_moved');
    },
    assertAgendaWritable({
      seriesId
    }) {
      if (manages(seriesId) && (!manifestPath || !['owned', 'retired', 'complete'].includes(read().phase))) fail('resource_moved');
    },
    assertSharedWritable() {
      if (transitioning) fail('migration_busy');
      if (manifestPath) {
        const phase = read().phase;
        if (phase.startsWith('backout-') || phase === 'aborting') fail('migration_busy');
      }
    },
    async withTransition(fn) {
      if (transitioning) fail('migration_busy');
      transitioning = true;
      try {
        return await fn();
      } finally {
        transitioning = false;
      }
    }
  };
}
