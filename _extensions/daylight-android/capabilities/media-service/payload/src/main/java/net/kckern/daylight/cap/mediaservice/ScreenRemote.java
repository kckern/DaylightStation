package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.backend.Http;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * The phone as a remote for a screen's session: which screens there are, what one is
 * playing, and one command to it. The routes are the ones the Media web app's Remote
 * uses (__docs/reference/media/media-app-technical.md §4), so a command from the phone
 * reaches the screen the same way and is attributed the same way ("Paused by Phone").
 *
 * The screen owns its session. Nothing here keeps a copy of it: every answer is what
 * the backend said just now, with its status, so the installed player shows the truth
 * (a screen that is off, a command the screen did not confirm) rather than a guess.
 *
 * A path is built only from a fixed route and a device id that matches ID; a command
 * kind or a queue op outside the fixed lists is refused before anything is sent.
 */
final class ScreenRemote {
    /** A device id as the household registry spells them: office-tv, livingroom-tv. */
    static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
    private static final Pattern TRANSPORT = Pattern.compile("play|pause|stop|seekAbs|seekRel|skipNext|skipPrev");
    private static final Pattern QUEUE_OP = Pattern.compile("jump|remove|clear|reorder");
    private static final Pattern REPEAT = Pattern.compile("off|one|all");

    private final Http http;
    private final Function<String, String> url;
    private final Supplier<String> name;
    private final Supplier<String> commandIds;

    ScreenRemote(Http http, Function<String, String> url, Supplier<String> name) {
        this(http, url, name, () -> UUID.randomUUID().toString());
    }

    ScreenRemote(Http http, Function<String, String> url, Supplier<String> name, Supplier<String> commandIds) {
        this.http = http;
        this.url = url;
        this.name = name;
        this.commandIds = commandIds;
    }

    /**
     * The screens a session can be controlled on: the registry's devices with content
     * control or a fleet flag, the same rule as the web fleet (fleet/useDevices.js).
     * Only the id and the name leave here; the registry also holds hosts and auth refs.
     */
    JSONObject screens() throws Exception {
        Http.Reply r = http.get(url.apply("/api/v1/device/config"));
        if (!r.ok()) throw new MediaApi.Refused("device config", r.status);
        JSONObject devices = new JSONObject(r.body).optJSONObject("devices");
        JSONArray items = new JSONArray();
        if (devices != null) {
            for (Iterator<String> it = devices.keys(); it.hasNext(); ) {
                String id = it.next();
                JSONObject cfg = devices.optJSONObject(id);
                if (cfg == null || !ID.matcher(id).matches()) continue;
                boolean surface = cfg.opt("content_control") instanceof JSONObject || cfg.optBoolean("fleet", false);
                if (!surface) continue;
                String label = cfg.optString("name", "");
                items.put(new JSONObject().put("id", id).put("name", label.isEmpty() ? id : label));
            }
        }
        return Replies.ok().put("items", items);
    }

    /**
     * What the screen is doing now. status is the backend's: 200 with a snapshot, 204
     * idle, 503 off (the last snapshot it sent, and when), 404 not heard from since the
     * backend started.
     */
    JSONObject session(String device) throws Exception {
        Http.Reply r = http.get(url.apply(base(device)));
        JSONObject reply = Replies.ok().put("status", r.status);
        if (r.status == 200) {
            reply.put("snapshot", artwork(new JSONObject(r.body)));
        } else if (r.status == 503) {
            JSONObject off = parse(r.body);
            if (off.optJSONObject("lastKnown") != null) reply.put("snapshot", artwork(off.getJSONObject("lastKnown")));
            reply.put("lastSeenAt", off.optString("lastSeenAt", ""));
        } else if (r.status != 204 && r.status != 404) {
            throw new MediaApi.Refused("device session", r.status);
        }
        return reply;
    }

    /**
     * One command. The backend answers when the screen has acked it (200), or says it
     * is off or a duplicate (409), or that the screen refused or did not answer in 5 s
     * (502). Each is handed back with the backend's code, never retried here: a retry
     * would be a second command.
     */
    JSONObject command(JSONObject request) throws Exception {
        String device = request.optString("device", "");
        String kind = request.optString("command", "");
        String commandId = commandIds.get();
        JSONObject body = new JSONObject().put("commandId", commandId);
        String path;
        boolean put = false;
        switch (kind) {
            case "transport": {
                String action = request.optString("action", "");
                if (!TRANSPORT.matcher(action).matches()) throw new IllegalArgumentException("transport action");
                body.put("action", action);
                if (action.startsWith("seek")) body.put("value", finite(request, "value"));
                path = "/transport";
                body.put("origin", origin());
                break;
            }
            case "queue": {
                String op = request.optString("op", "");
                if (!QUEUE_OP.matcher(op).matches()) throw new IllegalArgumentException("queue op");
                if (op.equals("jump") || op.equals("remove")) {
                    String item = request.optString("queueItemId", "");
                    if (item.isEmpty() || item.length() > 128) throw new IllegalArgumentException("queueItemId");
                    body.put("queueItemId", item);
                } else if (op.equals("reorder")) {
                    // The whole new order by queueItemId: the router takes ids, not indices.
                    JSONArray order = request.getJSONArray("items");
                    JSONArray ids = new JSONArray();
                    for (int i = 0; i < order.length(); i++) {
                        String id = order.getString(i);
                        if (id.isEmpty() || id.length() > 128) throw new IllegalArgumentException("queueItemId");
                        ids.put(id);
                    }
                    if (ids.length() == 0 || ids.length() > 500) throw new IllegalArgumentException("items");
                    body.put("items", ids);
                }
                path = "/queue/" + op;
                body.put("origin", origin());
                break;
            }
            case "shuffle":
                body.put("enabled", request.getBoolean("enabled"));
                path = "/shuffle";
                put = true;
                break;
            case "repeat": {
                String mode = request.optString("mode", "");
                if (!REPEAT.matcher(mode).matches()) throw new IllegalArgumentException("repeat mode");
                body.put("mode", mode);
                path = "/repeat";
                put = true;
                break;
            }
            case "volume": {
                int level = request.getInt("level");
                if (level < 0 || level > 100) throw new IllegalArgumentException("volume level");
                body.put("level", level);
                path = "/volume";
                put = true;
                break;
            }
            default:
                throw new IllegalArgumentException("command");
        }
        String target = url.apply(base(device) + path);
        Http.Reply r = put ? http.putJson(target, body.toString()) : http.postJson(target, body.toString());
        JSONObject answer = parse(r.body);
        JSONObject reply = Replies.ok().put("status", r.status).put("commandId", commandId).put("accepted", r.ok());
        if (!r.ok()) {
            reply.put("code", answer.optString("code", ""));
            reply.put("error", answer.optString("error", ""));
        }
        return reply;
    }

    /**
     * A snapshot's thumbnails are backend paths ("/api/v1/display/…"). They become URLs on
     * the backend's own origin here; any other value is dropped, so the installed player
     * never loads an image from somewhere a snapshot named.
     */
    private JSONObject artwork(JSONObject snapshot) throws Exception {
        absolute(snapshot.optJSONObject("currentItem"));
        JSONObject queue = snapshot.optJSONObject("queue");
        JSONArray items = queue == null ? null : queue.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) absolute(items.optJSONObject(i));
        return snapshot;
    }

    private void absolute(JSONObject item) throws Exception {
        if (item == null || !item.has("thumbnail")) return;
        String thumb = item.optString("thumbnail", "");
        if (thumb.startsWith("/") && !thumb.startsWith("//")) item.put("thumbnail", url.apply(thumb));
        else item.remove("thumbnail");
    }

    private JSONObject origin() throws Exception {
        JSONObject origin = new JSONObject().put("kind", "device");
        String label = name.get();
        if (label != null && !label.isEmpty() && label.length() <= 80) origin.put("name", label);
        return origin;
    }

    private static String base(String device) {
        if (device == null || !ID.matcher(device).matches()) throw new IllegalArgumentException("device");
        return "/api/v1/device/" + device + "/session";
    }

    private static double finite(JSONObject request, String key) {
        double value = request.optDouble(key, Double.NaN);
        if (Double.isNaN(value) || Double.isInfinite(value)) throw new IllegalArgumentException(key);
        return value;
    }

    private static JSONObject parse(String body) {
        try { return new JSONObject(body); } catch (Exception notJson) { return new JSONObject(); }
    }
}
