package net.kckern.daylight.cap.widgets.shell;

import org.json.JSONObject;

/**
 * The words of a Continue listening row on the Play tab (lookup spec §13): one row per book,
 * so its line says which part it is in and what is left in the whole book
 * ("William Shakespeare · Part 2 of 5 · 1 h 30 min left"), and the one-time review row's
 * label for older entries. Pure.
 */
final class ContinueRow {
    private ContinueRow() { }

    /** What is left: in the book when home says (remainingSec), else in the part. */
    static long leftSeconds(JSONObject row) {
        if (row.has("remainingSec")) return Math.max(0, row.optLong("remainingSec"));
        return Math.max(0, row.optLong("duration") - row.optLong("playhead"));
    }

    /** "Part 2 of 5 · 1 h 30 min left", or the time left alone for a single item. */
    static String progress(JSONObject row) {
        String left = PhoneHomeActivity.timeLeft(leftSeconds(row));
        int n = row.optInt("partIndex", 0), of = row.optInt("partCount", 0);
        return n > 0 && of > 1 ? "Part " + n + " of " + of + " · " + left : left;
    }

    /** The row's second line: the author (never the title again), then the progress. */
    static String line(JSONObject row) {
        String by = row.optString("subtitle", ""), title = row.optString("title", "");
        String p = progress(row);
        return by.isEmpty() || by.equalsIgnoreCase(title) ? p : by + " · " + p;
    }

    /** "Review 3 older items" (the one-time row), or "" for none. */
    static String reviewLabel(int count) {
        if (count <= 0) return "";
        return "Review " + count + (count == 1 ? " older item" : " older items");
    }

    /** Whether the row is a book's part (its page is the book's own id; no lookup needed). */
    static boolean grouped(JSONObject row) {
        String play = row.optString("playContentId", "");
        return !play.isEmpty() && !play.equals(row.optString("contentId"));
    }
}
