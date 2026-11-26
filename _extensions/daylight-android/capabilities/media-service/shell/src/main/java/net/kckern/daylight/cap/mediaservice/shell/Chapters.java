package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * A book's chapters as Now playing uses them: which one the position is in, the line under
 * the album ("Chapter 4 of 12 · 9 min left in chapter"), where Next and Previous go, and the
 * marks on the seek bar. Built from the payload's track-chapters answer; a list that does
 * not fit the file (its end more than 2 s from the file's length) is no list at all. Pure.
 * See ops:docs/superpowers/specs/2026-11-26-phone-audiobook-chapters.md.
 */
final class Chapters {
    static final Chapters NONE = new Chapters(new long[0], new long[0], new String[0]);
    static final long TOLERANCE_MS = 2000;
    /** Previous goes to this chapter's start when more than this far in, else to the one before. */
    static final long RESTART_MS = 3000;
    private static final Pattern GENERIC = Pattern.compile("(?i)^(chapter|ch\\.?|part|track)?\\s*\\d+\\s*$");

    final long[] starts;
    final long[] ends;
    final String[] titles;

    private Chapters(long[] starts, long[] ends, String[] titles) {
        this.starts = starts;
        this.ends = ends;
        this.titles = titles;
    }

    /**
     * From {chapters:{chapters:[{startMs,endMs,title}], durationMs}} (the op's answer) or the
     * inner object itself. {@code fileMs} is the player's own length of the file (0 when unknown).
     */
    static Chapters parse(JSONObject reply, long fileMs) {
        if (reply == null) return NONE;
        JSONObject body = reply.optJSONObject("chapters") != null ? reply.optJSONObject("chapters") : reply;
        JSONArray list = body.optJSONArray("chapters");
        if (list == null || list.length() < 2) return NONE;
        int n = list.length();
        long[] s = new long[n], e = new long[n];
        String[] t = new String[n];
        for (int i = 0; i < n; i++) {
            JSONObject c = list.optJSONObject(i);
            if (c == null) return NONE;
            s[i] = c.optLong("startMs", -1);
            e[i] = c.optLong("endMs", -1);
            t[i] = c.optString("title", "").trim();
            if (s[i] < 0 || e[i] <= s[i] || (i > 0 && s[i] < s[i - 1])) return NONE;
        }
        if (fileMs > 0 && Math.abs(e[n - 1] - fileMs) > TOLERANCE_MS) return NONE;
        return new Chapters(s, e, t);
    }

    boolean isEmpty() { return starts.length == 0; }

    int count() { return starts.length; }

    /** The chapter the position is in (the last whose start it has reached). */
    int indexAt(long positionMs) {
        int at = 0;
        for (int i = 0; i < starts.length; i++) if (positionMs >= starts[i]) at = i;
        return at;
    }

    /** Next chapter's start, or -1 in the last chapter. */
    long nextStart(long positionMs) {
        int i = indexAt(positionMs);
        return i + 1 < starts.length ? starts[i + 1] : -1;
    }

    /** This chapter's start when more than 3 s in (or in the first), else the previous chapter's. */
    long previousTarget(long positionMs) {
        int i = indexAt(positionMs);
        if (positionMs - starts[i] > RESTART_MS || i == 0) return starts[i];
        return starts[i - 1];
    }

    /** The current chapter's end (where End of chapter pauses). */
    long endAt(long positionMs) { return ends[indexAt(positionMs)]; }

    /** A chapter's own name, or "" when it is only a number ("Chapter 4", "04"). */
    String nameOf(int i) {
        String t = titles[i];
        return t.isEmpty() || GENERIC.matcher(t).matches() ? "" : t;
    }

    /** "Chapter 4 of 12 · 9 min left in chapter", or "4/12 · The Return · 9 min left". */
    String line(long positionMs, float speed) {
        if (isEmpty()) return "";
        int i = indexAt(positionMs);
        long left = (long) (Math.max(0, ends[i] - positionMs) / Math.max(0.1f, speed));
        String name = nameOf(i);
        if (name.isEmpty()) return "Chapter " + (i + 1) + " of " + count() + " · " + leftText(left) + " in chapter";
        return (i + 1) + "/" + count() + " · " + name + " · " + leftText(left);
    }

    /** For the notification, lock screen and car: "Chapter 4 of 12 · The Return". */
    String subtitle(long positionMs) {
        if (isEmpty()) return "";
        int i = indexAt(positionMs);
        String name = nameOf(i);
        return "Chapter " + (i + 1) + " of " + count() + (name.isEmpty() ? "" : " · " + name);
    }

    /** A chapter's row in the list: its length. */
    String lengthOf(int i) { return clock(ends[i] - starts[i]); }

    /** Each chapter start after the first, as a fraction of the file. */
    float[] marks(long fileMs) {
        long length = fileMs > 0 ? fileMs : ends[ends.length - 1];
        if (isEmpty() || length <= 0) return new float[0];
        float[] out = new float[starts.length - 1];
        for (int i = 1; i < starts.length; i++) out[i - 1] = starts[i] / (float) length;
        return out;
    }

    static String leftText(long ms) {
        if (ms < 60_000) return "under a minute left";
        long min = ms / 60_000;
        if (min < 60) return min + " min left";
        return (min / 60) + " h " + (min % 60) + " min left";
    }

    static String clock(long ms) {
        long s = Math.max(0, ms) / 1000;
        return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
    }
}
