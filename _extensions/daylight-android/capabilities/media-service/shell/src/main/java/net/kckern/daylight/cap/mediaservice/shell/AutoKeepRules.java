package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * "Kept automatically while you listen" (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md
 * §3.10), the rules kept pure so each is tested: which items qualify, how listening is counted,
 * what is kept (a book's parts, a series' window), the share of the limit automatic keeps may
 * take, when one is removed, and the words.
 */
final class AutoKeepRules {
    private AutoKeepRules() { }

    // ── which items ──────────────────────────────────────────────────────────

    /** A spoken item from a household list (a talk, a lecture) is at least this long; a song is not. */
    static final long MIN_LIST_ITEM_MS = 8 * 60_000L;

    /**
     * Whether an item counts toward an automatic keep: the player's long-form test
     * ({@link CarControls#longForm}: from a household list, or at least 20 minutes), and never
     * music: a list item must also be talk-length, and an item not from a list must be a
     * book's length. A duration not known yet (0) does not count.
     */
    static boolean eligible(String listId, long durationMs) {
        boolean fromList = listId != null && !listId.isEmpty();
        if (!CarControls.longForm(listId, durationMs)) return false;
        return fromList ? durationMs >= MIN_LIST_ITEM_MS : durationMs >= CarControls.LONG_FORM_MS;
    }

    /** A talk or course series (a household list's item: a rolling window), else a book (all its parts). */
    static boolean series(String listId) { return listId != null && !listId.isEmpty(); }

    /**
     * What listening is counted against before the collection is known: the album (a book, a
     * course), else the list, else the item itself.
     */
    static String itemKey(String listId, String album, String mediaId) {
        if (album != null && !album.trim().isEmpty()) return "album:" + album.trim().toLowerCase(Locale.ROOT);
        if (series(listId)) return "list:" + listId;
        return "item:" + (mediaId == null ? "" : mediaId);
    }

    /** Whether the minutes heard reach the threshold (media.autoKeepAfterMin). */
    static boolean minutesReached(long heardMs, int afterMin) {
        return heardMs >= Math.max(1, afterMin) * 60_000L;
    }

    // ── what is kept ─────────────────────────────────────────────────────────

    /** Lectures kept after the current one in a series. */
    static final int SERIES_AHEAD = 2;

    /** A series: the current lecture and the next two (fewer at the end). Not in the list: the current one alone. */
    static List<String> window(List<String> ids, String current, int ahead) {
        int at = ids.indexOf(current);
        if (at < 0) return Collections.singletonList(current);
        return new ArrayList<>(ids.subList(at, Math.min(ids.size(), at + 1 + Math.max(0, ahead))));
    }

    /** A book's parts in the order they are fetched: the current part first, then the rest of the book in play order. */
    static List<String> bookOrder(List<String> ids, String current) {
        int at = ids.indexOf(current);
        if (at < 0) return new ArrayList<>(ids);
        List<String> out = new ArrayList<>(ids.subList(at, ids.size()));
        out.addAll(ids.subList(0, at));
        return out;
    }

    /**
     * The parts to keep now, or null when nothing may be fetched now. On Wi-Fi a book is all of
     * it, a series its window; on mobile data only the current part, and only when mobile data
     * is allowed for keeps.
     */
    static List<String> scope(boolean series, List<String> ids, String current, boolean metered, boolean cellularAllowed) {
        if (metered) return cellularAllowed ? Collections.singletonList(current) : null;
        return series ? window(ids, current, SERIES_AHEAD) : bookOrder(ids, current);
    }

    /** Whether a new scope keeps exactly what is kept now (in any order): nothing to do. */
    static boolean sameParts(List<String> keptNow, List<String> scope) {
        return keptNow.size() == scope.size() && keptNow.containsAll(scope);
    }

    /**
     * The scope an automatic keep holds, as the payload records it: the whole collection is
     * stored as no list (it then follows the collection on a re-sync); a part of it as its ids.
     */
    static List<String> payloadScope(List<String> all, List<String> scope) {
        return sameParts(all, scope) ? Collections.emptyList() : scope;
    }

    // ── room ─────────────────────────────────────────────────────────────────

    /** Automatic keeps may take at most this share of the limit, and never push out a manual keep. */
    static final int SHARE_DIVISOR = 4;

    /**
     * Whether {@code needBytes} more fits for an automatic keep: within its own quarter of the
     * limit (counting the other automatic keeps) and within the limit as a whole (nothing is
     * evicted to make room).
     */
    static boolean fits(long otherAutoBytes, long needBytes, long keptBytes, long limitBytes) {
        long need = Math.max(0, needBytes);
        return otherAutoBytes + need <= limitBytes / SHARE_DIVISOR && keptBytes + need <= limitBytes;
    }

    // ── removal ──────────────────────────────────────────────────────────────

    static final long DAY_MS = 86_400_000L;
    /** A finished book stays this long (the last chapter can still be replayed). */
    static final long FINISHED_GRACE_MS = DAY_MS;
    /** Not played for this long: removed. */
    static final long STALE_MS = 30 * DAY_MS;
    /** A removal is listed on On this phone this long, with Keep again. */
    static final long REMOVED_SHOWN_MS = 7 * DAY_MS;

    static final String FINISHED = "finished", STALE = "stale", WINDOW = "window", SETTING = "setting";

    /**
     * Why an automatic keep is removed now, or null. A manual keep never is by these rules.
     * Times are wall-clock and held to now (a clock set back makes nothing wait forever).
     */
    static String removal(boolean auto, long finishedAt, long lastPlayedAt, long now, long graceMs, long staleMs) {
        if (!auto) return null;
        if (finishedAt > 0 && now - KeepRules.notAfterNow(finishedAt, now) >= graceMs) return FINISHED;
        if (lastPlayedAt > 0 && now - KeepRules.notAfterNow(lastPlayedAt, now) >= staleMs) return STALE;
        return null;
    }

    /** When the next removal falls due (wall clock), or 0 when none is pending. */
    static long nextDue(boolean auto, long finishedAt, long lastPlayedAt, long now, long graceMs, long staleMs) {
        if (!auto) return 0;
        long a = finishedAt > 0 ? KeepRules.notAfterNow(finishedAt, now) + graceMs : Long.MAX_VALUE;
        long b = lastPlayedAt > 0 ? KeepRules.notAfterNow(lastPlayedAt, now) + staleMs : Long.MAX_VALUE;
        long due = Math.min(a, b);
        return due == Long.MAX_VALUE ? 0 : due;
    }

    /** A part heard to 97 % is finished; the last part of a book finished is the book finished. */
    static boolean heardToEnd(long positionMs, long durationMs) {
        return durationMs > 0 && positionMs >= durationMs * 0.97;
    }

    // ── timing a debug build may shorten ─────────────────────────────────────

    /** The grace and stale periods, and the threshold; a debuggable build may shorten them for a check. */
    static final class Timing {
        final long graceMs, staleMs;
        final int afterMinOverride;

        Timing(long graceMs, long staleMs, int afterMinOverride) {
            this.graceMs = graceMs;
            this.staleMs = staleMs;
            this.afterMinOverride = afterMinOverride;
        }

        static final Timing DEFAULT = new Timing(FINISHED_GRACE_MS, STALE_MS, 0);

        /**
         * From {@code files/autokeep-debug.json} ({graceMin, staleMin, afterMin}), read only by a
         * debuggable build; a release build always has the spec's periods.
         */
        static Timing from(JSONObject debug, boolean debuggable) {
            if (!debuggable || debug == null) return DEFAULT;
            long grace = debug.optLong("graceMin", 0) > 0 ? debug.optLong("graceMin") * 60_000L : FINISHED_GRACE_MS;
            long stale = debug.optLong("staleMin", 0) > 0 ? debug.optLong("staleMin") * 60_000L : STALE_MS;
            return new Timing(grace, stale, Math.max(0, debug.optInt("afterMin", 0)));
        }

        int afterMin(int setting) { return afterMinOverride > 0 ? afterMinOverride : setting; }
    }

    // ── words ────────────────────────────────────────────────────────────────

    static final String KEPT_AUTOMATICALLY = "Kept automatically";
    static final String NEEDS_ROOM = "Not kept automatically: needs room";

    static String removedWords(String reason) {
        if (FINISHED.equals(reason)) return "Removed: finished";
        if (STALE.equals(reason)) return "Removed: not played for 30 days";
        return "Removed";
    }

    /**
     * The downloads notification while bytes move (Android requires it then): for automatic
     * keeps alone, "Keeping The Book for offline"; otherwise the grouped line.
     */
    static String notificationTitle(int items, int done, int total, List<String> autoTitles) {
        if (items > 0 && autoTitles.size() == items) {
            if (items == 1) {
                String t = autoTitles.get(0);
                return "Keeping " + (t == null || t.isEmpty() ? "a book" : t) + " for offline";
            }
            return "Keeping " + items + " items for offline";
        }
        int n = Math.max(1, items);
        return "Keeping " + n + (n == 1 ? " item" : " items") + (total > 0 ? " · " + done + " of " + total : "");
    }
}
