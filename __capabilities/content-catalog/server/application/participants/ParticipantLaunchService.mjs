import { validateParticipantLaunchRef } from "../../../portable/participant-launch.mjs";
import { ParticipantSetupResolver, hashValue } from "./ParticipantSetupResolver.mjs";
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const clone = (value) => structuredClone(value);
const refOf = (consumer) => ({ id: consumer.id, version: consumer.version });
const same = (a, b) => hashValue(a) === hashValue(b);
function validateReady(result, snapshot) {
  if (result?.schema !== "participant-launch-result/v1" || result.kind !== "ready" || result.launch_id !== snapshot.launch_id || result.snapshot_hash !== snapshot.snapshot_hash || !same(result.consumer, snapshot.consumer) || !same(result.participant_context, snapshot.participant_context) || !result.output?.schema || !Object.hasOwn(result.output, "data") || Object.hasOwn(result, "return_to")) fail("invalid_launch_result", "Invalid consumer result");
  hashValue(result);
  return result;
}
function verifySnapshot(snapshot, action) {
  if (!snapshot || snapshot.action !== action) fail("invalid_snapshot", "Launch scope mismatch");
  const { snapshot_hash, ...value } = snapshot;
  if (hashValue(value) !== snapshot_hash) fail("invalid_snapshot", "Launch snapshot corrupted");
}
function safeReturn(value) {
  if (value === void 0) return void 0;
  if (!value || value.kind !== "content" || typeof value.content_id !== "string" || /^(?:https?|javascript|data|file|ftp|wss?):/i.test(value.content_id) || !/^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_./:-]*$/.test(value.content_id) || value.item_uid !== void 0 && (typeof value.item_uid !== "string" || !value.item_uid) || Object.keys(value).some((k) => !["kind", "content_id", "item_uid"].includes(k))) fail("invalid_return_target", "Invalid return target");
  return clone(value);
}
class ParticipantLaunchService {
  constructor({ registry, providers = [], resolveDirectTarget, logger }) {
    if (!registry || typeof resolveDirectTarget !== "function" || !logger) throw Error("Registry, direct target resolver and logger required");
    this.registry = registry;
    this.providers = new Map(providers.map((p) => [p.id, p]));
    if (this.providers.size !== providers.length) throw Error("Duplicate provider");
    this.resolveDirectTarget = resolveDirectTarget;
    this.logger = logger;
    this.setupResolver = new ParticipantSetupResolver({ registry });
  }
  async access({ ref, target, action, viewer }, retained = false) {
    if (!["open", "play", "queue", "display"].includes(action) || !!ref === !!target) fail("invalid_participant_launch", "Exactly one source required");
    if (ref) {
      validateParticipantLaunchRef(ref);
      const provider = this.providers.get(ref.provider);
      if (!provider) fail("provider_unavailable", "Provider unavailable");
      const access = await provider.authorizeAccess(ref.ref, { viewer, action });
      if (!access?.store || typeof access.scope_key !== "string") fail("authorization_denied", "Scope unavailable");
      return { provider, access };
    }
    const factory = this.registry.retainedDirectAccess({ action, target });
    if (factory) {
      const access = await factory(target, { action, viewer });
      if (!access?.store || typeof access.scope_key !== "string") fail("authorization_denied", "Direct scope unavailable");
      return { target, access };
    }
    if (retained) fail("launch_not_found", "Direct store unavailable");
    const resolved = await this.resolveDirectTarget({ target, action, viewer });
    const consumer = this.registry.resolve({ action, target: resolved });
    if (!consumer) fail("consumer_unavailable", "Consumer unavailable");
    if (this.registry.directAccess(refOf(consumer))) fail("authorization_denied", "Direct target declaration mismatch");
    return { target: resolved, consumer, access: null, resolved: true };
  }
  async prepare(input, access, {validateReturn = false} = {}) {
    const source = access.provider ? await access.provider.resolve(input.ref.ref, { viewer: input.viewer }) : { action: input.action, target: access.resolved ? access.target : await this.resolveDirectTarget({ target: access.target, action: input.action, viewer: input.viewer }) };
    if (source.action !== input.action) fail("invalid_participant_launch", "Action mismatch");
    const returnTo = validateReturn ? safeReturn(source.returnTo) : undefined;
    const setup = await this.setupResolver.resolve({ resolvedSource: source, viewer: input.viewer });
    return { source, ...setup, returnTo };
  }
  async findChoices(receipts, viewer, participantIds = null) {
    // Newest first, decided here rather than by array position downstream: a store lists its
    // preferred (latest) launch first, then the rest oldest to newest.
    receipts = receipts.length ? [receipts[0], ...receipts.slice(1).reverse()] : receipts;
    const groups = new Map();
    for (const receipt of receipts) {
      const key = JSON.stringify(receipt.consumer);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(receipt);
    }
    const choices = [];
    for (const group of groups.values()) {
      const consumer = this.registry.get(group[0].consumer);
      if (!consumer?.findResumable) continue;
      const available = await consumer.findResumable({receipts: group, viewer, participantIds});
      const ids = new Set(group.map(receipt => receipt.launch_id));
      if (!Array.isArray(available) || available.some(choice => !ids.has(choice.launch_id))) {
        fail("invalid_launch_result", "Invalid resumable choices");
      }
      choices.push(...available);
    }
    return choices;
  }
  async describe({target, action, viewer}) {
    if (!["open", "play", "queue", "display"].includes(action) || !target || typeof target !== "object" || Array.isArray(target)) fail("invalid_participant_launch", "Action and target required");
    const resolved = await this.resolveDirectTarget({target, action, viewer});
    return this.registry.describe({action, target:resolved});
  }
  async inspect(input) {
    const access = await this.access(input);
    const build = async (receipts) => {
      const value = await this.prepare(input, access);
      if (!value.participantContext) return { schema: "participant-launch-options/v1", consumer: refOf(value.consumer), ready: true, confirmation: "none", passthrough: true, choices: [] };
      const choices = await this.findChoices(receipts, input.viewer, value.participantContext.participants.map(p => p.participant_id));
      return { schema: "participant-launch-options/v1", consumer: refOf(value.consumer), ready: true, setup_hash: value.setupHash, participant_summary: clone(value.participantContext.participants.map(({ key, display }) => ({ key, display }))), consumer_summary: clone(value.prepared.preview), confirmation: value.prepared.confirmation, choices };
    };
    return access.access ? access.access.store.inspect(access.access.scope_key, build) : build([]);
  }
  async begin(input) {
    if (typeof input.requestId !== "string" || !input.requestId.trim() || !["open", "new"].includes(input.intent)) fail("invalid_request", "Request ID and intent required");
    const access = await this.access(input);
    if (!access.access) {
      const value = await this.prepare(input, access);
      if (value.participantContext) fail("launch_store_unavailable", "Direct launch store required");
      return { schema: "participant-launch-result/v1", kind: "passthrough", action: input.action, target: clone(access.target) };
    }
    const { store, scope_key: scopeKey } = access.access;
    const requestDigest = hashValue({ ref: input.ref ?? null, target: input.target ?? null, action: input.action, intent: input.intent, expectedSetupHash: input.expectedSetupHash ?? null });
    // Store lookup precedes the callback, so retries retain their original inputs.
    const reservation = await store.reserve({ scopeKey, requestId: input.requestId, requestDigest }, async (receipts) => {
      const value = await this.prepare(input, access, {validateReturn:true});
      const returnTo = value.returnTo;
      if (!value.participantContext) return { schema: "participant-launch-result/v1", kind: "passthrough", action: input.action, target: clone(value.source.target) };
      if (value.prepared.confirmation === "required" && !input.expectedSetupHash || input.expectedSetupHash && input.expectedSetupHash !== value.setupHash) fail("setup_conflict", "Setup changed or confirmation required");
      if (input.intent === "open") {
        const pending = receipts.find((r) => !r.result && r.setup_hash === value.setupHash && same(r.consumer, refOf(value.consumer)));
        if (pending) return { reuse_launch_id: pending.launch_id, setup_hash: value.setupHash };
        const choices = await this.findChoices(receipts, input.viewer, value.participantContext.participants.map(p => p.participant_id));
        if (choices.length) return { schema: "participant-launch-result/v1", kind: "resume_available", consumer: refOf(value.consumer), current_setup_hash: value.setupHash, choices };
      }
      const providerProvenance = value.source.provenance ?? {};
      if (typeof providerProvenance !== "object" || Array.isArray(providerProvenance)) {
        fail("invalid_provenance", "Invalid provider provenance");
      }
      const provenance = clone(providerProvenance);
      delete provenance.return_to;
      delete provenance.execution_metadata;
      if (returnTo) provenance.return_to = returnTo;
      const sourceLabel = value.source.sourceLabel;
      if (sourceLabel !== undefined && (typeof sourceLabel !== 'string' || !sourceLabel.trim() || sourceLabel.length > 120 || /[\u0000-\u001f\u007f]/.test(sourceLabel))) fail('invalid_provenance','Invalid source label');
      if (input.ref) provenance.execution_metadata = {schema:'participant-execution-metadata/v1',source_ref:clone(input.ref),...(returnTo ? {return_to:clone(returnTo)} : {}),...(sourceLabel !== undefined ? {source_label:sourceLabel} : {})};
      // Validate that provider evidence is serializable before retention.
      hashValue(provenance);
      const frozen = hashValue(value.prepared);
      await value.consumer.retainPrepared?.({ prepared: value.prepared, viewer: input.viewer });
      if (hashValue(value.prepared) !== frozen) fail("prepared_artifact_unavailable", "Retention changed setup");
      return { snapshot: { schema: "participant-launch-snapshot/v1", consumer: refOf(value.consumer), action: input.action, target: clone(value.source.target), participant_context: clone(value.participantContext), prepared: clone(value.prepared), setup_hash: value.setupHash }, provenance };
    });
    if (reservation.kind === "resume_available" || reservation.kind === "passthrough") return reservation;
    const snapshot = reservation.snapshot;
    verifySnapshot(snapshot, input.action);
    const consumer = this.registry.get(snapshot.consumer);
    if (!consumer) fail("consumer_version_unavailable", "Retained consumer unavailable");
    // Retrieve the original admitted metadata, including on pending reuse or retry.
    const admitted = await store.readRetained({ scopeKey, launchId: snapshot.launch_id });
    if (!admitted) fail("launch_not_found", "Launch unavailable");
    const executionMetadata = admitted.execution_metadata;
    if (executionMetadata) {
      if (executionMetadata.schema !== 'participant-execution-metadata/v1' || Object.keys(executionMetadata).some(k => !['schema','source_ref','return_to','source_label'].includes(k))) fail('invalid_provenance','Invalid execution metadata');
      validateParticipantLaunchRef(executionMetadata.source_ref);
      if (executionMetadata.source_label !== undefined && (typeof executionMetadata.source_label !== 'string' || !executionMetadata.source_label.trim() || executionMetadata.source_label.length > 120 || /[\u0000-\u001f\u007f]/.test(executionMetadata.source_label))) fail('invalid_provenance','Invalid source label');
      if (!same(safeReturn(executionMetadata.return_to) ?? null, safeReturn(admitted.return_to) ?? null) || executionMetadata.source_ref.provider !== snapshot.participant_context?.scope?.provider) fail('invalid_provenance','Execution metadata does not match retained launch');
    }
    const result = reservation.result ?? await consumer.begin({ snapshot: clone(snapshot), executionKey: reservation.executionKey, ...(executionMetadata ? {executionMetadata:clone(executionMetadata)} : {}), viewer: input.viewer });
    validateReady(result, snapshot);
    const saved = reservation.result ?? await store.complete({ scopeKey, launchId: snapshot.launch_id, executionKey: reservation.executionKey, snapshotHash: snapshot.snapshot_hash, result });
    const retained = await store.readRetained({ scopeKey, launchId: snapshot.launch_id });
    if (!retained) fail("launch_not_found", "Launch unavailable");
    const returnTo = safeReturn(retained.return_to);
    this.logger.info?.("participant.launch.ready", { launchId: snapshot.launch_id, consumer: snapshot.consumer.id });
    return { ...clone(saved), ...returnTo ? { return_to: returnTo } : {} };
  }
  async resume(input) {
    if (typeof input.launchId !== "string" || !input.launchId) fail("invalid_request", "Launch ID required");
    const access = await this.access(input, true);
    const { store, scope_key: scopeKey } = access.access;
    const retained = await store.readRetained({ scopeKey, launchId: input.launchId });
    if (!retained) fail("launch_not_found", "Launch unavailable");
    const { snapshot, receipt } = retained;
    verifySnapshot(snapshot, input.action);
    if (snapshot.launch_id !== input.launchId || receipt?.launch_id !== input.launchId || receipt.snapshot_hash !== snapshot.snapshot_hash || !receipt.result) fail("runtime_unavailable", "Launch is not attached");
    const consumer = this.registry.get(snapshot.consumer);
    if (!consumer || typeof consumer.resume !== "function") fail("consumer_version_unavailable", "Retained consumer unavailable");
    const result = await consumer.resume({ snapshot: clone(snapshot), receipt: clone(receipt), viewer: input.viewer });
    validateReady(result, snapshot);
    const returnTo = safeReturn(retained.return_to);
    return { ...clone(result), ...returnTo ? { return_to: returnTo } : {} };
  }
}
export {
  ParticipantLaunchService
};
