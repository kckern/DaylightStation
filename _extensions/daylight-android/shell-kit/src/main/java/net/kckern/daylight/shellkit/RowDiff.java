package net.kckern.daylight.shellkit;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What a refreshed list changes, row by row, keyed by content id: which rows go, which
 * are new, which changed and need their text updated, and whether nothing changed at all
 * (then nothing is redrawn). No Android; KeyedRows applies it to views.
 */
final class RowDiff {
    final List<String> removed = new ArrayList<>();
    final List<String> added = new ArrayList<>();
    final List<String> changed = new ArrayList<>();
    final boolean reordered;

    private RowDiff(boolean reordered) { this.reordered = reordered; }

    boolean same() { return removed.isEmpty() && added.isEmpty() && changed.isEmpty() && !reordered; }

    /**
     * @param shown    the keys on screen, in order, and their signatures
     * @param wanted   the keys of the new answer, in order, and their signatures
     */
    static RowDiff of(List<String> shownKeys, Map<String, String> shown, List<String> wantedKeys, Map<String, String> wanted) {
        Set<String> want = new HashSet<>(wantedKeys);
        List<String> keptOrder = new ArrayList<>();
        for (String k : shownKeys) if (want.contains(k)) keptOrder.add(k);
        List<String> wantedOld = new ArrayList<>();
        for (String k : wantedKeys) if (shown.containsKey(k)) wantedOld.add(k);
        RowDiff d = new RowDiff(!keptOrder.equals(wantedOld));
        for (String k : shownKeys) if (!want.contains(k)) d.removed.add(k);
        for (String k : wantedKeys) {
            if (!shown.containsKey(k)) d.added.add(k);
            else if (!String.valueOf(shown.get(k)).equals(String.valueOf(wanted.get(k)))) d.changed.add(k);
        }
        return d;
    }
}
