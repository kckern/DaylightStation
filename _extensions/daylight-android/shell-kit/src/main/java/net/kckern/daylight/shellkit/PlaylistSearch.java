package net.kckern.daylight.shellkit;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The picker's list: playlists the household already uses come first, then the rest of
 * the full list, and a typed query keeps only titles that contain every word of it.
 */
public final class PlaylistSearch {
    private PlaylistSearch() {}

    /** Remembered playlists first (in the order given), then the catalog's others; no id twice. */
    public static List<PlaylistEntry> merge(List<PlaylistEntry> remembered, List<PlaylistEntry> catalog) {
        List<PlaylistEntry> merged = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (PlaylistEntry entry : remembered) if (!entry.id.isEmpty() && seen.add(entry.id)) merged.add(entry);
        for (PlaylistEntry entry : catalog) if (!entry.id.isEmpty() && seen.add(entry.id)) merged.add(entry);
        return merged;
    }

    public enum Sort {
        /** A to Z by title. */
        AZ("A–Z"),
        /** Most recently used or added first; never-used ones after, A to Z. */
        RECENT("Recent"),
        /** The order the source gave them in. */
        SOURCE("Source order");

        public final String label;
        Sort(String label) { this.label = label; }

        public Sort next() { return values()[(ordinal() + 1) % values().length]; }
    }

    /** Only the playlists from one source; an empty source name keeps everything. */
    public static List<PlaylistEntry> bySource(List<PlaylistEntry> entries, String source) {
        if (source == null || source.isEmpty()) return new ArrayList<>(entries);
        List<PlaylistEntry> out = new ArrayList<>();
        for (PlaylistEntry entry : entries) if (source.equals(entry.source)) out.add(entry);
        return out;
    }

    /** The distinct source names, in the order they first appear. */
    public static List<String> sources(List<PlaylistEntry> entries) {
        java.util.LinkedHashSet<String> names = new java.util.LinkedHashSet<>();
        for (PlaylistEntry entry : entries) if (!entry.source.isEmpty()) names.add(entry.source);
        return new ArrayList<>(names);
    }

    /** A new list in the requested order. {@code usedAt} gives the last-used time of an id, 0 when never. */
    public static List<PlaylistEntry> sort(List<PlaylistEntry> entries, Sort sort,
                                           java.util.function.ToLongFunction<String> usedAt) {
        List<PlaylistEntry> out = new ArrayList<>(entries);
        java.util.Comparator<PlaylistEntry> byTitle = (a, b) -> {
            int c = a.title.compareToIgnoreCase(b.title);
            return c != 0 ? c : a.id.compareTo(b.id);
        };
        if (sort == Sort.AZ) out.sort(byTitle);
        else if (sort == Sort.RECENT) {
            out.sort((a, b) -> {
                int c = Long.compare(usedAt.applyAsLong(b.id), usedAt.applyAsLong(a.id));
                return c != 0 ? c : byTitle.compare(a, b);
            });
        }
        return out;
    }

    /** Every word of the query must appear in the title, in any order, ignoring case. */
    public static List<PlaylistEntry> filter(List<PlaylistEntry> entries, String query) {
        String[] words = query == null ? new String[0] : query.trim().toLowerCase(Locale.ROOT).split("\\s+");
        List<PlaylistEntry> out = new ArrayList<>();
        for (PlaylistEntry entry : entries) {
            String title = entry.title.toLowerCase(Locale.ROOT);
            boolean all = true;
            for (String word : words) {
                if (!word.isEmpty() && !title.contains(word)) { all = false; break; }
            }
            if (all) out.add(entry);
        }
        return out;
    }
}
