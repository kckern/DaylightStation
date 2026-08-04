import { createHash } from 'node:crypto';
import {
  Ti86SchoolCalcCodec,
  decodeTi86Acknowledgements,
  decodeTi86Envelope,
  decodeTi86InstalledState,
  decodeTi86SyncManifest,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  SCHOOLCALC_LOCAL_STATE_SLOTS,
  prepareSchoolCalcLocalStateSave,
  selectSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';
import {
  acknowledgeTi86QueueBatch,
} from './ti86-durable-queue.mjs';

export const TI86_SYNC_VARIABLES = Object.freeze({
  identity: 'DSID',
  catalogStage: 'DSCATNEW',
  acknowledgementStage: 'DSACKNEW',
  manifestStage: 'DSSYNC',
  catalogSlots: Object.freeze(['DSCAT0', 'DSCAT1']),
  installedStateSlots: Object.freeze(['DSINST0', 'DSINST1']),
  installedStateUplink: 'DSINST',
  queue: 'DSQ',
});

export class Ti86SyncCommitInterrupted extends Error {
  constructor({ mutation, label }) {
    super(`simulated power loss after mutation ${mutation} (${label})`);
    this.name = 'Ti86SyncCommitInterrupted';
    this.code = 'TI86_SYNC_COMMIT_INTERRUPTED';
    this.mutation = mutation;
    this.label = label;
  }
}

/**
 * Executable reference for the calculator-side staged-sync transaction.
 *
 * `variables` is mutated deliberately so tests can retain the exact state at
 * an injected power cut and call this function again to prove recovery. Every
 * staged record is validated before the first mutation. DSLOCAL is the commit
 * point selecting alternating Catalog and installed-state snapshots.
 */
export function commitTi86StagedSync(variables, { interruptAfterMutation = null } = {}) {
  if (!(variables instanceof Map)) throw new Error('TI-86 sync variables must be a Map');
  if (interruptAfterMutation !== null
      && (!Number.isInteger(interruptAfterMutation) || interruptAfterMutation < 1)) {
    throw new Error('interruptAfterMutation must be a positive integer');
  }

  const context = inspectStagedTransaction(variables);
  const trace = [];
  let mutationCount = 0;
  const mutate = (label, operation) => {
    operation();
    mutationCount += 1;
    trace.push(label);
    if (mutationCount === interruptAfterMutation) {
      throw new Ti86SyncCommitInterrupted({ mutation: mutationCount, label });
    }
  };
  const write = (name, bytes, label = `write:${name}`) => {
    const exact = Buffer.from(bytes);
    mutate(label, () => variables.set(name, exact));
    if (!variables.get(name)?.equals(exact)) throw new Error(`TI-86 readback failed for ${name}`);
  };
  const remove = (name, label = `delete:${name}`) => {
    if (!variables.has(name)) return;
    mutate(label, () => variables.delete(name));
  };

  if (!context.alreadyCommitted) {
    if (context.catalog.needsCommit) {
      const name = TI86_SYNC_VARIABLES.catalogSlots[context.catalog.targetSlot];
      write(name, context.catalog.bytes);
      validateCatalog(variables.get(name), context.identity.deviceId,
        context.manifest.catalogGenerationKey);
    }

    const installedName = TI86_SYNC_VARIABLES.installedStateSlots[context.installedTargetSlot];
    write(installedName, context.manifestBytes);
    const installedReadback = decodeTi86InstalledState(variables.get(installedName));
    if (installedReadback.generationKey !== context.manifest.generationKey) {
      throw new Error('TI-86 installed-state readback has the wrong generation');
    }

    if (context.queueDeleteAuthorized) {
      remove(TI86_SYNC_VARIABLES.queue, 'queue:delete-canonical');
    }

    const slotMask = SCHOOLCALC_LOCAL_FLAGS.catalogSlot1
      | SCHOOLCALC_LOCAL_FLAGS.installStateSlot1
      | SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent;
    const flags = (context.localSelection.state.flags & ~slotMask)
      | SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent
      | (context.catalog.resultSlot === 1 ? SCHOOLCALC_LOCAL_FLAGS.catalogSlot1 : 0)
      | (context.installedTargetSlot === 1 ? SCHOOLCALC_LOCAL_FLAGS.installStateSlot1 : 0);
    const localSave = prepareSchoolCalcLocalStateSave(context.localSelection, {
      flags,
      catalogGenerationKey: context.manifest.catalogGenerationKey,
    });
    write(localSave.targetSlot, localSave.bytes);
    const selected = selectSchoolCalcLocalState(localStateVariables(variables));
    if (selected.activeSlot !== localSave.targetSlot
        || selected.state.generation !== localSave.state.generation) {
      throw new Error('TI-86 local-state commit readback failed');
    }
  }

  // DSINST is a repairable relay-facing copy. The alternating slot selected by
  // SCL1 remains authoritative if power fails while this copy is replaced.
  if (!sameBytes(variables.get(TI86_SYNC_VARIABLES.installedStateUplink), context.manifestBytes)) {
    write(TI86_SYNC_VARIABLES.installedStateUplink, context.manifestBytes);
  }

  if (context.manifest.ready) {
    for (const removal of context.manifest.removals) remove(removal.variableName);
  }

  // Delete the commit marker last. If cleanup is interrupted before this, a
  // retry recognizes the already-selected installed snapshot and resumes only
  // the idempotent post-commit cleanup.
  remove(TI86_SYNC_VARIABLES.catalogStage);
  remove(TI86_SYNC_VARIABLES.acknowledgementStage);
  remove(TI86_SYNC_VARIABLES.manifestStage);

  return Object.freeze({
    committed: true,
    alreadyCommitted: context.alreadyCommitted,
    generation: context.manifest.generationKey,
    installedArtifactIds: context.installed.installedArtifacts.map((entry) => entry.artifactId),
    mutationCount,
    trace: Object.freeze(trace),
  });
}

/** Inspect the durable committed snapshot selected by SCL1. */
export function inspectTi86CommittedSync(variables) {
  if (!(variables instanceof Map)) throw new Error('TI-86 sync variables must be a Map');
  const localSelection = selectSchoolCalcLocalState(localStateVariables(variables));
  const state = localSelection.state;
  if (!(state.flags & SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent)) {
    return Object.freeze({ localSelection, catalog: null, installed: null });
  }
  const catalogSlot = state.flags & SCHOOLCALC_LOCAL_FLAGS.catalogSlot1 ? 1 : 0;
  const installedSlot = state.flags & SCHOOLCALC_LOCAL_FLAGS.installStateSlot1 ? 1 : 0;
  const installedBytes = requiredBytes(variables,
    TI86_SYNC_VARIABLES.installedStateSlots[installedSlot]);
  const installed = decodeTi86InstalledState(installedBytes);
  const catalogBytes = requiredBytes(variables, TI86_SYNC_VARIABLES.catalogSlots[catalogSlot]);
  const catalog = validateCatalog(catalogBytes, installed.deviceId,
    installed.catalogGenerationKey);
  if (state.catalogGenerationKey !== installed.catalogGenerationKey) {
    throw new Error('SCL1 and installed-state Catalog generations disagree');
  }
  validateInstalledArtifacts(variables, installed.installedArtifacts);
  return Object.freeze({
    localSelection,
    catalog: Object.freeze({ slot: catalogSlot, bytes: Buffer.from(catalogBytes), value: catalog }),
    installed: Object.freeze({ slot: installedSlot, bytes: Buffer.from(installedBytes), value: installed }),
  });
}

function inspectStagedTransaction(variables) {
  const identityBytes = requiredBytes(variables, TI86_SYNC_VARIABLES.identity);
  const codec = new Ti86SchoolCalcCodec();
  const identity = codec.decodeDeviceIdentity(identityBytes);
  const manifestBytes = requiredBytes(variables, TI86_SYNC_VARIABLES.manifestStage);
  const installed = decodeTi86InstalledState(manifestBytes);
  const manifest = decodeTi86SyncManifest(manifestBytes);
  if (manifest.deviceId !== identity.deviceId) {
    throw new Error('DSSYNC belongs to another calculator identity');
  }
  if (typeof manifest.ready !== 'boolean'
      || !Array.isArray(manifest.removals)
      || !Array.isArray(manifest.acknowledgedSequences)) {
    throw new Error('DSSYNC transaction fields are invalid');
  }
  validateManifestSets(manifest, installed);
  if (!manifest.ready) throw new Error('DSSYNC plan is blocked; no calculator state was changed');

  const localSelection = selectSchoolCalcLocalState(localStateVariables(variables));
  const committed = inspectCommittedIfPresent(variables, localSelection, identity.deviceId);
  const alreadyCommitted = committed?.installed.generationKey === manifest.generationKey;

  if (alreadyCommitted) {
    validateInstalledArtifacts(variables, installed.installedArtifacts);
    return {
      identity, manifest, manifestBytes: Buffer.from(manifestBytes), installed,
      localSelection, alreadyCommitted: true,
      catalog: { needsCommit: false, resultSlot: committed.catalogSlot },
      installedTargetSlot: committed.installedSlot,
      acknowledgementBytes: variables.get(TI86_SYNC_VARIABLES.acknowledgementStage) ?? null,
      queueDeleteAuthorized: false,
    };
  }

  const activeCatalogSlot = committed?.catalogSlot ?? null;
  const currentCatalogMatches = committed?.installed.catalogGenerationKey
    === manifest.catalogGenerationKey;
  let catalogBytes;
  let catalogResultSlot;
  let catalogNeedsCommit;
  if (currentCatalogMatches) {
    catalogBytes = committed.catalogBytes;
    catalogResultSlot = activeCatalogSlot;
    catalogNeedsCommit = false;
  } else {
    catalogBytes = requiredBytes(variables, TI86_SYNC_VARIABLES.catalogStage);
    validateCatalog(catalogBytes, identity.deviceId,
      manifest.catalogGenerationKey);
    catalogResultSlot = activeCatalogSlot === null ? 0 : activeCatalogSlot ^ 1;
    catalogNeedsCommit = true;
  }

  validateInstalledArtifacts(variables, installed.installedArtifacts);
  const acknowledgementBytes = requiredBytes(variables,
    TI86_SYNC_VARIABLES.acknowledgementStage);
  validateAcknowledgement(acknowledgementBytes, manifest, identity.deviceId);
  const queue = variables.get(TI86_SYNC_VARIABLES.queue) ?? null;
  const queueDeleteAuthorized = queue !== null
    && acknowledgeTi86QueueBatch(queue, acknowledgementBytes) === null;

  return {
    identity, manifest, manifestBytes: Buffer.from(manifestBytes), installed,
    localSelection, alreadyCommitted: false,
    catalog: {
      bytes: Buffer.from(catalogBytes),
      needsCommit: catalogNeedsCommit,
      resultSlot: catalogResultSlot,
      targetSlot: catalogResultSlot,
    },
    installedTargetSlot: committed === null ? 0 : committed.installedSlot ^ 1,
    acknowledgementBytes: Buffer.from(acknowledgementBytes),
    queueDeleteAuthorized,
  };
}

function inspectCommittedIfPresent(variables, localSelection, deviceId) {
  const state = localSelection.state;
  if (!(state.flags & SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent)) return null;
  const catalogSlot = state.flags & SCHOOLCALC_LOCAL_FLAGS.catalogSlot1 ? 1 : 0;
  const installedSlot = state.flags & SCHOOLCALC_LOCAL_FLAGS.installStateSlot1 ? 1 : 0;
  const installedBytes = requiredBytes(variables,
    TI86_SYNC_VARIABLES.installedStateSlots[installedSlot]);
  const installed = decodeTi86InstalledState(installedBytes);
  if (installed.deviceId !== deviceId || installed.catalogGenerationKey !== state.catalogGenerationKey) {
    throw new Error('SCL1 points to an installed snapshot for another state');
  }
  const catalogBytes = requiredBytes(variables, TI86_SYNC_VARIABLES.catalogSlots[catalogSlot]);
  validateCatalog(catalogBytes, deviceId, installed.catalogGenerationKey);
  return { installed, installedBytes, installedSlot, catalogBytes, catalogSlot };
}

function validateManifestSets(manifest, installed) {
  const installedById = new Map(installed.installedArtifacts
    .map((artifact) => [artifact.artifactId, artifact]));
  const removalIds = new Set();
  for (const removal of manifest.removals) {
    if (typeof removal?.artifactId !== 'string' || typeof removal?.variableName !== 'string') {
      throw new Error('DSSYNC removal metadata is invalid');
    }
    if (removalIds.has(removal.artifactId)) throw new Error('DSSYNC repeats a removal');
    removalIds.add(removal.artifactId);
    if (manifest.ready && installedById.has(removal.artifactId)) {
      throw new Error('DSSYNC removes an artifact retained by its installed snapshot');
    }
  }
  if (!manifest.ready) return;
}

function validateInstalledArtifacts(variables, artifacts) {
  for (const artifact of artifacts) {
    const bytes = requiredBytes(variables, artifact.variableName);
    if (bytes.length !== artifact.byteLength
        || createHash('sha256').update(bytes).digest('hex') !== artifact.byteDigest) {
      throw new Error(`installed artifact ${artifact.artifactId} does not match DSSYNC`);
    }
    const payload = decodeTi86Envelope(bytes, 'SCP1');
    if (payload?.schema !== 'school.calc.ti86-package/v2'
        || payload.artifactId !== artifact.artifactId) {
      throw new Error(`installed artifact ${artifact.artifactId} has invalid package identity`);
    }
  }
}

function validateCatalog(bytes, deviceId, generationKey) {
  const catalog = decodeTi86Envelope(bytes, 'SCC1');
  if (catalog?.schema !== 'school.calc.catalog-projection/v1'
      || catalog.deviceId !== deviceId
      || catalog.generationKey !== generationKey) {
    throw new Error('SCC1 does not match the committed sync generation');
  }
  return catalog;
}

function validateAcknowledgement(bytes, manifest, deviceId) {
  const acknowledgement = decodeTi86Acknowledgements(bytes);
  if (acknowledgement.deviceId !== deviceId
      || !sameNumbers(acknowledgement.sequences, manifest.acknowledgedSequences)) {
    throw new Error('DSACKNEW does not match DSSYNC');
  }
}

function localStateVariables(variables) {
  return Object.fromEntries(SCHOOLCALC_LOCAL_STATE_SLOTS
    .map((name) => [name, variables.get(name) ?? null]));
}

function requiredBytes(variables, name) {
  const value = variables.get(name);
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new Error(`required TI-86 variable ${name} is missing`);
  }
  return Buffer.isBuffer(value)
    ? value
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sameBytes(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return Buffer.from(left).equals(Buffer.from(right));
}

function sameNumbers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default commitTi86StagedSync;
