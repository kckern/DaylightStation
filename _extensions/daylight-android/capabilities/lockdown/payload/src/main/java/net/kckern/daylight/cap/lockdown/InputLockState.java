package net.kckern.daylight.cap.lockdown;

import org.json.JSONObject;

/**
 * The server-commanded input lock (portal-keys called it "lockdown"): while it is
 * active the volume keys do nothing. Pure Java; the wall clock is passed in. The
 * ordering rules are LockdownCommand's, unchanged: a stop and its release carry
 * revisions, and an older or conflicting command is refused.
 */
final class InputLockState {
    /** 0 = not locked; Long.MAX_VALUE = locked until released. */
    private long until;
    private long revision;
    private boolean durable;

    /** No stored state is unlocked. A stored state that cannot be read is locked until released. */
    static InputLockState parse(String json) {
        InputLockState s = new InputLockState();
        if (json == null) return s;
        try {
            JSONObject o = new JSONObject(json);
            if (!(o.opt("until") instanceof Number) || !(o.opt("revision") instanceof Number)) throw new IllegalArgumentException();
            long until = o.getLong("until"), revision = o.getLong("revision");
            if (until < 0 || revision < 0) throw new IllegalArgumentException();
            s.until = until;
            s.revision = revision;
            s.durable = true;
        } catch (Exception e) {
            s.until = Long.MAX_VALUE;
            s.revision = 0;         // so any well-formed release can clear it
        }
        return s;
    }

    synchronized String toJson() {
        try { return new JSONObject().put("until", until).put("revision", revision).toString(); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    synchronized boolean active(long nowMs) { return until == Long.MAX_VALUE || until > nowMs; }

    synchronized long revision() { return revision; }

    synchronized long until() { return until; }

    synchronized boolean alreadyStored(LockdownCommand command) {
        return durable && until == command.deadline() && revision == (command.revision == null ? 0 : command.revision);
    }

    synchronized void markStored() { durable = true; }

    /** False when the command is stale or conflicts with what is stored; nothing changes then. */
    synchronized boolean apply(LockdownCommand command) {
        if (!command.canApply(revision, until)) return false;
        durable = false;
        until = command.deadline();
        if (command.revision != null) revision = command.revision;
        return true;
    }
}
