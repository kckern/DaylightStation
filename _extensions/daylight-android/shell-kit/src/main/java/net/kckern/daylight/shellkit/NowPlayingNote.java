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

        /**
         * Stops this target and clears its queue (the mini player's long-press). Returns an undo
         * token for {@link #restore}, {@link #NO_UNDO} when it stopped but cannot be put back (a
         * screen), or null when it could not act. Main thread.
         */
        default Object stopAndClear() { return null; }

        /** Puts back what {@code token} (from {@link #stopAndClear}) took: same queue, item and place. False when too late. */
        default boolean restore(Object token) { return false; }
    }

    /** {@link Transport#stopAndClear}'s answer for a stop that cannot be undone. */
    public static final Object NO_UNDO = new Object();

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
        /** The player's content id for the item ("plex:1"); "" when not known (a start, a screen's frame). */
        public final String mediaId;
        /** The list the item plays from when the player knows it ("plex:50", "c:plex:50"); "" for none. */
        public final String listId;
        final long at;

        public Entry(String target, String targetName, String title, String artist, String artworkUrl,
                     boolean playing, boolean canNext, long positionMs, long durationMs, long reportedAt,
                     Transport transport) {
            this(target, targetName, title, artist, artworkUrl, playing, canNext, positionMs, durationMs, reportedAt, transport, false, "");
        }

        public Entry(String target, String targetName, String title, String artist, String artworkUrl,
                     boolean playing, boolean canNext, long positionMs, long durationMs, long reportedAt,
                     Transport transport, boolean starting, String detail) {
            this(target, targetName, title, artist, artworkUrl, playing, canNext, positionMs, durationMs, reportedAt, transport, starting, detail, "");
        }

        public Entry(String target, String targetName, String title, String artist, String artworkUrl,
                     boolean playing, boolean canNext, long positionMs, long durationMs, long reportedAt,
                     Transport transport, boolean starting, String detail, String mediaId) {
            this(target, targetName, title, artist, artworkUrl, playing, canNext, positionMs, durationMs, reportedAt, transport, starting, detail,
                    mediaId, "");
        }

        public Entry(String target, String targetName, String title, String artist, String artworkUrl,
                     boolean playing, boolean canNext, long positionMs, long durationMs, long reportedAt,
                     Transport transport, boolean starting, String detail, String mediaId, String listId) {
            this.mediaId = mediaId == null ? "" : mediaId;
            this.listId = listId == null ? "" : listId;
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

    /** A start showing for a target: what the player held at the tap ({@link #NOTHING} for nothing) and the tapped content id. */
    static final class Over {
        final Entry held;
        final String tapped;
        Over(Entry held, String tapped) { this.held = held; this.tapped = tapped == null ? "" : tapped; }
    }

    /**
     * Per target: the start showing (its reports of the item held before do not replace it).
     * Read and written only under the class lock (report, starting, detail, abandonStart:
     * each is a check then an act); listeners are told outside it.
     */
    private static final java.util.Map<String, Over> startedOver = new java.util.HashMap<>();
    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    private NowPlayingNote() { }

    /** A service's report. An entry with an empty title means nothing is loaded there: it goes. */
    public static void report(Entry e) {
        boolean changed;
        synchronized (NowPlayingNote.class) { changed = apply(e); }
        if (changed) tell();
    }

    private static void tell() { for (Listener l : listeners) l.changed(); }

    /** Under the class lock: takes a report; true when the strip changed. */
    private static boolean apply(Entry e) {
        if (e == null) return false;
        Entry before = "local".equals(e.target) ? local : remote;
        // A start was tapped: the player's reports of what it held before (or of nothing yet)
        // never replace it, so the bar never shows the previous item after a new play.
        if (holdsStart(before, e, startedOver.get(e.target))) return false;
        if (!e.starting) startedOver.remove(e.target);
        // A chapter line stays with its item across the service's reports (which do not know it).
        if (!e.starting && e.detail.isEmpty() && before != null && !before.detail.isEmpty() && before.title.equals(e.title)
                && before.mediaId.equals(e.mediaId)) {
            e = new Entry(e.target, e.targetName, e.title, e.artist, e.artworkUrl, e.playing, e.canNext, e.positionMs, e.durationMs,
                    e.reportedAt, e.transport, false, before.detail, e.mediaId, e.listId);
        }
        Entry next = e.title.isEmpty() ? null : e;
        if (same(before, next)) return false;
        if ("local".equals(e.target)) local = next; else remote = next;
        return true;
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
        starting(target, targetName, title, artist, artworkUrl, now, "");
    }

    /**
     * As above, with the tapped media id ("c:plex:2", "p:plex:2|plex:1", "plex:2"; "" when not
     * known): the item is told from what the player reports by that id, by title only without
     * one, so another book's "Chapter 1" is a new start.
     */
    public static void starting(String target, String targetName, String title, String artist, String artworkUrl, long now,
                                String mediaId) {
        boolean changed;
        synchronized (NowPlayingNote.class) {
            Entry before = "local".equals(target) ? local : remote;
            String t = title == null || title.trim().isEmpty() ? STARTING_TITLE : title.trim();
            String id = contentId(mediaId);
            // A player already reporting this item, or a track of this list, is newer than the tap.
            Entry tapped = new Entry(target, targetName, t, "", "", false, false, 0, -1, now, null, false, "", id);
            if (before != null && !before.starting && (sameItem(tapped, before) || inList(before, mediaId))) return;
            Over over = startedOver.get(target);
            if (before != null && !before.starting) startedOver.put(target, new Over(before, id));
            else if (before == null) startedOver.put(target, new Over(NOTHING, id));
            else if (over != null) startedOver.put(target, new Over(over.held, id));
            changed = apply(new Entry(target, targetName, t, artist, artworkUrl, false, false, 0, -1, now, null, true, ""));
        }
        if (changed) tell();
    }

    /**
     * A start that failed (a widget's, the car's, a browse page's): the bar goes back to what
     * the player held at the tap, or to nothing, at once, and its reports count again; not
     * after 30 s of holding them back. Only the start of {@code mediaId} (the id its note was
     * given): a late failure never undoes a newer start. Nothing changes when no start is
     * showing.
     */
    public static void abandonStart(String target, String mediaId) {
        boolean changed = false;
        synchronized (NowPlayingNote.class) {
            Entry now = "local".equals(target) ? local : remote;
            Over over = startedOver.get(target);
            if (over == null || !over.tapped.equals(contentId(mediaId))) return;
            startedOver.remove(target);
            if (now != null && now.starting && now.target.equals(target)) {
                Entry back = over.held == NOTHING ? null : over.held;
                if ("local".equals(target)) local = back; else remote = back;
                changed = true;
            }
        }
        if (changed) tell();
    }

    /** {@code e} plays from the tapped list ({@code mediaId} "c:…"). */
    static boolean inList(Entry e, String mediaId) {
        if (e == null || mediaId == null || !mediaId.trim().startsWith("c:") || e.listId.isEmpty()) return false;
        return contentId(e.listId).equals(contentId(mediaId));
    }

    /** What the player held at a tap when it held nothing. */
    private static final Entry NOTHING = new Entry("", "", "", "", "", false, false, 0, -1, 0, null);

    /** The title of a start known only by its id: the bar says just this. */
    public static final String STARTING_TITLE = "Starting…";

    /**
     * Whether a report is held back because a start is showing: the start is fresh
     * (MiniPlayerState.STARTING_MS), and the report is of the item the player held at the
     * tap, or of nothing yet. Anything else (the tapped item, another start) goes through.
     * The item is told by its content id: a new book whose first chapter has the old one's
     * title ("Canto I") is a new item (2026-11-27: it was held for 30 s). Only when either id
     * is unknown is it told by title.
     */
    static boolean holdsStart(Entry before, Entry next, Over over) {
        if (before == null || !before.starting || next == null || next.starting || over == null) return false;
        if (next.reportedAt - before.reportedAt > MiniPlayerState.STARTING_MS) return false;
        if (next.title.isEmpty()) return true;
        // The tapped item itself, or a track of the tapped list (a re-tapped album reloads the track that played): it landed.
        if (!over.tapped.isEmpty() && (over.tapped.equals(contentId(next.mediaId)) || over.tapped.equals(contentId(next.listId)))) {
            return false;
        }
        return sameItem(next, over.held);
    }

    /** A media id's own content id: "plex:2" for "c:plex:2", "p:plex:2|plex:1" and "plex:2". */
    static String contentId(String mediaId) {
        if (mediaId == null) return "";
        String id = mediaId.trim();
        int bar = id.indexOf('|');
        if (bar >= 0) id = id.substring(0, bar);
        return id.length() > 2 && id.charAt(1) == ':' && (id.charAt(0) == 'c' || id.charAt(0) == 'p') ? id.substring(2) : id;
    }

    /** The same item: by content id when both are known, else by title; never the empty entry. */
    static boolean sameItem(Entry a, Entry b) {
        if (a == null || b == null || b.title.isEmpty()) return false;
        String ia = contentId(a.mediaId), ib = contentId(b.mediaId);
        if (!ia.isEmpty() && !ib.isEmpty()) return ia.equals(ib);
        return a.title.equalsIgnoreCase(b.title);
    }

    /** A book's chapter title for {@code target}'s current item (Now playing knows it): the mini player's second line. */
    public static void detail(String target, String chapter) {
        boolean changed;
        synchronized (NowPlayingNote.class) {
            Entry e = "local".equals(target) ? local : remote;
            String c = chapter == null ? "" : chapter;
            if (e == null || e.detail.equals(c)) return;
            changed = apply(new Entry(e.target, e.targetName, e.title, e.artist, e.artworkUrl, e.playing, e.canNext, e.positionMs,
                    e.durationMs, e.reportedAt, e.transport, e.starting, c, e.mediaId, e.listId));
        }
        if (changed) tell();
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

    static synchronized void clearForTests() { local = null; remote = null; listeners.clear(); startedOver.clear(); }

    /** Same as far as the strip is concerned. Position is carried forward, so a report that only moved it is not news. */
    private static boolean same(Entry a, Entry b) {
        if (a == null || b == null) return a == b;
        if (!(a.target.equals(b.target) && a.title.equals(b.title) && a.playing == b.playing
                && a.targetName.equals(b.targetName) && a.artist.equals(b.artist)
                && a.artworkUrl.equals(b.artworkUrl) && a.canNext == b.canNext && a.durationMs == b.durationMs
                && a.starting == b.starting && a.detail.equals(b.detail) && a.mediaId.equals(b.mediaId)
                && a.listId.equals(b.listId))) return false;
        // Off by more than 2 s from where the strip thinks it is: a seek; worth redrawing.
        return Math.abs(a.positionAt(b.reportedAt) - b.positionMs) < 2000;
    }
}
