package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Http;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.function.Consumer;
import java.util.function.Function;

/**
 * The phone as a Play-on target: while the payload runs, it asks the backend for commands
 * addressed to it (a long poll, GET /api/v1/device/<id>/commands?wait=20). Each poll also
 * tells the backend the phone is reachable, so the web's Play-on picker shows it online
 * only while it is. A play command starts that content on this phone; every command is
 * acknowledged (POST /api/v1/device/<id>/ack) as played or refused, never left hanging.
 * A failed poll waits (2 s, doubling to 60 s) before the next. Nothing here decides what
 * plays: the command names it, the launcher plays it.
 */
final class PlayInbox {
    static final int WAIT_S = 20;
    private static final long MIN_BACKOFF_MS = 2_000, MAX_BACKOFF_MS = 60_000;

    private final Http http;
    private final Function<String, String> url;
    private final String deviceId;
    private final Consumer<String> play;
    private volatile boolean running;
    private Thread thread;

    /** @param play starts a media id ("c:<content id>" for a list, "p:<content id>" for one item) on this phone */
    PlayInbox(Http http, Function<String, String> url, String deviceId, Consumer<String> play) {
        this.http = http;
        this.url = url;
        this.deviceId = deviceId;
        this.play = play;
    }

    synchronized void start() {
        if (running || deviceId == null || !deviceId.matches("[a-z0-9][a-z0-9-]{0,63}")) return;
        running = true;
        thread = new Thread(this::loop, "daylight-play-inbox");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void stop() {
        running = false;
        if (thread != null) thread.interrupt();
        thread = null;
    }

    private void loop() {
        long backoff = MIN_BACKOFF_MS;
        while (running) {
            try {
                Http.Reply r = http.get(url.apply("/api/v1/device/" + deviceId + "/commands?wait=" + WAIT_S));
                if (r.status == 200 && r.body != null && !r.body.isEmpty()) {
                    JSONArray commands = new JSONObject(r.body).optJSONArray("commands");
                    for (int i = 0; commands != null && i < commands.length(); i++) handle(commands.optJSONObject(i));
                } else if (!r.ok()) {
                    throw new java.io.IOException("commands answered " + r.status);
                }
                backoff = MIN_BACKOFF_MS;
            } catch (Exception failed) {
                if (!running) return;
                try { Thread.sleep(backoff); } catch (InterruptedException stopped) { return; }
                backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
            }
        }
    }

    /** One command: play it here (and say so), or refuse it with a reason. Never thrown. */
    void handle(JSONObject command) {
        if (command == null) return;
        String commandId = command.optString("commandId", command.optString("dispatchId", ""));
        String mediaId = mediaIdOf(command);
        boolean ok = false;
        String error = null;
        if (mediaId == null) {
            error = "unsupported";
        } else {
            try { play.accept(mediaId); ok = true; }
            catch (RuntimeException refused) { error = "could_not_play"; }
        }
        if (commandId.isEmpty()) return;
        try {
            JSONObject ack = new JSONObject().put("commandId", commandId).put("ok", ok);
            if (error != null) ack.put("error", error);
            if (ok) ack.put("state", new JSONObject().put("contentId", contentIdOf(command)).put("playing", true)
                    .put("title", command.optString("title", "")));
            http.postJson(url.apply("/api/v1/device/" + deviceId + "/ack"), ack.toString());
        } catch (Exception unsent) {
            // The backend's own timeout reports it as not confirmed.
        }
    }

    /**
     * The media id a command asks for: "c:<content id>", through the backend's queue route,
     * which plays a list as the list and a single item as a queue of one (and resumes what
     * is resumable). The web's play-now, play-next and add all start it here: a phone has
     * one queue and nobody to merge with. Null for anything that is not a valid content id.
     */
    static String mediaIdOf(JSONObject command) {
        String id = contentIdOf(command);
        return ContentId.valid(id) ? "c:" + id : null;
    }

    static String contentIdOf(JSONObject command) {
        for (String key : new String[] { "contentId", "play", "queue" }) {
            String v = command.optString(key, "");
            if (!v.isEmpty()) return v;
        }
        JSONObject params = command.optJSONObject("params");
        return params == null ? "" : Json.first(params.optString("contentId", ""), params.optString("play", ""), params.optString("queue", ""));
    }
}
