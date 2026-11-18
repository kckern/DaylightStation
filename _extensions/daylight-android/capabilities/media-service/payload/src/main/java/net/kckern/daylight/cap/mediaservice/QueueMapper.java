package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Maps queue items and play responses to tracks. Audio only. Pure. */
final class QueueMapper {
    private static final String PLEX_STREAM = "/proxy/plex/stream/";

    private QueueMapper() { }

    static List<Track> fromQueue(JSONObject response, Backend backend, String session) {
        List<Track> out = new ArrayList<>();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            Track t = fromItem(items.optJSONObject(i), backend, session);
            if (t != null) out.add(t);
        }
        return out;
    }

    /**
     * A queue item or a play response. Null when it is not audio, has no content id, or
     * has no stream on the backend's own origin: a stream URL is only ever one the
     * backend gave, on the backend.
     */
    static Track fromItem(JSONObject item, Backend backend, String session) {
        if (item == null || !"audio".equals(Json.str(item, "mediaType"))) return null;
        String id = id(item);
        String url;
        try { url = backend.absolute(Json.str(item, "mediaUrl")); }
        catch (RuntimeException notConfigured) { return null; }
        if (id.isEmpty() || url == null) return null;
        // The Plex proxy mints a new client for every request unless the URL names a
        // session. The play route adds one when asked; the queue route never does.
        if (url.contains(PLEX_STREAM) && !hasParam(url, "session")) {
            url += (url.indexOf('?') >= 0 ? "&" : "?") + "session=" + ContentPath.encode(session);
        }
        JSONObject meta = item.optJSONObject("metadata");
        return new Track(id, url, Json.first(Json.str(item, "title"), "Untitled"),
                Json.first(Json.str(item, "artist"), Json.str(meta, "artist"), Json.str(item, "grandparentTitle")),
                Json.first(Json.str(item, "album"), Json.str(meta, "album"), Json.str(item, "parentTitle")),
                BrowseTree.art(backend, Json.str(item, "thumbnail")), Json.str(item, "listId"),
                Json.seconds(item, "duration"));
    }

    /** The content id of a queue item or a play response, or "" when it has none that is one. */
    static String id(JSONObject item) {
        for (String key : new String[] { "contentId", "id", "assetId" }) {
            String id = Json.str(item, key);
            if (ContentId.valid(id)) return id;
        }
        return "";
    }

    /**
     * Where the backend says to resume, in milliseconds; 0 for the beginning. A play
     * response says resume_position; a queue item says resumePosition beside resumable.
     * Both are seconds. A Plex stream URL of a resumed item already starts at the
     * offset, and is not sought again.
     */
    static long resumeMs(JSONObject item) {
        if (item == null) return 0;
        long at = Json.seconds(item, "resume_position");
        if (at == 0 && item.optBoolean("resumable", false)) at = Json.seconds(item, "resumePosition");
        if (at == 0 || hasParam(Json.str(item, "mediaUrl"), "offset")) return 0;
        long duration = Json.seconds(item, "duration");
        return duration > 0 && at >= duration ? 0 : at;
    }

    private static boolean hasParam(String url, String name) {
        int q = url.indexOf('?');
        if (q < 0) return false;
        for (String pair : url.substring(q + 1).split("&")) {
            if (pair.equals(name) || pair.startsWith(name + "=")) return true;
        }
        return false;
    }
}
