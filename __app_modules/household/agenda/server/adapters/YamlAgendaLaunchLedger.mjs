import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import yaml from "js-yaml";
import { readTextFromPath, saveYamlToPathAtomic } from "#system/utils/FileIO.mjs";
import { canonicalJson } from "../../../../../__capabilities/content-catalog/portable/participant-launch.mjs";
import { sha256Text } from "#system/utils/sha256.mjs";
const hashValue = (value) => sha256Text(canonicalJson(value));
import { AgendaWriteLanes } from "./AgendaWriteLanes.mjs";
const activityLanes = new AgendaWriteLanes();
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const clone = (value) => structuredClone(value);
const token = (value) => createHash("sha256").update(value).digest("hex");
function scope(value) {
  let v;
  try {
    v = JSON.parse(value);
  } catch {
    fail("invalid_scope", "Invalid scope");
  }
  if (!Array.isArray(v) || v.length !== 5 || v.some((x) => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(x)) || !["open", "play", "queue", "display"].includes(v[4]) || JSON.stringify(v) !== value) fail("invalid_scope", "Invalid scope");
  return v;
}
function receipt(record) {
  const { snapshot, result } = record;
  return { launch_id: snapshot.launch_id, consumer: clone(snapshot.consumer), setup_hash: snapshot.setup_hash, snapshot_hash: snapshot.snapshot_hash, ...result ? { result: clone(result), ...result.runtime_ref ? { runtime_ref: clone(result.runtime_ref) } : {} } : {} };
}
function orderedReceipts(document) {
  const records = Object.values(document.launches);
  const preferred = document.preferred_launch_id;
  if (preferred && !Object.hasOwn(document.launches, preferred)) fail("invalid_document", "Preferred launch is missing");
  records.sort((a, b) => Number(b.snapshot.launch_id === preferred) - Number(a.snapshot.launch_id === preferred));
  return records.map(receipt);
}
function verify(record, action) {
  const { snapshot, executionKey } = record ?? {};
  if (!snapshot || typeof executionKey !== "string" || snapshot.action !== action) fail("invalid_document", "Invalid launch record");
  const { snapshot_hash, ...value } = snapshot;
  if (hashValue(value) !== snapshot_hash) fail("invalid_document", "Launch snapshot corrupted");
  if (record.result && (record.result.launch_id !== snapshot.launch_id || record.result.snapshot_hash !== snapshot_hash || record.result.kind !== "ready" || hashValue(record.result.consumer) !== hashValue(snapshot.consumer) || hashValue(record.result.participant_context) !== hashValue(snapshot.participant_context))) fail("invalid_document", "Invalid launch result");
}
/** Atomic activity ledger for the single installed server authority. */
class YamlAgendaLaunchLedger {
  constructor({ repository, pathForHousehold, save = saveYamlToPathAtomic }) {
    if (!repository || typeof pathForHousehold !== "function") throw Error("Repository and household path required");
    Object.assign(this, { repository, pathForHousehold, save });
  }
  file(key) {
    const [householdId, , planId, itemUid, action] = scope(key);
    return path.join(this.pathForHousehold(householdId), "agendas", "runtime", planId, `${token(JSON.stringify([itemUid, action]))}.yml`);
  }
  read(key) {
    const [, , , , action] = scope(key);
    let doc;
    try {
      doc = yaml.load(readTextFromPath(this.file(key)));
    } catch (e) {
      if (e.code === "ENOENT") return { schema: "agenda-launch-ledger/v1", scope_key: key, requests: {}, launches: {} };
      throw e;
    }
    if (!doc || doc.schema !== "agenda-launch-ledger/v1" || doc.scope_key !== key || !doc.requests || !doc.launches) fail("invalid_document", "Invalid launch ledger");
    for (const [id, record] of Object.entries(doc.launches)) {
      verify(record, action);
      if (record.snapshot.launch_id !== id) fail("invalid_document", "Invalid launch identity");
    }
    return doc;
  }
  write(key, doc) {
    this.save(this.file(key), doc, { durable: true });
  }
  // All plan mutations use this same series lane; activity is always acquired second.
  async locked(key, fn) {
    const [householdId, seriesId] = scope(key);
    return this.repository.withSeriesLane(this.repository.laneKey(householdId, seriesId), () => activityLanes.withSeriesLane(key, fn));
  }
  async inspect(key, build) {
    return this.locked(key, async () => {
      const d = this.read(key);
      return build(orderedReceipts(d));
    });
  }
  async reserve({ scopeKey, requestId, requestDigest }, build) {
    if (typeof requestId !== "string" || !requestId.trim() || typeof requestDigest !== "string" || !requestDigest) fail("invalid_request", "Request identity required");
    return this.locked(scopeKey, async () => {
      const d = this.read(scopeKey);
      const k = token(requestId);
      // Admitted requests are checked before any live policy or preparation callback.
      const existing = d.requests[k];
      if (existing) {
        if (existing.digest !== requestDigest) fail("idempotency_conflict", "Request reused");
        const record2 = d.launches[existing.launch_id];
        if (!record2) fail("invalid_document", "Missing admitted launch");
        return { kind: "reserved", reused: true, snapshot: clone(record2.snapshot), executionKey: record2.executionKey, ...record2.result ? { result: clone(record2.result) } : {} };
      }
      const built = await build(orderedReceipts(d));
      if (built?.kind === "resume_available" || built?.kind === "passthrough") return built;
      let record;
      if (built?.reuse_launch_id) {
        record = Object.hasOwn(d.launches, built.reuse_launch_id) ? d.launches[built.reuse_launch_id] : null;
        if (!record || record.result || record.snapshot.setup_hash !== built.setup_hash) fail("invalid_reservation", "Pending launch unavailable");
      } else {
        const launchId = `al_${randomBytes(20).toString("hex")}`;
        const value = { ...clone(built.snapshot), launch_id: launchId };
        if (value.action !== scope(scopeKey)[4]) fail("invalid_reservation", "Wrong action");
        const snapshot = { ...value, snapshot_hash: hashValue(value) };
        record = { snapshot, executionKey: randomBytes(32).toString("hex"), provenance: clone(built.provenance) };
        d.launches[launchId] = record;
        d.preferred_launch_id = launchId;
      }
      // One durable replacement admits the snapshot, key, and request mapping together.
      d.requests[k] = { digest: requestDigest, launch_id: record.snapshot.launch_id };
      this.write(scopeKey, d);
      return { kind: "reserved", reused: !!built.reuse_launch_id, snapshot: clone(record.snapshot), executionKey: record.executionKey };
    });
  }
  async complete({ scopeKey, launchId, executionKey, snapshotHash, result }) {
    return this.locked(scopeKey, async () => {
      const d = this.read(scopeKey), record = Object.hasOwn(d.launches, launchId) ? d.launches[launchId] : null;
      if (!record || record.executionKey !== executionKey || record.snapshot.snapshot_hash !== snapshotHash) fail("invalid_reservation", "Reservation mismatch");
      const proposed = { ...record, result: clone(result) };
      verify(proposed, scope(scopeKey)[4]);
      if (record.result && hashValue(record.result) !== hashValue(result)) fail("idempotency_conflict", "Result changed");
      if (!record.result) {
        record.result = clone(result);
        this.write(scopeKey, d);
      }
      return clone(record.result);
    });
  }
  async readRetained({ scopeKey, launchId }) {
    return this.locked(scopeKey, async () => {
      const d = this.read(scopeKey), record = Object.hasOwn(d.launches, launchId) ? d.launches[launchId] : null;
      if (!record) return null;
      const target = record.provenance?.return_to;
      const [, seriesId, planId, itemUid] = scope(scopeKey);
      if (target && (target.kind !== "content" || target.content_id !== `agenda:${seriesId}/plans/${planId}` || target.item_uid !== itemUid || Object.keys(target).some((k) => !["kind", "content_id", "item_uid"].includes(k)))) fail("invalid_document", "Invalid return target");
      return { snapshot: clone(record.snapshot), receipt: receipt(record), ...target ? { return_to: clone(target) } : {}, ...record.provenance?.execution_metadata ? {execution_metadata: clone(record.provenance.execution_metadata)} : {} };
    });
  }
}
export {
  YamlAgendaLaunchLedger
};
