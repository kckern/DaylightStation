package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Region;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The queue screen's rows (spec §4), worked out from the model. Pure. Sections with
 * headers in play order: History (collapsed by default: "History · 12"), Now playing,
 * Queued by you (only when not empty), Next from &lt;source&gt;, Radio, then the end card.
 * A container added as one group is one row until opened; a book is one row.
 */
final class QueueRows {
    enum Kind { HEADER, ITEM, GROUP, BOOK, END }

    static final class Row {
        final Kind kind;
        final Region region;
        /** ITEM: its timeline index. GROUP and BOOK: the first index. HEADER: where the region starts. */
        final int index;
        /** GROUP and BOOK: how many items; HEADER: how many in the region. */
        final int count;
        final String text;
        final long group;

        Row(Kind kind, Region region, int index, int count, String text, long group) {
            this.kind = kind; this.region = region; this.index = index; this.count = count; this.text = text; this.group = group;
        }

        @Override public String toString() { return kind + ":" + region + ":" + index + (text.isEmpty() ? "" : ":" + text); }
    }

    private QueueRows() { }

    static <T> List<Row> build(QueueModel<T> m, boolean historyOpen, Set<Long> openGroups) {
        List<Row> rows = new ArrayList<>();
        if (m.size() == 0 || m.nowIndex() < 0) return rows;
        int history = m.historyCount();
        if (history > 0) {
            rows.add(new Row(Kind.HEADER, Region.HISTORY, 0, history, "History · " + history, 0));
            // Newest last, nearest Now playing, as it played.
            if (historyOpen) for (int i = 0; i < history; i++) rows.add(new Row(Kind.ITEM, Region.HISTORY, i, 1, "", 0));
        }
        int now = m.nowIndex();
        rows.add(new Row(Kind.HEADER, Region.NOW, now, 1, "Now playing", 0));
        if (m.sourceLong() && m.at(now).longForm) {
            // A book is one row: its parts are not rows (Chapters is on Now playing).
            int parts = 1 + m.count(Region.SOURCE);
            rows.add(new Row(Kind.BOOK, Region.NOW, now, parts, "", 0));
        } else {
            rows.add(new Row(Kind.ITEM, Region.NOW, now, 1, "", 0));
        }
        Region[] order = m.sourceLong() ? new Region[] { Region.SOURCE, Region.QUEUED, Region.RADIO }
                : new Region[] { Region.QUEUED, Region.SOURCE, Region.RADIO };
        for (Region r : order) {
            int s = m.start(r), n = m.count(r);
            if (n == 0) continue;
            if (r == Region.SOURCE && m.sourceLong()) continue;   // the book's other parts are in its row
            rows.add(new Row(Kind.HEADER, r, s, n, header(r, m.label(), n), 0));
            for (int i = s; i < s + n; i++) {
                QueueModel.Entry<T> e = m.at(i);
                if (e.group != 0 && !openGroups.contains(e.group)) {
                    int run = 1;
                    while (i + run < s + n && m.at(i + run).group == e.group) run++;
                    if (run > 1) {
                        rows.add(new Row(Kind.GROUP, r, i, run, e.groupLabel.isEmpty() ? run + " tracks"
                                : e.groupLabel + " · " + run + " tracks", e.group));
                        i += run - 1;
                        continue;
                    }
                }
                rows.add(new Row(Kind.ITEM, r, i, 1, "", e.group));
            }
        }
        rows.add(new Row(Kind.END, Region.RADIO, m.size(), 0, "", 0));
        return rows;
    }

    static String header(Region r, String label, int n) {
        switch (r) {
            case QUEUED: return "Queued by you";
            case SOURCE: return label == null || label.isEmpty() ? "Next" : "Next from " + label;
            case RADIO: return "Radio";
            default: return "";
        }
    }

    /** "2 h 48 min left", "34 min left". */
    static String left(long ms) {
        long min = Math.max(0, ms) / 60_000;
        if (min >= 60) return (min / 60) + " h " + (min % 60) + " min left";
        return Math.max(1, min) + " min left";
    }

    /** The snackbar's words for an add (spec §2). */
    static String added(boolean next, int position, int count, boolean started) {
        if (started) return count > 1 ? "Playing · " + count + " tracks" : "Added to the queue";
        if (next) return count > 1 ? "Plays next · " + count + " tracks" : "Plays next";
        return "Added to the queue · " + ordinal(position);
    }

    /** The snackbar's words for a new source: "Playing Snakes & Arrows · your 4 queued stay". */
    static String playing(String label, int kept) {
        String what = label == null || label.isEmpty() ? "Playing" : "Playing " + label;
        return kept > 0 ? what + " · your " + kept + " queued stay" : what;
    }

    static String ordinal(int n) {
        int mod100 = n % 100, mod10 = n % 10;
        String suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 == 1 ? "st" : mod10 == 2 ? "nd" : mod10 == 3 ? "rd" : "th";
        return String.format(Locale.ROOT, "%d%s", n, suffix);
    }

    /** "Queue 2026-11-26": Save as playlist's name, renamable in the sheet. */
    static String playlistName(java.util.Calendar day) {
        return String.format(Locale.ROOT, "Queue %04d-%02d-%02d", day.get(java.util.Calendar.YEAR),
                day.get(java.util.Calendar.MONTH) + 1, day.get(java.util.Calendar.DAY_OF_MONTH));
    }
}
