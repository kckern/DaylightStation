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
  applyState(manifest) {
    if (!fileExists(this.manifestPath)) return null;
    const state = this.ownership.read();
    if (state.digest !== manifest.digest) fail('idempotency_conflict', 'Another migration is already admitted');
    return state;
  }
  async refreshFitness() {
    if (typeof this.reloadFitness !== 'function') fail('ownership_unavailable', 'Installed Fitness reload port required');
    const refreshed = await this.reloadFitness();
    if (!refreshed || JSON.stringify(refreshed) !== JSON.stringify(yaml.load(readTextFromPath(this.sourcePaths.fitnessGuests)))) fail('ownership_unavailable', 'Fitness cache reload failed');
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
  validateDestinationPaths(manifest) {
    // Recovery skips obsolete source content, never the installed path binding.
    for (const key of ['legacyList', 'gameDefaults', 'namedGuests', 'fitnessGuests']) {
      if (manifest.sources[key]?.path !== this.sourcePaths[key]) fail('invalid_manifest', 'Configured migration destination changed');
    }
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
      this.validateDestinationPaths(manifest);
      // Ownership is durable: recovery now retires legacy bytes, never re-installs identities.
      if (!['owned', 'retired'].includes(state?.phase)) {
        this.validateSources(manifest);
        this.checkSources(manifest, {
          allowOwnWrites: !!state
        });
      }
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
        await this.refreshFitness();
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
          if (migrationHash(raw(this.sourcePaths.legacyList)) !== manifest.sourceHashes.legacyList) fail('source_changed', 'Source changed: legacyList');
          deleteFileStrict(this.sourcePaths.legacyList, {
            durable: true
          });
        }
        state = await this.phase(state, 'retired');
      }
      return this.phase(state, 'complete');
    }));
  }
  backoutPath(manifest) {
    return path.join(`${this.manifestPath}.transactions`, manifest.digest, 'backout.json');
  }
  verifyBackout(manifest, planId, review, digest) {
    const {
      digest: actual,
      ...value
    } = review || {};
    if (!['abort', 'export'].includes(value.mode) || Object.keys(value.destinations || {}).sort().join() !== (value.mode === 'abort' ? 'fitnessGuests,namedGuests' : 'gameDefaults,legacyList')) fail('invalid_manifest', 'Invalid backout preconditions');
    if (!actual || digest !== actual || actual !== migrationHash(value) || value.schema !== 'agenda-backout-review/v1' || value.migrationDigest !== manifest.digest || value.householdId !== manifest.householdId || value.seriesId !== manifest.seriesId || value.planId !== planId) fail('invalid_manifest', 'Explicit reviewed backout digest and matching selection required');
  }
  destinationHashes(keys) {
    return Object.fromEntries(keys.map(key => {
      const data = raw(this.sourcePaths[key]);
      return [key, data ? migrationHash(data) : null];
    }));
  }
  async prepareBackout(manifest, planId, state, expectedReview = null) {
    this.validateDestinationPaths(manifest);
    if (state.digest !== manifest.digest) fail('idempotency_conflict', 'Migration digest mismatch');
    if (state.backoutPlanId && state.backoutPlanId !== planId) fail('idempotency_conflict', 'Backout selection changed');
    if (state.backoutHash) {
      const retained = JSON.parse(readTextFromPath(this.backoutPath(manifest)));
      this.verifyBackout(manifest, planId, retained, retained.digest);
      if (migrationHash(retained) !== state.backoutHash) fail('idempotency_conflict', 'Retained backout changed');
      return retained;
    }
    const abort = ['prepared', 'identities', 'installed'].includes(state.phase);
    if (!abort && state.phase !== 'complete') fail('migration_busy', 'Recover apply before backout');
    if (abort) for (const key of ['namedGuests', 'fitnessGuests']) {
      const data = raw(this.sourcePaths[key]);
      if (!data || ![manifest.sourceHashes[key], migrationHash(encoded(manifest.documents[key]))].includes(migrationHash(data))) fail('source_changed', `Cannot abort changed source: ${key}`);
    }
    let output = null,
      revision = null,
      etag = null;
    const destinations = this.destinationHashes(abort ? ['fitnessGuests', 'namedGuests'] : ['legacyList', 'gameDefaults']);
    if (!abort) {
      const saved = await this.repository.readPlanInSeries({
        householdId: manifest.householdId,
        seriesId: manifest.seriesId,
        planId
      });
      if (!saved) fail('not_found', 'Selected plan missing');
      if (expectedReview && (saved.etag !== expectedReview.etag || saved.document.revision !== expectedReview.revision)) fail('revision_conflict', 'Selected plan changed since backout review');
      revision = saved.document.revision;
      etag = saved.etag;
      const exported = exportLegacyPlan({
        plan: saved.document,
        originalRules: yaml.load(readTextFromPath(this.sourcePaths.gameDefaults)),
        originalRoster: yaml.load(bytes(manifest.sources.gameDefaults.base64).toString('utf8')).launch.participants,
        listCodec: this.repository.listCodec
      });
      output = {
        list: encoded(exported.list).toString('base64'),
        rules: encoded(exported.rules).toString('base64')
      };
    }
    const value = {
      schema: 'agenda-backout-review/v1',
      migrationDigest: manifest.digest,
      householdId: manifest.householdId,
      seriesId: manifest.seriesId,
      planId,
      mode: abort ? 'abort' : 'export',
      revision,
      etag,
      destinations,
      output
    };
    return {
      ...value,
      digest: migrationHash(value)
    };
  }
  async previewBackout(manifest, planId) {
    return this.repository.withSeriesLane(this.repository.laneKey(manifest.householdId, manifest.seriesId), () => this.prepareBackout(manifest, planId, this.ownership.read()));
  }
  async backout(manifest, planId, review, digest) {
    this.verifyBackout(manifest, planId, review, digest);
    return this.repository.withSeriesLane(this.repository.laneKey(manifest.householdId, manifest.seriesId), () => this.ownership.withTransition(async () => {
      let state = this.ownership.read();
      if (state.digest !== manifest.digest || state.backoutPlanId && state.backoutPlanId !== planId || state.backoutHash && state.backoutHash !== migrationHash(review)) fail('idempotency_conflict', 'Backout operation changed');
      if (['backed-out', 'aborted'].includes(state.phase)) return state;
      const admitted = !!state.backoutHash;
      if (!admitted && JSON.stringify(this.destinationHashes(Object.keys(review.destinations))) !== JSON.stringify(review.destinations)) fail('source_changed', 'Backout destinations changed since review');
      const current = await this.prepareBackout(manifest, planId, state, review);
      if (!admitted) {
        if (current.etag !== review.etag || current.revision !== review.revision) fail('revision_conflict', 'Selected plan changed since backout review');
        if (JSON.stringify(current.destinations) !== JSON.stringify(review.destinations)) fail('source_changed', 'Backout destinations changed since review');
        if (current.digest !== review.digest) fail('invalid_manifest', 'Backout export differs from reviewed preview');
        writePrivate(this.backoutPath(manifest), JSON.stringify(review, null, 2) + '\n');
        state = await this.phase({
          ...state,
          backoutPlanId: planId,
          backoutHash: migrationHash(review)
        }, review.mode === 'abort' ? 'aborting' : 'backout-prepared');
      }
      if (review.mode === 'abort') {
        for (const key of ['namedGuests', 'fitnessGuests']) {
          const data = raw(this.sourcePaths[key]);
          if (!data || ![manifest.sourceHashes[key], migrationHash(encoded(manifest.documents[key]))].includes(migrationHash(data))) fail('source_changed', `Cannot abort changed source: ${key}`);
        }
        // A restarted process may have booted with shared references. Refresh its
        // served cache successfully before removing any extracted identities.
        write(this.sourcePaths.fitnessGuests, bytes(manifest.sources.fitnessGuests.base64));
        await this.refreshFitness();
        await this.checkpoint('fitnessGuests-restored');
        write(this.sourcePaths.namedGuests, bytes(manifest.sources.namedGuests.base64));
        await this.checkpoint('namedGuests-restored');
        return this.phase(state, 'aborted');
      }
      const output = current.output;
      // Admitted retries may encounter either the reviewed destination or our exact
      // retained output after an interrupted write. Never overwrite a third value.
      for (const [key, field] of [['legacyList', 'list'], ['gameDefaults', 'rules']]) {
        const hash = this.destinationHashes([key])[key];
        if (![review.destinations[key], migrationHash(bytes(output[field]))].includes(hash)) fail('source_changed', `Backout destination changed: ${key}`);
      }
      if (state.phase === 'backout-prepared') {
        write(this.sourcePaths.legacyList, bytes(output.list));
        await this.checkpoint('backout-list-written');
        write(this.sourcePaths.gameDefaults, bytes(output.rules));
        await this.checkpoint('backout-rules-written');
        state = await this.phase(state, 'backout-exported');
      }
      return this.phase(state, 'backed-out');
    }));
  }
}
