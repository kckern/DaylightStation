package net.kckern.daylight.cap.mediaservice.shell;

import java.util.List;

/**
 * A track tapped on an album or playlist page ("p:<track>|<list>") used to wait for the
 * whole list's queue from home before its first sound. Now two questions go at once: the
 * track alone (the play route: one item, quick) and the whole list. The first useful
 * answer plays. When the track alone came first, the list's other tracks are put around
 * it when the list arrives: before it and after it, so the tapped track stays current
 * and nothing restarts or jumps.
 *
 * <p>Only music plays alone first: one track under 20 minutes with no saved place. A book's
 * part, a talk or anything with a place waits for the list as before, so its place comes
 * from home's queue. Pure; the decisions are synchronized (answers arrive on two threads).
 */
final class FirstTap {
    /** At or over this, a track is a book's part, a talk or a course: it waits for the list. */
    static final long LONG_MS = 20L * 60 * 1000;

    enum Use {
        /** Nothing to do yet. */
        WAIT,
        /** Play the track alone now. */
        SINGLE,
        /** Play the whole list now. */
        FULL,
        /** The track alone is playing: put the list's other tracks around it. */
        SPLICE,
        /** Neither answer plays: the request fails. */
        FAIL,
        /** Already decided: this answer is not needed. */
        NONE
    }

    private enum Got { PENDING, MUSIC, OTHER, FAILED }

    private Got single = Got.PENDING;
    private boolean fullDone, fullOk;
    private Use decided;

    /** Whether a request is raced: one leaf with its list, not a search, no place asked for. */
    static boolean races(List<String> ids, List<String> queries, long startPositionMs) {
        if (ids == null || ids.size() != 1 || startPositionMs > 0) return false;
        String id = ids.get(0);
        if (id == null || !id.startsWith("p:")) return false;
        int bar = id.indexOf('|');
        if (bar <= 2 || bar == id.length() - 1) return false;
        return queries == null || queries.isEmpty() || queries.get(0) == null || queries.get(0).isEmpty();
    }

    /** The track alone: "p:<track>|<list>" without its list. */
    static String alone(String leafId) {
        int bar = leafId.indexOf('|');
        return bar < 0 ? leafId : leafId.substring(0, bar);
    }

    /**
     * For Play next and Add to queue: which of the answer's tracks is the one asked for, when
     * {@code askedId} is a track row ("p:<track>" or "p:<track>|<list>"); -1 for anything else
     * (a container adds whole). Home answers a track's play with its whole list, so the one
     * track is picked out by id, else by the answer's start index.
     */
    static int onlyTrack(String askedId, List<String> answerIds, int startIndex) {
        if (askedId == null || !askedId.startsWith("p:") || answerIds == null || answerIds.isEmpty()) return -1;
        String want = bare(alone(askedId));
        for (int i = 0; i < answerIds.size(); i++) if (want.equals(bare(answerIds.get(i)))) return i;
        return startIndex >= 0 && startIndex < answerIds.size() ? startIndex : 0;
    }

    private static String bare(String id) {
        return id != null && (id.startsWith("p:") || id.startsWith("c:")) ? id.substring(2) : String.valueOf(id);
    }

    /** Whether the track-alone answer may play before the list: one music track, no saved place. */
    static boolean playsAlone(int tracks, long durationMs, long startPositionMs) {
        return tracks == 1 && durationMs > 0 && durationMs < LONG_MS && startPositionMs <= 0;
    }

    synchronized Use single(boolean ok, boolean music) {
        single = !ok ? Got.FAILED : music ? Got.MUSIC : Got.OTHER;
        if (decided != null) return Use.NONE;
        if (single == Got.MUSIC) return decide(Use.SINGLE);
        if (fullDone) return decide(single == Got.OTHER ? Use.SINGLE : Use.FAIL);
        return Use.WAIT;
    }

    synchronized Use full(boolean ok) {
        fullDone = true;
        fullOk = ok;
        if (decided == Use.SINGLE) return ok ? Use.SPLICE : Use.NONE;
        if (decided != null) return Use.NONE;
        if (ok) return decide(Use.FULL);
        if (single == Got.PENDING) return Use.WAIT;
        return decide(single == Got.FAILED ? Use.FAIL : Use.SINGLE);
    }

    private Use decide(Use u) {
        decided = u;
        return u;
    }

    /**
     * Where the playing track sits in the list's answer: its index in {@code listIds}
     * (the list's own start when that is the track, else the first match), or -1 when the
     * list does not hold it, in which case nothing is put around it.
     */
    static int spliceAt(List<String> listIds, int listStart, String playingId) {
        if (listIds == null || playingId == null) return -1;
        if (listStart >= 0 && listStart < listIds.size() && playingId.equals(listIds.get(listStart))) return listStart;
        return listIds.indexOf(playingId);
    }
}
