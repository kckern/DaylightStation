package net.kckern.daylight.cap.mediaservice;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The last answer for each browse level, in memory. A level asked for again within
 * the fresh time is served without a request; one that cannot be loaded is served from
 * the last answer, however old; one never loaded fails, because an empty shelf would
 * read as an empty library. Pure: time comes in with each call.
 */
final class BrowseCache {
    interface Loader { List<MediaNode> load() throws Exception; }

    private static final class Kept {
        final List<MediaNode> nodes;
        final long loadedAtMs;
        Kept(List<MediaNode> nodes, long loadedAtMs) { this.nodes = nodes; this.loadedAtMs = loadedAtMs; }
    }

    private final long freshMs;
    private final LinkedHashMap<String, Kept> entries;

    BrowseCache(final int capacity, long freshMs) {
        this.freshMs = freshMs;
        // Access order: the level used longest ago is the one dropped.
        this.entries = new LinkedHashMap<String, Kept>(16, 0.75f, true) {
            @Override protected boolean removeEldestEntry(Map.Entry<String, Kept> eldest) { return size() > capacity; }
        };
    }

    List<MediaNode> get(String key, long nowMs, Loader loader) throws Exception {
        Kept known;
        synchronized (this) { known = entries.get(key); }
        if (known != null && nowMs - known.loadedAtMs < freshMs && nowMs >= known.loadedAtMs) return known.nodes;
        List<MediaNode> loaded;
        try {
            loaded = Collections.unmodifiableList(new ArrayList<>(loader.load()));
        } catch (Exception unreachable) {
            if (known != null) return known.nodes;
            throw unreachable;
        }
        synchronized (this) { entries.put(key, new Kept(loaded, nowMs)); }
        return loaded;
    }

    synchronized int size() { return entries.size(); }

    synchronized void clear() { entries.clear(); }
}
