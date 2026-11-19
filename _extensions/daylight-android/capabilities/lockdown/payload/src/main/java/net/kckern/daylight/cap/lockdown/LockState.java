package net.kckern.daylight.cap.lockdown;

import org.json.JSONObject;

/**
 * Whether the kiosk is locked, and when an unlock ends. Pure Java; the wall clock is passed in.
 * Persisted as JSON so an unlock window survives a restart. Anything unreadable is locked.
 */
final class LockState {
    private boolean locked = true;
    private long unlockedAtMs;
    private long relockAtMs;

    static LockState parse(String json) {
        LockState s = new LockState();
        if (json == null) return s;
        try {
            JSONObject o = new JSONObject(json);
            if (!(o.opt("locked") instanceof Boolean) || o.getBoolean("locked")) return s;
            long unlockedAt = o.optLong("unlockedAtMs", 0);
            if (unlockedAt <= 0) return s;          // an unlock with no start time is not trusted
            s.locked = false;
            s.unlockedAtMs = unlockedAt;
            s.relockAtMs = Math.max(0, o.optLong("relockAtMs", 0));
        } catch (Exception e) {
            return new LockState();
        }
        return s;
    }

    synchronized String toJson() {
        try {
            return new JSONObject().put("locked", locked).put("unlockedAtMs", unlockedAtMs)
                    .put("relockAtMs", relockAtMs).toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    synchronized boolean locked() { return locked; }

    /** 0 when locked, or when the unlock has no end. */
    synchronized long relockAtMs() { return relockAtMs; }

    synchronized void lock() {
        locked = true;
        unlockedAtMs = 0;
        relockAtMs = 0;
    }

    /**
     * @param forMs  requested duration, or null when none was given
     * @param maxMs  ceiling and default; 0 means no ceiling
     * @return the wall-clock time of the automatic relock, or 0 for none
     */
    synchronized long unlock(long nowMs, Long forMs, long maxMs) {
        if (forMs != null && forMs <= 0) throw new IllegalArgumentException("forMs must be positive");
        long duration = forMs == null ? maxMs : (maxMs > 0 ? Math.min(forMs, maxMs) : forMs);
        locked = false;
        unlockedAtMs = nowMs;
        relockAtMs = duration > 0 ? nowMs + duration : 0;
        return relockAtMs;
    }

    /**
     * An unlock always has an end. An unlocked state with no relock time, or with one further
     * away than the ceiling allows (a stored state from another clock, or from a time when the
     * ceiling was longer), is locked. True when this call locked.
     */
    synchronized boolean enforceCeiling(long nowMs, long maxMs) {
        if (locked || maxMs <= 0) return false;
        if (relockAtMs > 0 && relockAtMs - nowMs <= maxMs) return false;
        lock();
        return true;
    }

    /** Call every tick. True when this call relocked. */
    synchronized boolean tick(long nowMs) {
        if (locked) return false;
        boolean ended = relockAtMs > 0 && nowMs >= relockAtMs;
        boolean clockWentBack = nowMs < unlockedAtMs;
        if (ended || clockWentBack) {
            lock();
            return true;
        }
        return false;
    }
}
