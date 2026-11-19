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

    @Override public JSONObject rootList() throws Exception { return get("list", "/api/v1/list/"); }

    @Override public JSONObject list(String contentId, int take, int skip) throws Exception {
        return get("list", ContentPath.of("list", contentId) + "?take=" + take + "&skip=" + skip);
    }

    @Override public JSONObject recent(int limit) throws Exception {
        return get("recent", "/api/v1/media/household/recent?limit=" + limit);
    }

    @Override public JSONObject queue(String contentId) throws Exception { return get("queue", ContentPath.of("queue", contentId)); }

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

    @Override public void log(JSONObject body) throws Exception {
        Http.Reply r = http.postJson(backend.url("/api/v1/play/log"), body.toString());
        if (!r.ok()) throw new Refused("play/log", r.status);
    }

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
