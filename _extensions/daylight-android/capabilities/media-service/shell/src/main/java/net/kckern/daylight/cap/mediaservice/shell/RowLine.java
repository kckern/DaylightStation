package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

/**
 * A row's second line never repeats the page (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md
 * §8): what the page heading already says is left out for the next useful fact. Under an
 * author: the book's year and, once started, what is left ("1998 · 2 h 10 min left"), or its
 * length with no year; under a music artist: year and track count; on an album: the track's
 * length, and its artist only when it is not the album's; in search, lists and Continue the
 * author or artist stays. The facts are home's (the payload passes year, durationSec,
 * trackCount, artist with the row). Pure.
 */
final class RowLine {
    private RowLine() { }

    /**
     * @param pageKind   the page the row is on ("" for search and lists)
     * @param row        the payload's row: subtitle, year, durationSec, trackCount, artist
     * @param pageArtist the album's own artist (an album page's by-line), or ""
     * @param book       an author's book facts (seconds, playedSec, started, finished), or null
     */
    static String of(String pageKind, JSONObject row, String pageArtist, JSONObject book) {
        String year = row.optString("year", "");
        long seconds = row.optLong("durationSec", 0);
        switch (MediaKind.normal(pageKind)) {
            case "author": case "speaker": {
                long total = book != null && book.optLong("seconds", 0) > 0 ? book.optLong("seconds") : seconds;
                String progress = book == null ? "" : progress(book);
                if (!year.isEmpty()) return progress.isEmpty() ? year : year + " · " + progress;
                if (!progress.isEmpty()) return progress;
                return total > 0 ? length(total) : "";
            }
            case "artist": {
                int n = row.optInt("trackCount", 0);
                String count = n > 0 ? n + (n == 1 ? " track" : " tracks") : "";
                if (!year.isEmpty()) return count.isEmpty() ? year : year + " · " + count;
                return count;
            }
            case "album": {
                String artist = row.optString("artist", "");
                String len = seconds > 0 ? length(seconds) : "";
                boolean guest = !artist.isEmpty() && !pageArtist.isEmpty() && !artist.equalsIgnoreCase(pageArtist);
                if (guest) return len.isEmpty() ? artist : len + " · " + artist;
                return len;
            }
            case "book": case "series":
                return seconds > 0 ? spokenLength(seconds) : "";
            case "playlist": {
                // Nothing else on screen names a playlist track's artist: it stays.
                String artist = row.optString("artist", row.optString("subtitle", ""));
                String len = seconds > 0 ? length(seconds) : "";
                if (artist.isEmpty()) return len;
                return len.isEmpty() ? artist : artist + " · " + len;
            }
            default:
                return row.optString("subtitle", "");
        }
    }

    /** "2 h 10 min left", "Finished", or "" for a book not started. */
    static String progress(JSONObject book) {
        if (book.optBoolean("finished")) return "Finished";
        if (!book.optBoolean("started")) return "";
        long left = Math.max(0, book.optLong("seconds") - book.optLong("playedSec"));
        return left >= 3600 ? (left / 3600) + " h " + (left % 3600) / 60 + " min left" : Math.max(1, left / 60) + " min left";
    }

    /** "9 h 40 min" or "42 min" for long items; "3:45" for a song. */
    static String length(long seconds) {
        if (seconds >= 3600) return (seconds / 3600) + " h " + (seconds % 3600) / 60 + " min";
        if (seconds >= 600) return seconds / 60 + " min";
        return seconds / 60 + ":" + String.format(java.util.Locale.ROOT, "%02d", seconds % 60);
    }

    /**
     * A part's or lecture's length in one format: "9 min" (rounded, never "8:47"), "1 h 12 min"
     * over an hour, "2 h" on the hour. Under a minute is "1 min".
     */
    static String spokenLength(long seconds) {
        long minutes = Math.max(1, Math.round(seconds / 60.0));
        if (minutes < 60) return minutes + " min";
        long h = minutes / 60, m = minutes % 60;
        return m == 0 ? h + " h" : h + " h " + m + " min";
    }

    /**
     * The number a book's part shows in place of a cover: its place among the page's
     * playable rows (1-based), or 0 when it is not one.
     */
    static int partNumber(java.util.List<JSONObject> rows, String id) {
        int n = 0;
        for (JSONObject r : rows) {
            String rid = r.optString("id");
            if (!rid.startsWith("p:")) continue;
            n++;
            if (rid.equals(id)) return n;
        }
        return 0;
    }

    /**
     * An album page's by-line: its artist and year ("Rush · 2007") from home's about, the
     * row's by-line until it answers; the year alone, or the artist alone, when that is all.
     */
    static String albumBy(String subtitle, JSONObject about) {
        String artist = about == null ? "" : about.optString("byline", "");
        if (artist.isEmpty()) artist = subtitle == null ? "" : subtitle.trim();
        int year = about == null ? 0 : about.optInt("year", 0);
        if (year <= 0) return artist;
        return artist.isEmpty() ? String.valueOf(year) : artist + " · " + year;
    }

    /** A no-break space: a fact's number and unit stay on one line ("182 h", never "182 / h"). */
    static final String NB = "\u00A0";

    /**
     * An author's facts line: "United Kingdom · 12 books · 96 h"; an artist's: "United Kingdom ·
     * Rock · 9 albums". The count has one source, home's about answer (its books, from every
     * track): before it answers there is no count at all, never the rows' or a search row's
     * (2026-11-27: "36 books" jumped to "29 books"). An artist's rows count only once home
     * answered without a count of its own. A number and its unit never break apart.
     */
    static String facts(String kind, JSONObject about, int childrenShown) {
        if (about == null) return "";
        StringBuilder b = new StringBuilder();
        org.json.JSONArray countries = about.optJSONArray("countries");
        if (countries != null && countries.length() > 0) b.append(countries.optString(0));
        int n = about.optInt("children", 0);
        if (MediaKind.aboutPerson(kind) && !MediaKind.hasBooks(kind)) {
            if (n <= 0) n = childrenShown;
            org.json.JSONArray styles = about.optJSONArray("styles");
            org.json.JSONArray genres = about.optJSONArray("genres");
            String g = styles != null && styles.length() > 0 ? styles.optString(0) : genres != null && genres.length() > 0 ? genres.optString(0) : "";
            if (!g.isEmpty()) sep(b).append(g);
            if (n > 0) sep(b).append(n).append(NB).append(n == 1 ? "album" : "albums");
            return b.toString();
        }
        String noun = "speaker".equals(MediaKind.normal(kind)) ? (n == 1 ? "course" : "courses") : (n == 1 ? "book" : "books");
        if (n > 0) sep(b).append(n).append(NB).append(noun);
        long total = about.optLong("totalSec", 0);
        if (total >= 3600) sep(b).append(Math.round(total / 3600.0)).append(NB).append("h");
        else if (total > 0) sep(b).append(Math.max(1, total / 60)).append(NB).append("min");
        return b.toString();
    }

    private static StringBuilder sep(StringBuilder b) { return b.length() == 0 ? b : b.append(" · "); }
}
