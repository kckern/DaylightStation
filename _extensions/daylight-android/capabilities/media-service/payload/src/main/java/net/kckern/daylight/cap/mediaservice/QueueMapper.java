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
        String raw = Json.str(item, "mediaUrl");
        // A Plex stream's offset= starts it server-side; the phone seeks instead (resumeMs).
        if (raw.contains(PLEX_STREAM)) raw = withoutParam(raw, "offset");
        try { url = backend.absolute(raw); }
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
                Json.seconds(item, "duration"), fileVersion(item)).longForm(item.optBoolean("resumable", false));
    }

    /** The file version the backend names ("<partId>:<updatedAt>"), short and printable, or "". */
    static String fileVersion(JSONObject item) {
        JSONObject meta = item.optJSONObject("metadata");
        String v = Json.first(Json.str(item, "fileVersion"), meta == null ? "" : Json.str(meta, "fileVersion"));
        return v.length() <= 80 && v.matches("[A-Za-z0-9:._-]*") ? v : "";
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
     * Both are seconds. The player always seeks there itself: an audio stream is the file
     * (byte ranges), and a server-side start (an older backend's offset= on the URL, which
     * fromItem strips) would make the player's clock, and every progress report, count
     * from 0 instead of the real place.
     */
    static long resumeMs(JSONObject item) {
        if (item == null) return 0;
        long at = Json.seconds(item, "resume_position");
        if (at == 0 && item.optBoolean("resumable", false)) at = Json.seconds(item, "resumePosition");
        String mediaUrl = Json.str(item, "mediaUrl");
        // Another stream (a signed one) that starts at its offset is not sought again.
        if (at == 0 || (!mediaUrl.contains(PLEX_STREAM) && hasParam(mediaUrl, "offset"))) return 0;
        long duration = Json.seconds(item, "duration");
        return duration > 0 && at >= duration ? 0 : at;
    }

    /** {@code url} without the query parameter {@code name}; unchanged when it has none. */
    static String withoutParam(String url, String name) {
        if (url == null) return null;
        int q = url.indexOf('?');
        if (q < 0) return url;
        StringBuilder kept = new StringBuilder();
        for (String pair : url.substring(q + 1).split("&")) {
            if (pair.isEmpty() || pair.equals(name) || pair.startsWith(name + "=")) continue;
            kept.append(kept.length() == 0 ? "" : "&").append(pair);
        }
        return kept.length() == 0 ? url.substring(0, q) : url.substring(0, q + 1) + kept;
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
