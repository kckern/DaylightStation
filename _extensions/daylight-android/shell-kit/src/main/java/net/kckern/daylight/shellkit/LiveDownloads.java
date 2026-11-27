package net.kckern.daylight.shellkit;

import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The in-memory channel for live download progress: the keep store publishes what is moving,
 * about once a second, and open screens read it and redraw. Never the kept index (written
 * every 5 s by the download manager, and reported to home). Listeners run on the publisher's
 * thread (the main thread).
 */
public final class LiveDownloads {
    private LiveDownloads() { }

    private static volatile Map<String, LiveDownload> now = Collections.emptyMap();
    private static final CopyOnWriteArrayList<Runnable> LISTENERS = new CopyOnWriteArrayList<>();

    /** Replaces what is live (by content id) and tells the listeners. */
    public static void publish(Map<String, LiveDownload> live) {
        now = new ConcurrentHashMap<>(live);
        for (Runnable r : LISTENERS) r.run();
    }

    /** The item's live line, or null when it is not downloading now. */
    public static LiveDownload get(String contentId) { return contentId == null ? null : now.get(contentId); }

    public static boolean any() { return !now.isEmpty(); }

    public static void listen(Runnable r) { LISTENERS.addIfAbsent(r); }

    public static void unlisten(Runnable r) { LISTENERS.remove(r); }

    /** For tests. */
    public static void clear() { now = Collections.emptyMap(); LISTENERS.clear(); }
}
