package net.kckern.daylight.cap.mediaservice.shell;

import java.util.ArrayList;
import java.util.Collection;
import java.util.function.Consumer;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Who follows which parent id. Media3 1.1.1 delivers a broadcast {@code notifyChildrenChanged}
 * to its own browsers but not to a legacy {@code MediaBrowserCompat} one (Android Auto): those
 * subscribe under a per-browser callback the broadcast does not match. So the callback keeps
 * its own book and tells each legacy browser directly. Main thread only (the session's).
 */
final class SubscriptionBook<T> {
    private final Map<String, Set<T>> byParent = new HashMap<>();

    void add(String parent, T who) {
        Set<T> set = byParent.get(parent);
        if (set == null) byParent.put(parent, set = new LinkedHashSet<>());
        set.add(who);
    }

    void remove(String parent, T who) {
        Set<T> set = byParent.get(parent);
        if (set == null) return;
        set.remove(who);
        if (set.isEmpty()) byParent.remove(parent);
    }

    void removeAll(T who) {
        for (String parent : new ArrayList<>(byParent.keySet())) remove(parent, who);
    }

    List<T> of(String parent) {
        Set<T> set = byParent.get(parent);
        return set == null ? new ArrayList<T>() : new ArrayList<>(set);
    }

    /**
     * Tells each follower of {@code parent} that is in {@code connected}, and forgets the ones
     * that are not (or that fail when told), so the book never depends on a disconnect callback.
     */
    void deliver(String parent, Collection<T> connected, Consumer<T> tell) {
        for (T who : of(parent)) {
            if (!connected.contains(who)) { removeAll(who); continue; }
            try {
                tell.accept(who);
            } catch (RuntimeException gone) {
                removeAll(who);
            }
        }
    }
}
