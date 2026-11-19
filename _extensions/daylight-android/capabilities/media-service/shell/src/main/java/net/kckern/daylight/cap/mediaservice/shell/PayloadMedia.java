package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * The installed media service's three questions to the payload, over the "media"
 * PayloadPort: in process, as JSON text. No Android types, and no media knowledge:
 * what a level holds, what an id plays and when progress is reported are the
 * payload's answers.
 */
final class PayloadMedia {
    /** The payload's media-service capability attaches to a port of this name. */
    static final String PORT = "media";

    private final PayloadPort port = PayloadPort.named(PORT);

    /** @throws PayloadPort.NotReadyException when no payload attached within the wait */
    String browse(String parent, int page, int pageSize, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "browse").put("parent", parent).put("page", page)
                .put("pageSize", pageSize).toString(), waitMs);
    }

    String resolve(List<String> mediaIds, int startIndex, long waitMs) throws Exception {
        JSONObject request = new JSONObject().put("op", "resolve").put("ids", new JSONArray(mediaIds));
        if (startIndex >= 0) request.put("startIndex", startIndex);
        return port.call(request.toString(), waitMs);
    }

    /** A car's voice search. The query goes to the payload as it came; the payload cuts and cleans it. */
    String search(String query, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "search").put("query", query == null ? "" : query).toString(), waitMs);
    }

    /**
     * A tap on a widget or a tile handed the play service an action id. The payload
     * answers with the media id of that action's content, or refuses.
     */
    String action(String actionId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "action").put("action", actionId).toString(), waitMs);
    }

    /**
     * The player's position. Progress is advisory: with no payload, or one that throws,
     * the event is dropped and the next carries a later position.
     *
     * @return whether a payload took it
     */
    boolean event(String id, String title, String listId, long positionMs, long durationMs, String state) {
        try {
            port.call(new JSONObject().put("op", "event").put("id", id).put("title", title).put("listId", listId)
                    .put("positionMs", positionMs).put("durationMs", durationMs).put("state", state).toString(), 0);
            return true;
        } catch (Throwable dropped) {
            return false;
        }
    }

    /** Waits for a payload to attach. True as soon as one has. */
    boolean awaitReady(long waitMs) {
        return port.awaitReady(waitMs);
    }
}
