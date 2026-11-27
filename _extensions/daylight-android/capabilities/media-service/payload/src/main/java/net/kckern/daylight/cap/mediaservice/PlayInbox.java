package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Http;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * The phone as a target the web can address: while the payload runs, it asks the backend
 * for commands addressed to this install (a long poll,
 * GET /api/v1/device/&lt;id&gt;/commands?wait=20&amp;installId=&amp;model=, with the device's
 * bearer token). Each poll also tells the backend this install is reachable.
 *
 * <p>A play command starts that content here; a keep or unkeep command keeps a collection on
 * the phone or removes it. Every command is acknowledged (POST …/ack, with the install id)
 * as done or refused, never left hanging. A command that names another install is refused,
 * never applied: the backend should not send one, and this install does not trust that it
 * will not. What is kept and how far each download has got is sent whole
 * (POST …/keeps) whenever it changes, so the web can show it.
 *
 * <p>A failed poll waits (2 s, doubling to 60 s); a refused token waits 5 minutes and says so
 * in {@link #status()}. Nothing here decides what plays or what is kept: the command names it.
 */
final class PlayInbox {
    static final int WAIT_S = 20;
    private static final long MIN_BACKOFF_MS = 2_000, MAX_BACKOFF_MS = 60_000, UNAUTHORIZED_WAIT_MS = 300_000;

    /** Keeps or removes a collection on this phone. Throws to refuse, with a short reason as the message. */
    interface Keeper {
        void keep(String contentId, String title) throws Exception;
        void unkeep(String contentId) throws Exception;
    }

    /** Hears whether the backend answered a poll: the payload's "is home there" for everything else. */
    interface Reach {
        void reached(boolean answered);
    }

    private final Http http;
    private final Function<String, String> url;
    private final String deviceId;
    private final String installId;
    private final String model;
    private final Supplier<String> token;
    private final Consumer<String> play;
    private final Keeper keeper;
    private final Reach reach;
    private final Sleeper sleeper;
    private volatile boolean running;
    private volatile String status = "stopped";
    private Thread thread;
    private java.util.concurrent.ScheduledExecutorService sender;
    private volatile JSONArray keeps;          // the latest full list
    private volatile boolean keepsDirty;       // changed since it was last accepted
    private volatile long keepsChangedAt;
    private volatile long keepsSentAt;
    private volatile String refusedBecause = "";
    private final java.util.function.LongSupplier clock;
    /** A change is sent once it has been still this long; with polls, at most once a minute. */
    static final long KEEPS_DEBOUNCE_MS = 5_000, KEEPS_EVERY_MS = 60_000;
    /** The most items one report carries (the backend's limit). */
    static final int KEEPS_MAX = 500;

    interface Sleeper { void sleep(long ms) throws InterruptedException; }

    /**
     * @param deviceId  the id this install polls as (the phone's, or its emulator twin's)
     * @param play      starts a media id ("c:&lt;content id&gt;") on this phone
     */
    PlayInbox(Http http, Function<String, String> url, String deviceId, String installId, String model,
              Supplier<String> token, Consumer<String> play, Keeper keeper, Reach reach) {
        this(http, url, deviceId, installId, model, token, play, keeper, reach, Thread::sleep, System::currentTimeMillis);
    }

    PlayInbox(Http http, Function<String, String> url, String deviceId, String installId, String model,
              Supplier<String> token, Consumer<String> play, Keeper keeper, Reach reach, Sleeper sleeper,
              java.util.function.LongSupplier clock) {
        this.clock = clock;
        this.http = http;
        this.url = url;
        this.deviceId = deviceId;
        this.installId = installId == null ? "" : installId;
        this.model = model == null ? "" : model;
        this.token = token;
        this.play = play;
        this.keeper = keeper;
        this.reach = reach;
        this.sleeper = sleeper;
    }

    static boolean validDevice(String deviceId) {
        return deviceId != null && deviceId.matches("[a-z0-9][a-z0-9-]{0,63}");
    }

    synchronized void start() {
        if (running || !validDevice(deviceId)) return;
        running = true;
        status = "polling";
        thread = new Thread(this::loop, "daylight-play-inbox");
        thread.setDaemon(true);
        thread.start();
        sender = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "daylight-keeps-report");
            t.setDaemon(true);
            return t;
        });
    }

    synchronized void stop() {
        running = false;
        status = "stopped";
        if (thread != null) thread.interrupt();
        thread = null;
        if (sender != null) sender.shutdownNow();
        sender = null;
    }

    /** polling, unauthorized (with the backend's reason: no_token, wrong_token, …), unreachable or stopped. */
    String status() { return "unauthorized".equals(status) && !refusedBecause.isEmpty() ? status + ": " + refusedBecause : status; }

    String deviceId() { return deviceId; }

    String installId() { return installId; }

    /** The whole list of kept collections and their states; sent on the next chance, replacing any unsent one. */
    void reportKeeps(JSONArray items) {
        JSONArray capped = items;
        if (items != null && items.length() > KEEPS_MAX) {
            capped = new JSONArray();
            for (int i = 0; i < KEEPS_MAX; i++) capped.put(items.opt(i));
        }
        String before = keeps == null ? null : keeps.toString();
        keeps = capped;
        if (capped != null && !capped.toString().equals(before)) {
            keepsDirty = true;
            keepsChangedAt = clock.getAsLong();
            // Not left for the next poll (a long poll can hold 20 s): sent once it has been still.
            java.util.concurrent.ScheduledExecutorService ex = sender;
            if (ex != null) {
                try { ex.schedule(this::sendKeepsIfDirty, KEEPS_DEBOUNCE_MS + 100, java.util.concurrent.TimeUnit.MILLISECONDS); }
                catch (java.util.concurrent.RejectedExecutionException stopped) { /* stopping */ }
            }
        }
    }

    /**
     * Whether the kept list goes out now: a change once it has been still for 5 s (and not
     * more than once in 5 s), and the whole list again at most once a minute with the polls,
     * so the web's view heals after a lost report.
     */
    static boolean keepsDue(boolean dirty, long changedAt, long sentAt, long now, boolean any) {
        if (!any) return false;
        if (dirty) return now - changedAt >= KEEPS_DEBOUNCE_MS && now - sentAt >= KEEPS_DEBOUNCE_MS;
        return now - sentAt >= KEEPS_EVERY_MS;
    }

    /** The poll URL: wait, this install, its model. */
    String pollUrl() { return pollUrl(WAIT_S, false); }

    /**
     * The poll URL. {@code background}: the app is closed and its job checks in (wait 0,
     * background=1): home hands over keeps but does not count the phone as listening.
     */
    String pollUrl(int waitS, boolean background) {
        return url.apply("/api/v1/device/" + deviceId + "/commands?wait=" + waitS + (background ? "&background=1" : "")
                + "&installId=" + ContentPath.encode(installId) + "&model=" + ContentPath.encode(model));
    }

    Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        String t = token == null ? null : token.get();
        if (t != null && !t.isEmpty()) h.put("Authorization", "Bearer " + t);
        return h;
    }

    private void loop() {
        long backoff = MIN_BACKOFF_MS;
        while (running) {
            long wait;
            try {
                pollOnce();
                backoff = MIN_BACKOFF_MS;
                continue;
            } catch (Unauthorized refused) {
                status = "unauthorized";
                wait = UNAUTHORIZED_WAIT_MS;
            } catch (NotServed none) {
                status = "not served";
                wait = UNAUTHORIZED_WAIT_MS;
            } catch (Exception failed) {
                status = "unreachable";
                if (reach != null) reach.reached(false);
                wait = backoff;
                backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
            }
            if (!running) return;
            try { sleeper.sleep(wait); } catch (InterruptedException stopped) { return; }
        }
    }

    /** Home answered, and has no inbox for this device id (or refused the request): wait, without calling home down. */
    static final class NotServed extends java.io.IOException {
        NotServed(int status) { super("inbox not served: " + status); }
    }

    static final class Unauthorized extends java.io.IOException {
        Unauthorized(int status) { super("inbox refused the token: " + status); }
    }

    /** One poll, its commands handled, and the kept list sent when it changed. */
    void pollOnce() throws Exception { poll(WAIT_S, false); }

    /**
     * The app closed: one check from the background job (every 15 min). It asks without
     * waiting, handles what was queued (keeps, removes; a play is only queued while the phone
     * is listening, so none should be here), and sends the kept list if one is known, so the
     * web sees the phone check in. Throws what a poll throws; the job just tries next time.
     */
    void checkOnce() throws Exception {
        if (!validDevice(deviceId)) return;
        if (keeps != null) keepsDirty = true;
        keepsChangedAt = Math.min(keepsChangedAt, clock.getAsLong() - KEEPS_DEBOUNCE_MS);
        keepsSentAt = Math.min(keepsSentAt, clock.getAsLong() - KEEPS_DEBOUNCE_MS);
        poll(0, true);
    }

    private void poll(int waitS, boolean background) throws Exception {
        sendKeepsIfDirty();
        Http.Reply r = http.get(pollUrl(waitS, background), headers());
        if (r.status == 401 || r.status == 403) {
            refusedBecause = reasonOf(r.body);
            throw new Unauthorized(r.status);
        }
        refusedBecause = "";
        // Home answered: not "down", whatever it said. A 4xx (no inbox for this device id, as
        // for an emulator on a backend without one) waits long; a 5xx is home in trouble.
        if (r.status >= 400 && r.status < 500) {
            if (reach != null) reach.reached(true);
            throw new NotServed(r.status);
        }
        if (!r.ok()) throw new java.io.IOException("commands answered " + r.status);
        status = "polling";
        if (reach != null) reach.reached(true);
        if (r.status == 200 && !r.body.isEmpty()) {
            JSONArray commands = new JSONObject(r.body).optJSONArray("commands");
            for (int i = 0; commands != null && i < commands.length(); i++) handle(commands.optJSONObject(i));
        }
        sendKeepsIfDirty();
    }

    synchronized void sendKeepsIfDirty() {
        long now = clock.getAsLong();
        JSONArray items = keeps;
        if (!keepsDue(keepsDirty, keepsChangedAt, keepsSentAt, now, items != null)) return;
        try {
            JSONObject body = new JSONObject().put("installId", installId).put("items", items);
            Http.Reply r = http.postJson(url.apply("/api/v1/device/" + deviceId + "/keeps"), body.toString(), headers());
            keepsSentAt = now;
            // Accepted, or a backend without the route (404): either way this list is said.
            if (r.ok() || r.status == 404) { if (keeps == items) keepsDirty = false; }
            if (r.status == 401 || r.status == 403) refusedBecause = reasonOf(r.body);
        } catch (Exception later) {
            // Sent on a later poll.
        }
    }

    /** The backend's reason for a refused token (details[0]: no_token, wrong_token, …); never the token. */
    static String reasonOf(String body) {
        try {
            JSONObject o = new JSONObject(body);
            JSONArray d = o.optJSONArray("details");
            String r = d != null && d.length() > 0 ? d.optString(0) : o.optString("code", "");
            return r.matches("[a-z_]{1,40}") || r.matches("[A-Z_]{1,40}") ? r : "";
        } catch (Exception notJson) {
            return "";
        }
    }

    /** One command: done here (and said so), or refused with a reason. Never thrown. */
    void handle(JSONObject command) {
        if (command == null) return;
        String commandId = command.optString("commandId", command.optString("dispatchId", ""));
        String addressed = command.optString("installId", "");
        String kind = command.optString("command", "");
        boolean ok = false;
        String error = null, appliedAs = null;
        String contentId = contentIdOf(command);
        if (!addressed.isEmpty() && !addressed.equals(installId)) {
            error = "wrong_install";
        } else if ("keep".equals(kind) || "unkeep".equals(kind)) {
            if (!ContentId.valid(contentId)) error = "unsupported";
            else if (keeper == null) error = "unsupported";
            else {
                try {
                    JSONObject params = command.optJSONObject("params");
                    String title = Json.first(params == null ? "" : params.optString("title", ""), command.optString("title", ""));
                    if ("keep".equals(kind)) keeper.keep(contentId, title);
                    else keeper.unkeep(contentId);
                    ok = true;
                    appliedAs = kind;
                } catch (Exception refused) {
                    String m = refused.getMessage();
                    error = m == null || m.isEmpty() || m.length() > 60 ? "could_not_keep" : m;
                }
            }
        } else {
            String mediaId = mediaIdOf(command);
            if (mediaId == null) {
                error = "unsupported";
            } else {
                try { play.accept(mediaId); ok = true; }
                catch (RuntimeException refused) { error = "could_not_play"; }
            }
        }
        if (commandId.isEmpty()) return;
        try {
            JSONObject ack = new JSONObject().put("commandId", commandId).put("ok", ok).put("installId", installId);
            if (error != null) ack.put("error", error);
            if (appliedAs != null) ack.put("appliedAs", appliedAs);
            if (ok && appliedAs == null) ack.put("state", new JSONObject().put("contentId", contentId).put("playing", true)
                    .put("title", command.optString("title", "")));
            http.postJson(url.apply("/api/v1/device/" + deviceId + "/ack"), ack.toString(), headers());
        } catch (Exception unsent) {
            // The backend's own timeout reports it as not confirmed; a keep stays queued there.
        }
    }

    /**
     * The media id a command asks for: "c:&lt;content id&gt;", through the backend's queue route,
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
