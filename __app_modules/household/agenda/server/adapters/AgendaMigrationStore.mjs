import path from 'node:path';
import yaml from 'js-yaml';
import { writeBinaryAtomic, readBinaryFromPath, readTextFromPath, fileExists, deleteFileStrict } from '#system/utils/FileIO.mjs';
import { migrationHash, exportLegacyPlan } from '../domain/migrationValues.mjs';
const fail = (code, message) => {
  throw Object.assign(Error(message), {
    code
  });
};
const bytes = value => Buffer.from(value, 'base64');
const raw = file => {
  try {
    return readBinaryFromPath(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};
const write = (file, value) => writeBinaryAtomic(file, Buffer.isBuffer(value) ? value : Buffer.from(value), {
  durable: true
});
const writePrivate = (file, value) => writeBinaryAtomic(file, Buffer.isBuffer(value) ? value : Buffer.from(value), {
  durable: true,
  mode: 0o600,
  directoryMode: 0o700
});
const encoded = value => Buffer.from(yaml.dump(value, {
  noRefs: true,
  lineWidth: -1
}));

/** Installed single-process transaction adapter. Paths are supplied by composition, never the request. */
export class AgendaMigrationStore {
  constructor(deps) {
    Object.assign(this, deps);
    this.checkpoint ??= () => {};
  }
  completedApply(manifest) {
    if (!fileExists(this.manifestPath)) return null;
    const state = this.ownership.read();
    if (state.digest !== manifest.digest) fail('idempotency_conflict', 'Another migration is already admitted');
    return state.phase === 'complete' ? state : null;
  }
  captureSources(paths = this.sourcePaths) {
    this.inventory?.();
    if (JSON.stringify(paths) !== JSON.stringify(this.sourcePaths)) fail('invalid_manifest', 'Configured source paths required');
    return Object.fromEntries(Object.entries(this.sourcePaths).map(([key, file]) => {
      const data = key === 'agendaConfig' ? raw(file) : readBinaryFromPath(file);
      return [key, {
        path: file,
        sha256: data ? migrationHash(data) : null,
        base64: data ? data.toString('base64') : null
      }];
    }));
  }
  readInputs(sources = this.captureSources()) {
    return Object.fromEntries(['legacyList', 'gameDefaults', 'namedGuests', 'fitnessGuests'].map(key => [key, yaml.load(bytes(sources[key].base64).toString('utf8'))]));
  }
  backupPath(manifest, key) {
    if (!Object.hasOwn(this.sourcePaths, key)) fail('invalid_manifest', 'Unknown backup key');
    return path.join(`${this.manifestPath}.transactions`, manifest.digest, 'backups', key);
  }
  validateSources(manifest) {
    this.inventory?.();
    if (Object.keys(manifest.sources).sort().join() !== Object.keys(this.sourcePaths).sort().join()) fail('invalid_manifest', 'Source inventory mismatch');
    for (const [key, file] of Object.entries(this.sourcePaths)) {
      const source = manifest.sources[key];
      const hash = key === 'agendaConfig' && source.base64 === null ? null : migrationHash(bytes(source.base64));
      if (source.path !== file || source.sha256 !== manifest.sourceHashes[key] || source.sha256 !== hash) fail('invalid_manifest', 'Source bytes or configured paths mismatch');
    }
  }
  checkSources(manifest, {
    allowOwnWrites = false,
    retired = false
  } = {}) {
    for (const [key, file] of Object.entries(this.sourcePaths)) {
      const current = raw(file);
      const hashes = [manifest.sourceHashes[key]];
      if (allowOwnWrites && ['namedGuests', 'fitnessGuests'].includes(key)) hashes.push(migrationHash(encoded(manifest.documents[key])));
      if (key === 'legacyList' && retired && current === null) continue;
      if (!hashes.includes(current ? migrationHash(current) : null)) fail('source_changed', `Source changed: ${key}`);
    }
  }
  async phase(state, phase) {
    const next = {
      ...state,
      phase
    };
    write(this.manifestPath, JSON.stringify(next, null, 2) + '\n');
    await this.checkpoint(phase);
    return next;
  }
  async apply(manifest, {
    assertCurrent = () => {}
  } = {}) {
    this.validateSources(manifest);
    const {
      householdId,
      seriesId
    } = manifest;
    return this.repository.withSeriesLane(this.repository.laneKey(householdId, seriesId), () => this.ownership.withTransition(async () => {
      let state = fileExists(this.manifestPath) ? this.ownership.read() : null;
      if (state && state.digest !== manifest.digest) fail('idempotency_conflict', 'Another migration is already admitted');
      if (['aborting', 'aborted'].includes(state?.phase)) fail('idempotency_conflict', 'Migration was aborted');
      if (state && ['complete', 'backout-prepared', 'backout-exported', 'backed-out'].includes(state.phase)) {
        if (state.phase !== 'complete') fail('idempotency_conflict', 'Migration is backing out');
        return state;
      }
      this.checkSources(manifest, {
        allowOwnWrites: !!state,
        retired: ['owned', 'retired'].includes(state?.phase)
      });
      if (!state) {
        assertCurrent();
        if (await this.repository.readSeries({
          householdId,
          seriesId
        })) fail('revision_conflict', 'Migration target already exists');
        for (const [key, source] of Object.entries(manifest.sources)) if (source.base64 !== null) writePrivate(this.backupPath(manifest, key), bytes(source.base64));
        writePrivate(path.join(`${this.manifestPath}.transactions`, manifest.digest, 'review.json'), JSON.stringify(manifest, null, 2) + '\n');
        state = await this.phase({
          schema: 'agenda-migration-ownership/v1',
          householdId,
          seriesId,
          planId: manifest.documents.plan.plan_id,
          digest: manifest.digest,
          aliases: manifest.aliases
        }, 'prepared');
      }
      if (state.phase === 'prepared') {
        write(this.sourcePaths.namedGuests, encoded(manifest.documents.namedGuests));
        await this.checkpoint('named-guests-written');
        write(this.sourcePaths.fitnessGuests, encoded(manifest.documents.fitnessGuests));
        await this.checkpoint('fitness-written');
        state = await this.phase(state, 'identities');
      }
      if (state.phase === 'identities') {
        await this.repository.installMigrationDocuments(manifest.documents);
        state = await this.phase(state, 'installed');
      }
      if (state.phase === 'installed') {
        this.checkSources(manifest, {
          allowOwnWrites: true
        });
        state = await this.phase(state, 'owned');
      }
      if (state.phase === 'owned') {
        if (fileExists(this.sourcePaths.legacyList)) {
          deleteFileStrict(this.sourcePaths.legacyList, {
            durable: true
          });
        }
        state = await this.phase(state, 'retired');
      }
      return this.phase(state, 'complete');
    }));
  }
  async backout(manifest, planId) {
    const admitted = this.ownership.read();
    if (admitted.digest !== manifest.digest) fail('idempotency_conflict', 'Migration digest mismatch');
    if (admitted.backoutPlanId && admitted.backoutPlanId !== planId) fail('idempotency_conflict', 'Backout selection changed');
    if (['backed-out', 'aborted'].includes(admitted.phase)) return admitted;
    this.validateSources(manifest);
    const {
      householdId,
      seriesId
    } = manifest;
    return this.repository.withSeriesLane(this.repository.laneKey(householdId, seriesId), () => this.ownership.withTransition(async () => {
      let state = this.ownership.read();
      if (state.digest !== manifest.digest) fail('idempotency_conflict', 'Migration digest mismatch');
      if (state.backoutPlanId && state.backoutPlanId !== planId) fail('idempotency_conflict', 'Backout selection changed');
      if (['backed-out', 'aborted'].includes(state.phase)) return state;
      if (['prepared', 'identities', 'installed', 'aborting'].includes(state.phase)) {
        for (const key of ['namedGuests', 'fitnessGuests']) {
          const current = raw(this.sourcePaths[key]);
          if (!current || ![manifest.sourceHashes[key], migrationHash(encoded(manifest.documents[key]))].includes(migrationHash(current))) fail('source_changed', `Cannot abort changed source: ${key}`);
        }
        state = await this.phase({
          ...state,
          backoutPlanId: planId
        }, 'aborting');
        // Restore inline Fitness identities before removing any newly shared guests.
        for (const key of ['fitnessGuests', 'namedGuests']) {
          write(this.sourcePaths[key], bytes(manifest.sources[key].base64));
          await this.checkpoint(`${key}-restored`);
        }
        return this.phase(state, 'aborted');
      }
      if (!['complete', 'backout-prepared', 'backout-exported'].includes(state.phase)) fail('migration_busy', 'Recover apply before backout');
      const exportPath = path.join(`${this.manifestPath}.transactions`, manifest.digest, 'backout.json');
      let output;
      if (state.phase === 'complete') {
        const saved = await this.repository.readPlanInSeries({
          householdId,
          seriesId,
          planId
        });
        if (!saved) fail('not_found', 'Selected plan missing');
        const plan = saved.document;
        const originalRules = yaml.load(readTextFromPath(this.sourcePaths.gameDefaults));
        const originalRoster = yaml.load(bytes(manifest.sources.gameDefaults.base64).toString('utf8')).launch.participants;
        const exported = exportLegacyPlan({
          plan,
          originalRules,
          originalRoster,
          listCodec: this.repository.listCodec
        });
        output = {
          planId,
          etag: saved.etag,
          list: encoded(exported.list).toString('base64'),
          rules: encoded(exported.rules).toString('base64')
        };
        writePrivate(exportPath, JSON.stringify(output, null, 2) + '\n');
        state = await this.phase({
          ...state,
          backoutPlanId: planId,
          backoutHash: migrationHash(output)
        }, 'backout-prepared');
      } else {
        output = JSON.parse(readTextFromPath(exportPath));
        if (output.planId !== planId || migrationHash(output) !== state.backoutHash) fail('idempotency_conflict', 'Backout selection or export changed');
      }
      if (state.phase === 'backout-prepared') {
        write(this.sourcePaths.legacyList, bytes(output.list));
        write(this.sourcePaths.gameDefaults, bytes(output.rules));
        state = await this.phase(state, 'backout-exported');
      }
      return this.phase(state, 'backed-out');
    }));
  }
}
