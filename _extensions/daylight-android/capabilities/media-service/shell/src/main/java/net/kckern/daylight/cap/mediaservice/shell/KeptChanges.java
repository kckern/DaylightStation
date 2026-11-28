package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * What a change to the kept list means for browsers (Android Auto, a browse client). The
 * kept node and the root (which carries the "On this phone" entry) are stale when a keep is
 * saved, becomes ready or is removed. Pure: the session call is {@link DaylightMediaService}'s.
 */
final class KeptChanges {
    static final String SAVED = "saved", READY = "ready", REMOVED = "removed";
    /** The payload's id for the kept list (MediaId.KEPT) and the library root. */
    static final String KEPT = "kept";

    private KeptChanges() { }

    /** The browse nodes a change makes stale; none for a change that is not one of the three. */
    static List<String> nodes(String change) {
        if (SAVED.equals(change) || READY.equals(change) || REMOVED.equals(change)) return Arrays.asList(KEPT, NodeItems.ROOT);
        return Collections.emptyList();
    }

    /**
     * What changed between two looks at the kept index: an item now listed ({@link #SAVED}),
     * one gone ({@link #REMOVED}), one now ready ({@link #READY}), or null. A null before is
     * the first look: nothing changed.
     */
    static String change(Set<String> listedBefore, Set<String> readyBefore, Set<String> listed, Set<String> ready) {
        if (listedBefore == null || readyBefore == null) return null;
        if (!listedBefore.containsAll(listed)) return SAVED;
        if (!listed.containsAll(listedBefore)) return REMOVED;
        if (!readyBefore.containsAll(ready)) return READY;
        return null;
    }

    /** Any named folder may be subscribed to: a parent nothing changes simply never calls back. */
    static boolean subscribable(String parentId) {
        return parentId != null && !parentId.isEmpty();
    }
}
