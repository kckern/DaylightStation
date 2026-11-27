package net.kckern.daylight.shellkit;

import java.util.ArrayList;
import java.util.List;

/** Which cached cover files to delete: the least recently used first, until the folder is under its budget. Pure. */
public final class DiskCovers {
    /** 48 MB: a few thousand covers at list size. */
    public static final long BUDGET_BYTES = 48L * 1024 * 1024;

    public static final class Entry {
        final String name;
        final long bytes, usedAt;
        public Entry(String name, long bytes, long usedAt) { this.name = name; this.bytes = bytes; this.usedAt = usedAt; }
    }

    private DiskCovers() { }

    public static List<String> evict(List<Entry> files, long budget) {
        List<String> out = new ArrayList<>();
        if (files == null) return out;
        long total = 0;
        List<Entry> sorted = new ArrayList<>(files);
        for (Entry e : sorted) total += e.bytes;
        sorted.sort((a, b) -> Long.compare(a.usedAt, b.usedAt));
        for (Entry e : sorted) {
            if (e.name.endsWith(".tmp")) { out.add(e.name); total -= e.bytes; continue; }
            if (total <= budget) continue;
            out.add(e.name);
            total -= e.bytes;
        }
        return out;
    }
}
