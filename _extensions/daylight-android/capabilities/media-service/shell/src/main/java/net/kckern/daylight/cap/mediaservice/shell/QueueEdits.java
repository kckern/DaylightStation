package net.kckern.daylight.cap.mediaservice.shell;

import java.util.ArrayList;
import java.util.List;

/** What the queue does with a controller's edit, so the session can tell controllers when it differs. Pure. */
final class QueueEdits {
    private QueueEdits() { }

    /** The indexes a controller's removal of [from, to) removes, last first; the item playing stays. */
    static List<Integer> removable(int from, int to, int nowIndex) {
        List<Integer> out = new ArrayList<>();
        for (int i = to - 1; i >= from; i--) if (i != nowIndex) out.add(i);
        return out;
    }

    /** Whether the removal asked for is exactly what is done (a controller's own copy then matches). */
    static boolean exact(int from, int to, int nowIndex) {
        return removable(from, to, nowIndex).size() == Math.max(0, to - from);
    }
}
