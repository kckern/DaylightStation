package net.kckern.daylight.shellkit;

/**
 * Drops a second tap that would start the same thing again: the same id within
 * {@link #WINDOW_MS} of the last start, or while that start is still in flight (its
 * player connecting). A quick double tap on Play or a home card otherwise starts two
 * playbacks and opens Now playing twice. A different id always goes through. Pure;
 * touched on the main thread only.
 */
public final class TapGuard {
    public static final long WINDOW_MS = 1_000;

    private final long windowMs;
    private String lastId;
    private long lastAt;
    private boolean inFlight;

    public TapGuard() { this(WINDOW_MS); }

    public TapGuard(long windowMs) { this.windowMs = windowMs; }

    /** True when this tap starts {@code id}; it is then the start in flight. */
    public boolean admit(String id, long nowMs) {
        String key = id == null ? "" : id;
        if (key.equals(lastId) && (inFlight || nowMs - lastAt < windowMs)) return false;
        lastId = key;
        lastAt = nowMs;
        inFlight = true;
        return true;
    }

    /** The start reached the player (or failed): only the window holds a repeat now. */
    public void done() { inFlight = false; }
}
