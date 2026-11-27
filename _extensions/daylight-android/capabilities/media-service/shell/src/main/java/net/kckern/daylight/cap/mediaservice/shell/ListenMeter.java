package net.kckern.daylight.cap.mediaservice.shell;

/**
 * Minutes heard per long item on this phone, over every sitting (spec §3.10's trigger). Only
 * time actually playing counts, against a monotonic clock (never the wall clock), and one
 * step is capped so a stalled tick or a sleeping process never adds an hour at once. Pure:
 * the totals live in a {@link Store} (SharedPreferences in the app, a map in tests).
 */
final class ListenMeter {
    /** One step adds at most this much (ticks come every 30 s while playing). */
    static final long MAX_STEP_MS = 5 * 60_000L;

    interface Store {
        long heardMs(String key);
        void setHeardMs(String key, long ms);
    }

    private final Store store;
    private String key;
    private long since = -1;

    ListenMeter(Store store) { this.store = store; }

    /** Playing {@code key} from {@code now} (what played before is counted first). */
    void play(String key, long now) {
        pause(now);
        this.key = key;
        since = now;
    }

    /** Stopped (paused, an error, another item): the time since the last step is counted. */
    void pause(long now) {
        step(now);
        since = -1;
    }

    /** Counts the time since the last step while playing; answers the total for the item playing (0 when none). */
    long step(long now) {
        if (key == null) return 0;
        if (since >= 0 && now > since) {
            long add = Math.min(MAX_STEP_MS, now - since);
            store.setHeardMs(key, store.heardMs(key) + add);
        }
        if (since >= 0) since = now;
        return store.heardMs(key);
    }

    String key() { return key; }

    boolean playing() { return since >= 0; }
}
