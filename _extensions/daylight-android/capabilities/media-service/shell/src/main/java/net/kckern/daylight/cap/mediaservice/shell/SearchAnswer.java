package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/**
 * The installed service's side of a car's voice search, pure: the payload's "best"
 * item, whether a play request is a play-from-search, and one page of results.
 *
 * Media3 1.1.1 hands a legacy controller's play-from-search ("play ... on Daylight")
 * to onSetMediaItems as one MediaItem with an empty media id and the spoken words in
 * its request metadata's search query (read from the 1.1.1 bytecode:
 * MediaSessionLegacyStub.onPlayFromSearch and createMediaItemForMediaRequest).
 */
final class SearchAnswer {
    private SearchAnswer() { }

    /** The item id the payload names as what "play <query>" plays, or null. */
    static String best(String answer) {
        if (answer == null) return null;
        try {
            JSONObject o = new JSONObject(answer);
            if (!o.optBoolean("ok", false)) return null;
            Object best = o.opt("best");
            if (!(best instanceof String)) return null;
            String s = (String) best;
            return s.startsWith("p:") && s.length() > 2 && s.length() <= 900 ? s : null;
        } catch (Exception notJson) {
            return null;
        }
    }

    /**
     * The search query when a play request is a play-from-search, else null.
     *
     * @param mediaIds      the requested items' media ids
     * @param searchQueries the requested items' request-metadata search queries (null when none)
     */
    static String playFromSearch(List<String> mediaIds, List<String> searchQueries) {
        if (mediaIds == null || searchQueries == null || mediaIds.size() != 1 || searchQueries.size() != 1) return null;
        String id = mediaIds.get(0);
        String query = searchQueries.get(0);
        return (id == null || id.isEmpty()) && query != null ? query : null;
    }

    /** One page of a result list; empty past the end. A page size of 0 or less, or one that overflows, means all of it. */
    static <T> List<T> page(List<T> all, int page, int pageSize) {
        if (page < 0) return Collections.emptyList();
        if (pageSize <= 0) return all;
        long from = (long) page * pageSize;
        if (from >= all.size()) return page == 0 ? all : Collections.<T>emptyList();
        long to = Math.min(all.size(), from + pageSize);
        return all.subList((int) from, (int) to);
    }
}
