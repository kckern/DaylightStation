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
    JSONObject audioSources() throws Exception;
    JSONObject audioLists(String source, int cursor) throws Exception;
    JSONObject queue(String contentId) throws Exception;
    default JSONObject queue(String contentId, boolean shuffle) throws Exception {
        return queue(contentId);
    }
    JSONObject play(String contentId, boolean resume) throws Exception;
    /** GET /api/v1/content/query/search?text=&take=. text is already cut and cleaned (BrowseTree.searchText). */
    JSONObject search(String text, int take) throws Exception;
    /** POST /api/v1/play/log; the backend's answer (empty when it sent none). */
    JSONObject log(JSONObject body) throws Exception;
    /**
     * GET /api/v1/track/levels/<source>/<id>?samples=N: the loudness curve (0..1 per sample)
     * and audio quality of one track, or null when the backend has neither (204).
     */
    default JSONObject levels(String contentId, int samples) throws Exception { return null; }
    /** GET /api/v1/track/lyrics/<source>/<id>: {synced, lines:[{ms,text}], provider}, or null for none (204). */
    default JSONObject lyrics(String contentId) throws Exception { return null; }

    /** GET /api/v1/track/chapters/<source>/<id>: {chapters:[{startMs,endMs,title}], durationMs, provider}, or null for none (204). */
    default JSONObject chapters(String contentId) throws Exception { return null; }
    /** GET /api/v1/info/<source>/<id>: an item's details (a track's albumId is in its metadata). */
    default JSONObject info(String contentId) throws Exception { return null; }
    /** The Plex libraries (the list endpoint's top level): the library browser's first level. */
    default JSONObject libraries() throws Exception { return null; }
    /** Marks an item finished (or not) for the household: the web's "mark watched". */
    default void markWatched(String contentId, boolean watched) throws Exception { }
    /**
     * GET /api/v1/queue/catalog/audio-libraries?profile=audio-only: the audio libraries and
     * what each holds, {items:[{id, title, sectionId, kind}]}. A home older than the route
     * answers 404 (Refused).
     */
    default JSONObject audioLibraries() throws Exception { throw new Refused("audio libraries", 404); }
    /**
     * Continue listening's hide: POST /api/v1/media/household/continue/hide {contentId}, or
     * (hidden false, Undo) DELETE /api/v1/media/household/continue/hide/<contentId>.
     */
    default void hideContinue(String contentId, boolean hidden) throws Exception { throw new Refused("continue hide", 404); }
}
