const invalid = () => {
  throw Object.assign(new Error("Invalid Agenda launch reference"), { code: "invalid_participant_launch_ref" });
};
const safe = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
class AgendaLaunchRefCodec {
  encode({ householdId, planId, itemUid, revision, action, targetDigest }) {
    if (![householdId, planId, itemUid].every(safe) || !Number.isSafeInteger(revision) || revision < 0 || !["open", "play", "queue", "display"].includes(action) || !/^[a-f0-9]{64}$/.test(targetDigest)) return invalid();
    return `agl_${Buffer.from(JSON.stringify(["agenda-launch-ref/v1", householdId, planId, itemUid, revision, action, targetDigest])).toString("base64url")}`;
  }
  decode(ref) {
    if (typeof ref !== "string" || !/^agl_[A-Za-z0-9_-]+$/.test(ref) || ref.length > 2048) return invalid();
    let values;
    try {
      values = JSON.parse(Buffer.from(ref.slice(4), "base64url").toString("utf8"));
    } catch {
      return invalid();
    }
    if (!Array.isArray(values) || values.length !== 7 || values[0] !== "agenda-launch-ref/v1") return invalid();
    const [, householdId, planId, itemUid, revision, action, targetDigest] = values;
    const tuple = { householdId, planId, itemUid, revision, action, targetDigest };
    if (this.encode(tuple) !== ref) return invalid();
    return tuple;
  }
}
export {
  AgendaLaunchRefCodec
};
