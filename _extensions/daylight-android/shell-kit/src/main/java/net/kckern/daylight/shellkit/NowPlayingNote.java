package net.kckern.daylight.shellkit;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * What is playing, and where, for the app's own screens: the phone's home shows it as a
 * mini player (cover, title, artist and where, a progress line, play/pause and next) that
 * opens Now playing. The two media services write it (this phone's, and the screen
 * remote's), each for its own target, and hand over a {@link Transport} for the buttons;
 * the one playing wins (the newer if both are). A target that stops clears its entry. In
 * process only: nothing is stored or sent.
 */
public final class NowPlayingNote {
    /** The buttons, run on the service's own player. Called on the main thread. */
    public interface Transport {
        void playPause();
        void next();
    }

    /** One target's state. {@code target} is "local" or a device id. */
    public static final class Entry {
        public final String target, targetName, title, artist, artworkUrl;
        public final boolean playing, canNext;
        /** The position at {@code reportedAt} (elapsedRealtime); -1 duration when unknown. */
        public final long positionMs, durationMs, reportedAt;
        public final Transport transport;
        /** Tapped and not playing yet: the mini player says "Starting…" with what was tapped. */
        public final boolean starting;
        /** A book's chapter title when known, shown in place of the by-line; "" for none. */
        public final String detail;
        final long at;

        public Entry(String target, String targetName, String title, String artist, String artworkUrl,
                     boolean playing, boolean canNext, long positionMs, long durationMs, long reportedAt,
                     Transport transport) {
            this(target, targetName, title, artist, artworkUrl, playing, canNext, positionMs, durationMs, reportedAt, transport, false, "");
        }

        public Entry(String target, String targetName, String title, String artist, String artworkUrl,
                     boolean playing, boolean canNext, long positionMs, long durationMs, long reportedAt,
                     Transport transport, boolean starting, String detail) {
            this.starting = starting;
            this.detail = detail == null ? "" : detail;
            this.target = target;
            this.targetName = targetName == null ? "" : targetName;
            this.title = title == null ? "" : title;
            this.artist = artist == null ? "" : artist;
            this.artworkUrl = artworkUrl == null ? "" : artworkUrl;
            this.playing = playing;
            this.canNext = canNext;
            this.positionMs = positionMs;
            this.durationMs = durationMs;
            this.reportedAt = reportedAt;
            this.transport = transport;
            this.at = reportedAt;
        }

        /** Where the track is at {@code now}, carried forward while playing. */
        public long positionAt(long now) {
            long p = positionMs + (playing ? Math.max(0, now - reportedAt) : 0);
            return durationMs > 0 ? Math.min(p, durationMs) : p;
        }

        /** 0..1 through the track at {@code now}, or -1 when the length is unknown. */
        public float fractionAt(long now) {
            return durationMs > 0 ? positionAt(now) / (float) durationMs : -1f;
        }
    }

    public interface Listener { void changed(); }

    private static volatile Entry local, remote;
    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    private NowPlayingNote() { }

    /** A service's report. An entry with an empty title means nothing is loaded there: it goes. */
    public static void report(Entry e) {
        if (e == null) return;
        Entry before = "local".equals(e.target) ? local : remote;
        // A chapter line stays with its item across the service's reports (which do not know it).
        if (!e.starting && e.detail.isEmpty() && before != null && !before.detail.isEmpty() && before.title.equals(e.title)) {
            e = new Entry(e.target, e.targetName, e.title, e.artist, e.artworkUrl, e.playing, e.canNext, e.positionMs, e.durationMs,
                    e.reportedAt, e.transport, false, before.detail);
        }
        Entry next = e.title.isEmpty() ? null : e;
        if (same(before, next)) return;
        if ("local".equals(e.target)) local = next; else remote = next;
        for (Listener l : listeners) l.changed();
    }

    /** Shorthand for a report without detail (and for clearing: an empty title). */
    public static void update(String target, String targetName, String title, boolean playing, long now) {
        report(new Entry(target, targetName, title, "", "", playing, false, 0, -1, now, null));
    }

    /**
     * The item just tapped, before its player holds it (Now playing closed while it starts):
     * the mini player shows it with "Starting…". The service's first report replaces it.
     */
    public static void starting(String target, String targetName, String title, String artist, String artworkUrl, long now) {
        Entry before = "local".equals(target) ? local : remote;
        // A player already reporting this item is newer than the tap.
        if (before != null && !before.starting && before.title.equalsIgnoreCase(title == null ? "" : title)) return;
        report(new Entry(target, targetName, title, artist, artworkUrl, false, false, 0, -1, now, null, true, ""));
    }

    /** A book's chapter title for {@code target}'s current item (Now playing knows it): the mini player's second line. */
    public static void detail(String target, String chapter) {
        Entry e = "local".equals(target) ? local : remote;
        String c = chapter == null ? "" : chapter;
        if (e == null || e.detail.equals(c)) return;
        report(new Entry(e.target, e.targetName, e.title, e.artist, e.artworkUrl, e.playing, e.canNext, e.positionMs, e.durationMs,
                e.reportedAt, e.transport, e.starting, c));
    }

    /** What the strip shows: the one playing (the newer, if both are), else the newer paused one; null for none. */
    public static Entry current() {
        Entry a = local, b = remote;
        if (a == null) return b;
        if (b == null) return a;
        if (a.playing != b.playing) return a.playing ? a : b;
        return a.at >= b.at ? a : b;
    }

    /**
     * The entry for one target, whichever is newer (audit H5): a notification tap for this
     * phone opens on this phone's entry even when a screen's is newer. Null when none.
     */
    public static Entry forTarget(String target) {
        if (target == null) return null;
        if ("local".equals(target)) return local;
        Entry r = remote;
        return r != null && target.equals(r.target) ? r : null;
    }

    public static void listen(Listener l) { listeners.addIfAbsent(l); }

    public static void unlisten(Listener l) { listeners.remove(l); }

    static void clearForTests() { local = null; remote = null; listeners.clear(); }

    /** Same as far as the strip is concerned. Position is carried forward, so a report that only moved it is not news. */
    private static boolean same(Entry a, Entry b) {
        if (a == null || b == null) return a == b;
        if (!(a.target.equals(b.target) && a.title.equals(b.title) && a.playing == b.playing
                && a.targetName.equals(b.targetName) && a.artist.equals(b.artist)
                && a.artworkUrl.equals(b.artworkUrl) && a.canNext == b.canNext && a.durationMs == b.durationMs
                && a.starting == b.starting && a.detail.equals(b.detail))) return false;
        // Off by more than 2 s from where the strip thinks it is: a seek; worth redrawing.
        return Math.abs(a.positionAt(b.reportedAt) - b.positionMs) < 2000;
    }
}
