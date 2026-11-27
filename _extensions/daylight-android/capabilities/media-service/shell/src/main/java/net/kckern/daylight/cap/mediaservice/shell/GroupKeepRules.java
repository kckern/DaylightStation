package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.KeptIndex;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The words and arithmetic of "Keep all…" on an artist or an author (lifecycle spec §3.11):
 * which units start checked, the total and the room after, what is over and the units that
 * fit, the one button's words, and what a Remove really frees when other keeps share a
 * track. Pure: plain Java, JVM-tested.
 */
final class GroupKeepRules {
    private GroupKeepRules() { }

    static final String AUTHOR = "author";

    /** One unit as the sheet holds it. */
    static final class Unit {
        final String id, title;
        /** Bytes still to download (0 when every track is here already, shared copies included); -1 unknown. */
        final long need;
        /** Its whole size (downloaded or not); for the row. */
        final long bytes;
        final boolean finished, started, held, overCap;
        final int tracks;
        boolean checked;

        Unit(String id, String title, long need, long bytes, int tracks, boolean finished, boolean started, boolean held, boolean overCap) {
            this.id = id;
            this.title = title;
            this.need = need;
            this.bytes = bytes;
            this.tracks = tracks;
            this.finished = finished;
            this.started = started;
            this.held = held;
            this.overCap = overCap;
        }
    }

    /**
     * The checks the sheet opens with: a group kept before, what it holds now (Choose…);
     * a new one, everything but the finished books and what is past the 5000-track cap.
     */
    static void defaultChecks(List<Unit> units, boolean groupKept) {
        for (Unit u : units) u.checked = groupKept ? u.held : !u.finished && !u.overCap;
    }

    /** "Include finished (3)" checks or unchecks the finished ones. */
    static void includeFinished(List<Unit> units, boolean include) {
        for (Unit u : units) if (u.finished && !u.overCap) u.checked = include;
    }

    static int finishedCount(List<Unit> units) {
        int n = 0;
        for (Unit u : units) if (u.finished) n++;
        return n;
    }

    static int checkedCount(List<Unit> units) {
        int n = 0;
        for (Unit u : units) if (u.checked) n++;
        return n;
    }

    /** What the checked units still need (unknown sizes count 0). */
    static long checkedNeed(List<Unit> units) {
        long n = 0;
        for (Unit u : units) if (u.checked && !u.held) n += Math.max(0, u.need);
        return n;
    }

    static int checkedTracks(List<Unit> units) {
        int n = 0;
        for (Unit u : units) if (u.checked) n += u.tracks;
        return n;
    }

    /**
     * "Keep the N that fit": in the sheet's order (books in the author's order with the
     * started one first, finished last; albums newest first), each checked unit that still
     * fits in {@code room}, skipping one too large. Answers how many stay checked.
     */
    static int keepThoseThatFit(List<Unit> units, long room) {
        long left = room;
        int n = 0;
        for (Unit u : units) {
            if (!u.checked) continue;
            long need = u.held ? 0 : Math.max(0, u.need);
            if (need <= left) { left -= need; n++; }
            else u.checked = false;
        }
        return n;
    }

    /** How many of the checked would fit, without changing anything. */
    static int wouldFit(List<Unit> units, long room) {
        long left = room;
        int n = 0;
        for (Unit u : units) {
            if (!u.checked) continue;
            long need = u.held ? 0 : Math.max(0, u.need);
            if (need <= left) { left -= need; n++; }
        }
        return n;
    }

    static String noun(String groupKind, int n) {
        boolean books = AUTHOR.equals(groupKind);
        return n + " " + (books ? (n == 1 ? "book" : "books") : (n == 1 ? "album" : "albums"));
    }

    /** The one button: "Keep 12 books · 4.2 GB". */
    static String button(String groupKind, int n, long bytes) {
        return "Keep " + noun(groupKind, n) + (bytes > 0 ? " · " + KeptIndex.size(bytes) : "");
    }

    /** "4.2 GB · 9.8 GB left" (on Wi-Fi when that is the rule). */
    static String totalLine(long need, long roomAfter, boolean wifiOnly) {
        return KeptIndex.size(need) + " · " + KeptIndex.size(Math.max(0, roomAfter)) + " left" + (wifiOnly ? " · on Wi-Fi" : "");
    }

    /** "1.2 GB more than there is room for". */
    static String overLine(long over) {
        return KeptIndex.size(over) + " more than there is room for";
    }

    static String fitButton(String groupKind, int n) {
        return "Keep the " + n + " that fit";
    }

    /** More than 5000 tracks: "Over 5000 tracks: the first 30 books are offered (4,980 tracks)". */
    static String capLine(String groupKind, int totalTracks, int cap, int withinUnits, int withinTracks) {
        if (totalTracks <= cap) return "";
        return "Over " + cap + " tracks (" + totalTracks + "): the first " + noun(groupKind, withinUnits) + " can be kept ("
                + withinTracks + " tracks)";
    }

    /** "Shakespeare · 12 books · 4.2 GB": a group's row on On this phone. */
    static String groupLine(String groupKind, int units, long bytes) {
        return noun(groupKind, units) + " · " + KeptIndex.size(bytes);
    }

    /** "Include finished (3)". */
    static String includeFinishedLabel(int n) { return "Include finished (" + n + ")"; }

    /** A unit's line in the sheet: "230 MB · Started", "Finished", "On this phone". */
    static String unitLine(Unit u) {
        List<String> parts = new ArrayList<>();
        if (u.bytes > 0) parts.add(KeptIndex.size(u.bytes));
        else if (u.need < 0) parts.add("Size when on Wi-Fi");
        if (u.held) parts.add("On this phone");
        else if (u.need == 0 && u.bytes > 0) parts.add("Already on this phone");
        if (u.finished) parts.add("Finished");
        else if (u.started) parts.add("Started");
        if (u.overCap) parts.add("Past 5000 tracks");
        return String.join(" · ", parts);
    }

    /**
     * What removing one item frees: the bytes of its tracks no other kept item holds (an
     * album kept on its own and through its artist, a track in a kept playlist).
     */
    static long freedBytes(List<String> mine, Set<String> heldByOthers, Map<String, Long> bytesByTrack) {
        long n = 0;
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (String id : mine) {
            if (!seen.add(id) || heldByOthers.contains(id)) continue;
            Long b = bytesByTrack.get(id);
            if (b != null) n += Math.max(0, b);
        }
        return n;
    }

    /** The confirmation line for a Remove: what is really freed. */
    static String freedLine(long freed, boolean shared) {
        if (freed > 0) return KeptIndex.size(freed) + " is freed on this phone." + (shared ? " Tracks other keeps hold stay." : "");
        return shared ? "Its audio stays: other keeps hold it." : "It is removed from this phone.";
    }

    /** A finished unit of a group that removes finished ones is due {@code graceMs} after it was finished. */
    static boolean finishedRemovalDue(long finishedAt, long now, long graceMs) {
        return finishedAt > 0 && now >= finishedAt + graceMs;
    }
}
