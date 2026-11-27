package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Keeping an artist or an author (lifecycle spec §3.11): the group's units (an artist's
 * albums, an author's books) read from its listing, their order, which are finished or
 * started, where the 5000-track cap falls, and what a re-sync adds. Pure: no network, no
 * files. Each unit is kept as its own collection ({@link KeptCollections}) carrying the
 * group's id; the group itself is a record of its own (title, follow, remove when finished,
 * the units left out on purpose).
 */
final class GroupKeeps {
    private GroupKeeps() { }

    static final String AUTHOR = "author", ARTIST = "artist";
    /** The most units one group lists (an author of 300 books is kept to here, and says so). */
    static final int MAX_UNITS = 300;
    /** A book counts as finished at 97 % of its last part (the same line as everywhere). */
    static final double FINISHED_AT = 0.97;

    /** author when the page says so or any unit is a book; artist otherwise. */
    static String groupKind(String asked, Collection<String> unitKinds) {
        String a = asked == null ? "" : asked.toLowerCase(Locale.ROOT);
        if (a.startsWith(AUTHOR)) return AUTHOR;
        if (a.startsWith(ARTIST)) return ARTIST;
        for (String k : unitKinds) if ("book".equals(k)) return AUTHOR;
        return ARTIST;
    }

    /**
     * The units a group's listing names, in its own order: containers only (a stray track
     * at the artist's level is not a unit). Each {contentId, title, image, year, index}.
     */
    static List<JSONObject> unitsOf(JSONArray items) throws Exception {
        List<JSONObject> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String id = Json.first(Json.str(it, "id"), Json.str(it, "contentId"));
            String type = Json.str(it, "type").toLowerCase(Locale.ROOT), item = Json.str(it, "itemType");
            boolean container = "container".equals(item) || type.contains("album") || type.contains("book");
            if (!container || !ContentId.valid(id) || !seen.add(id)) continue;
            out.add(new JSONObject().put("contentId", id).put("title", Json.first(Json.str(it, "title"), Json.str(it, "label")))
                    .put("image", Json.first(Json.str(it, "image"), Json.str(it, "thumbnail")))
                    .put("year", it.optInt("year", 0)).put("index", out.size()));
            if (out.size() >= MAX_UNITS) break;
        }
        return out;
    }

    /**
     * The order units are listed and downloaded in: an author's books with the one being
     * listened to first, then the author's own order (unfinished before finished); an
     * artist's albums newest first (the listing's order among the same year).
     */
    static List<JSONObject> ordered(List<JSONObject> units, String groupKind) {
        List<JSONObject> out = new ArrayList<>(units);
        if (AUTHOR.equals(groupKind)) {
            out.sort((a, b) -> {
                int s = Integer.compare(rank(a), rank(b));
                return s != 0 ? s : Integer.compare(a.optInt("index"), b.optInt("index"));
            });
        } else {
            out.sort((a, b) -> {
                int y = Integer.compare(b.optInt("year"), a.optInt("year"));
                return y != 0 ? y : Integer.compare(a.optInt("index"), b.optInt("index"));
            });
        }
        return out;
    }

    private static int rank(JSONObject u) {
        if (u.optBoolean("started")) return 0;
        return u.optBoolean("finished") ? 2 : 1;
    }

    /** A unit is finished when its last part is (marked finished, or heard to 97 %). */
    static boolean finished(List<String> trackIds, JSONObject progress) {
        if (trackIds.isEmpty() || progress == null) return false;
        JSONObject last = progress.optJSONObject(trackIds.get(trackIds.size() - 1));
        return done(last);
    }

    /** Started: some part has a place, and the unit is not finished. */
    static boolean started(List<String> trackIds, JSONObject progress) {
        if (progress == null || finished(trackIds, progress)) return false;
        for (String id : trackIds) {
            JSONObject p = progress.optJSONObject(id);
            if (p != null && (p.optLong("playhead") > 0 || p.optBoolean("finished"))) return true;
        }
        return false;
    }

    private static boolean done(JSONObject p) {
        if (p == null) return false;
        long played = p.optLong("playhead"), duration = p.optLong("duration");
        return p.optBoolean("finished") || (duration > 0 && played >= duration * FINISHED_AT);
    }

    /** How many units, in order, fit under the track cap (a unit is never cut in half). */
    static int withinCap(List<Integer> trackCounts, int max) {
        int total = 0, n = 0;
        for (int c : trackCounts) {
            if (total + c > max) break;
            total += c;
            n++;
        }
        return n;
    }

    /**
     * A re-sync's new units for a group that follows: listed now, not held by the group,
     * not left out on purpose (unchecked, removed, finished and removed), not kept by hand
     * outside it.
     */
    static List<String> newUnits(List<String> listed, Set<String> held, Set<String> excluded, Set<String> keptElsewhere) {
        List<String> out = new ArrayList<>();
        for (String id : listed) {
            if (held.contains(id) || excluded.contains(id) || keptElsewhere.contains(id)) continue;
            out.add(id);
        }
        return out;
    }

    /** The units left out of a group after a choice: those listed and not chosen, plus those left out before and still not chosen. */
    static Set<String> excludedAfter(Collection<String> before, Collection<String> listed, Collection<String> chosen) {
        Set<String> out = new HashSet<>(before);
        out.addAll(listed);
        out.removeAll(chosen);
        return out;
    }

    /** A group id is the artist's or author's content id. */
    static boolean validId(String id) { return ContentId.valid(id); }
}
