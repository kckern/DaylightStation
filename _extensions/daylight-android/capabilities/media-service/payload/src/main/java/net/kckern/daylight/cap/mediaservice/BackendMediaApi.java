package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;

import org.json.JSONObject;

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

    @Override public JSONObject play(String contentId) throws Exception { return get("play", ContentPath.of("play", contentId)); }

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
