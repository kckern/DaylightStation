package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;

import org.json.JSONObject;

import java.net.URLEncoder;

/**
 * The endpoints the Media web app uses. Every path is built here from a fixed route
 * and a checked content id; nothing a caller sends is used as a path or a URL.
 */
final class BackendMediaApi implements MediaApi {
    private final Backend backend;
    private final Http http;

    BackendMediaApi(Backend backend, Http http) {
        this.backend = backend;
        this.http = http;
    }

    @Override public JSONObject rootList() throws Exception { return get("audio browse", "/api/v1/queue/catalog/audio-browse?profile=audio-only"); }

    @Override public JSONObject list(String contentId, int take, int skip) throws Exception {
        return get("list", ContentPath.of("list", contentId) + "?take=" + take + "&skip=" + skip);
    }

    @Override public JSONObject recent(int limit) throws Exception {
        return get("recent", "/api/v1/media/household/recent?limit=" + limit);
    }

    @Override public JSONObject audioSources() throws Exception {
        return get("audio list sources", "/api/v1/queue/catalog/audio-sources?profile=audio-only");
    }

    @Override public JSONObject audioLists(String source, int cursor) throws Exception {
        return get("audio list catalog", "/api/v1/queue/catalog/audio-lists?profile=audio-only&source="
                + ContentPath.encode(source) + "&skip=" + cursor);
    }

    @Override public JSONObject queue(String contentId) throws Exception {
        return queue(contentId, false);
    }

    @Override public JSONObject queue(String contentId, boolean shuffle) throws Exception {
        return get("queue", ContentPath.of("queue", contentId) + "?profile=audio-only" + (shuffle ? "&shuffle=true" : ""));
    }

    @Override public JSONObject play(String contentId, boolean resume) throws Exception {
        return get("play", ContentPath.of("play", contentId) + (resume ? "" : "?resume=false"));
    }

    /**
     * The content query search route (content-catalog's router, mounted at
     * /api/v1/content). The text is one URL-encoded query parameter; it never becomes a
     * path. No mediaType or capability filter is sent: the route's capability filter
     * would drop playlists and albums, and mediaType is handed to the adapters, not
     * applied to the merged result. What comes back is filtered by BrowseTree.fromSearch.
     */
    @Override public JSONObject search(String text, int take) throws Exception {
        return get("search", "/api/v1/content/query/search?text=" + URLEncoder.encode(text, "UTF-8") + "&take=" + take);
    }

    @Override public JSONObject log(JSONObject body) throws Exception {
        Http.Reply r = http.postJson(backend.url("/api/v1/play/log"), body.toString());
        if (!r.ok()) throw new Refused("play/log", r.status);
        try { return r.body.isEmpty() ? new JSONObject() : new JSONObject(r.body); }
        catch (org.json.JSONException notJson) { return new JSONObject(); }
    }

    @Override public JSONObject levels(String contentId, int samples) throws Exception {
        return getOrNone("levels", ContentPath.of("track/levels", contentId) + "?samples=" + samples);
    }

    @Override public JSONObject info(String contentId) throws Exception {
        return get("info", ContentPath.of("info", contentId));
    }

    @Override public JSONObject chapters(String contentId) throws Exception {
        return getOrNone("chapters", ContentPath.of("track/chapters", contentId));
    }

    @Override public JSONObject lyrics(String contentId) throws Exception {
        return getOrNone("lyrics", ContentPath.of("track/lyrics", contentId));
    }

    /** get(), with "nothing to give" (204, or an empty 200) as null instead of a failure. */
    private JSONObject getOrNone(String route, String path) throws Exception {
        Http.Reply r = http.get(backend.url(path));
        if (r.status == 204 || (r.ok() && (r.body == null || r.body.trim().isEmpty()))) return null;
        if (!r.ok()) throw new Refused(route, r.status);
        try {
            return new JSONObject(r.body);
        } catch (Exception notJson) {
            throw new Refused(route, 502);
        }
    }

    @Override public JSONObject libraries() throws Exception { return get("libraries", "/api/v1/list/plex?take=60"); }

    private JSONObject get(String route, String path) throws Exception {
        Http.Reply r = http.get(backend.url(path));
        if (!r.ok()) throw new Refused(route, r.status);
        try {
            return new JSONObject(r.body);
        } catch (Exception notJson) {
            // A proxy's error page, say. The same as an answer that was refused.
            throw new Refused(route, 502);
        }
    }
}
