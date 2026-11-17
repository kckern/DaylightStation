package net.kckern.daylight.cap.mediaservice;

import org.json.JSONObject;

/** The backend calls the media service makes. An interface so tests can fake it. */
interface MediaApi {
    /** A request the backend answered with a status that is not 2xx. The message is the route and the status, never an id. */
    final class Refused extends java.io.IOException {
        final int status;
        Refused(String route, int status) {
            super(route + " answered " + status);
            this.status = status;
        }
    }

    JSONObject rootList() throws Exception;
    JSONObject list(String contentId, int take, int skip) throws Exception;
    JSONObject recent(int limit) throws Exception;
    JSONObject queue(String contentId) throws Exception;
    JSONObject play(String contentId) throws Exception;
    /** GET /api/v1/content/query/search?text=&take=. text is already cut and cleaned (BrowseTree.searchText). */
    JSONObject search(String text, int take) throws Exception;
    void log(JSONObject body) throws Exception;
}
