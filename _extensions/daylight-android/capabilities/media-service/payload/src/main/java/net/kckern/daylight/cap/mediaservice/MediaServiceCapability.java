package net.kckern.daylight.cap.mediaservice;

import android.content.Context;
import android.content.Intent;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.BackendHttp;
import net.kckern.daylight.core.spi.ActionList;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.MediaPinner;
import net.kckern.daylight.core.spi.ShortcutPinner;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.LongSupplier;

/**
 * Every decision about native playback: what the browse tree holds, which stream a
 * media id resolves to, and when progress is reported. The player and the library
 * session are installed code (the shell half); they ask here through the "media"
 * PayloadPort, in process, and hand back nothing but media ids.
 *
 * What can be played is household media and nothing else: an id is asked of the
 * backend's own routes and a stream is the URL in the backend's answer, on the
 * backend's origin. No link, intent or browse request carries a URL that is played.
 *
 * Nothing about what is played is written to a log: the status holds a time, a count
 * and a route's status code.
 */
public final class MediaServiceCapability implements Capability {
    /** The PayloadPort the installed media service calls. The shell half spells the same name (PayloadMedia.PORT). */
    static final String PORT = "media";
    static final String WORKER = "Daylight-media";
    private static final String PLAY_ACTIVITY = "net.kckern.daylight.cap.mediaservice.shell.PlayActivity";
    private static final String NOW_PLAYING_ACTIVITY = "net.kckern.daylight.cap.mediaservice.shell.NowPlayingActivity";
    private static final String ROOTS = "media.roots";
    private static final String RECENT_LIMIT = "media.recentLimit";
    private static final String PAGE_SIZE = "media.pageSize";
    /** How a screen's notes name this device when it pauses or skips there: "Paused by Phone". */
    static final String REMOTE_NAME = "media.remoteName";
    /** A level is asked for again after this long; until then it is served from memory. */
    private static final long FRESH_MS = 60_000;

    /** Starts the installed play screen for one media id. */
    interface Launcher {
        void play(String mediaId);
        /** Opens the player screen on a target: "local", a screen's device id, or "" for the last one used. */
        default void nowPlaying(String target) { }
    }

    /** An answer for the port and for a route: the body, and the status a route gives it. */
    static final class Outcome {
        final int status;
        final JSONObject body;
        Outcome(int status, JSONObject body) { this.status = status; this.body = body; }
    }

    /** Where the pins go for the installed service to read. Replaced in tests. */
    interface PinCache { void write(String json); }

    static final String PINS = "media.controllerPins";
    volatile PinCache pinCache;
    private volatile boolean started;

    private CoreContext core;
    private Backend backend;
    private MediaApi api;
    /** The phone as a screen's remote. Replaced in tests. */
    ScreenRemote screens;
    private LongSupplier clock;
    private Launcher launcher;
    private volatile ExecutorService worker;
    private final ProgressReporter reporter = new ProgressReporter();
    private final BrowseCache cache = new BrowseCache(64, FRESH_MS);
    private final PayloadPort port = PayloadPort.named(PORT);
    private final PayloadPort.Handler onCall = request -> {
        JSONObject parsed;
        try { parsed = new JSONObject(request); }
        catch (Exception notJson) { return failure(400, "bad_request").body.toString(); }
        return call(parsed).body.toString();
    };
    private volatile long lastReportAtMs;
    private volatile String lastError = "";
    private volatile int reportsSent;

    public MediaServiceCapability() { }

    MediaServiceCapability(MediaApi api, LongSupplier clock, Launcher launcher) {
        this.api = api;
        this.clock = clock;
        this.launcher = launcher;
    }

    @Override public String name() { return "media-service"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        this.backend = Backend.from(core);
        BackendHttp http = new BackendHttp(backend::deviceHeader);
        if (api == null) api = new BackendMediaApi(backend, http);
        if (screens == null) screens = new ScreenRemote(http, backend::url, () -> (String) core.settings().get(REMOTE_NAME));
        if (clock == null) clock = System::currentTimeMillis;
        // The tabs a car shows: "Label=target;Label=target", a target being recent,
        // catalog or a container's content id.
        core.settings().declare(ROOTS, SettingsRegistry.Type.STRING, "Recent=recent;Browse=catalog",
                value -> BrowseTree.rootsProblem((String) value));
        core.settings().declare(RECENT_LIMIT, SettingsRegistry.Type.INTEGER, 30, SettingsRegistry.range(1, 100));
        // How many entries one browse level holds. A car limits what it shows per level.
        core.settings().declare(PAGE_SIZE, SettingsRegistry.Type.INTEGER, 50, SettingsRegistry.range(10, 200));
        core.settings().declare(REMOTE_NAME, SettingsRegistry.Type.STRING, "Phone",
                value -> ((String) value).length() > 80 ? "media.remoteName: at most 80 characters" : null);
        // The apps that may connect to the media session beside this app and the system:
        // "package=sha256 of its signing certificate", comma-separated. Empty: none. The
        // installed service refuses a package with no pin and logs its digest.
        core.settings().declare(PINS, SettingsRegistry.Type.STRING, "", value -> ControllerPinList.problem((String) value));
        core.settings().onChange(key -> { if (PINS.equals(key) && started) writePins(); });

        core.services().provide(LinkHandler.class, new LinkHandler() {
            @Override public String kind() { return "media"; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                // Only the id is read, and only as a content id: never a URL, never a media id
                // of the tree. The link reached here carrying this install's key.
                if ("now-playing".equals(arg)) {
                    // The player screen (media/now-playing?target=<local|device id>). The target is
                    // only ever a device id of the registry's spelling; the screen asks the payload
                    // which screens exist.
                    String target = query.get("target") == null ? "" : query.get("target");
                    if (!target.isEmpty() && !"local".equals(target) && !ScreenRemote.ID.matcher(target).matches()) {
                        throw new IllegalArgumentException("expected media/now-playing?target=<local or a device id>");
                    }
                    Launcher l = launcher();
                    if (l == null) return LinkEffect.toast("Not available on this device");
                    l.nowPlaying(target);
                    return LinkEffect.none();
                }
                String id = query.get("id");
                if (!"play".equals(arg) || !ContentId.valid(id)) throw new IllegalArgumentException("expected media/play?id=<content id>");
                Launcher l = launcher();
                if (l == null) return LinkEffect.toast("Not available on this device");
                if (!backend.configured()) return LinkEffect.refused("not_configured", "The address of the household site is not set");
                l.play(MediaId.leaf(id, null));
                return LinkEffect.none();
            }
        });

        // Pinning at a page's request (the page bridge's pinMedia): the content id is held
        // to this capability's rule, then the shortcuts record and pin it.
        core.services().provide(MediaPinner.class, new MediaPinner() {
            @Override public boolean canPin() {
                ShortcutPinner shortcuts = core.services().find(ShortcutPinner.class);
                try { return shortcuts != null && shortcuts.canPin(); } catch (RuntimeException e) { return false; }
            }
            @Override public JSONObject pin(String contentId, String label) { return pinMedia(contentId, label); }
        });

        core.router().route("GET", "/media/browse", req -> respond(call(new JSONObject().put("op", "browse")
                .put("parent", Replies.strParam(req, "parent", MediaId.ROOT))
                .put("page", Requests.intQuery(req, "page", 0, 0, Integer.MAX_VALUE)))));
        core.router().route("POST", "/media/resolve", req -> respond(call(Requests.body(req).put("op", "resolve"))));
        core.router().route("POST", "/media/event", req -> respond(call(Requests.body(req).put("op", "event"))));
        core.router().route("GET", "/media/status", req -> Router.Response.json(200, Replies.ok()
                .put("lastReportAtMs", lastReportAtMs).put("lastError", lastError).put("reports", reportsSent)
                .put("problems", new JSONArray(problems()))));
    }

    /**
     * Never throws on a setting: what is wrong is in GET /media/status and noted once.
     * The port needs no Android context, so it is attached in a JVM test of the whole
     * payload too.
     */
    @Override public void start() {
        worker = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, WORKER);
            t.setDaemon(true);
            return t;
        });
        for (String problem : problems()) core.shell().note("MEDIA", problem);
        started = true;
        writePins();
        port.attach(onCall);
    }

    /** The installed service reads the pins from the surface cache: it may run with no payload loaded. */
    private void writePins() {
        try {
            PinCache c = pinCache;
            if (c == null) {
                final Object context = core.shell().context();
                if (context == null) return;
                c = json -> {
                    android.content.SharedPreferences prefs = ((Context) context).getSharedPreferences(
                            net.kckern.daylight.api.SurfaceKeys.PREFS, Context.MODE_PRIVATE);
                    if (prefs != null) prefs.edit().putString(PINS, json).apply();
                };
                pinCache = c;
            }
            c.write(ControllerPinList.cacheJson((String) core.settings().get(PINS)));
        } catch (RuntimeException e) {
            core.shell().note("MEDIA", "could not hand the controller pins to the media service: " + e.getClass().getSimpleName());
        }
    }

    /** May be called twice. Detaches only this payload's handler: a successor may already be attached. */
    @Override public void stop() {
        started = false;
        port.detach(onCall);
        ExecutorService w = worker;
        worker = null;
        if (w != null) w.shutdownNow();
    }

    /**
     * The waveform (and quality) or the lyrics of one track, for Now playing. {ok, none:true}
     * when the backend has none, so a screen leaves the strip or the button out rather than
     * showing an error. Only content ids are accepted: the id becomes path segments.
     */
    private Outcome trackDetail(JSONObject request, boolean levels) throws Exception {
        String id = Json.str(request, "id");
        if (!ContentId.valid(id)) return failure(400, "bad_request");
        int samples = Math.max(16, Math.min(400, request.optInt("samples", 120)));
        try {
            JSONObject found = levels ? api.levels(id, samples) : api.lyrics(id);
            if (found == null) return new Outcome(200, Replies.ok().put("none", true));
            return new Outcome(200, Replies.ok().put(levels ? "levels" : "lyrics", found));
        } catch (MediaApi.Refused refused) {
            // An older backend without the route answers 404: the same as having none.
            if (refused.status == 404) return new Outcome(200, Replies.ok().put("none", true));
            throw refused;
        }
    }

    // ── the one entry for the port and the routes ─────────────────────────────

    Outcome call(JSONObject request) {
        try {
            String op = Json.str(request, "op");
            if ("playlistSources".equals(op)) {
                return new Outcome(200, Replies.ok().put("items", api.audioSources().getJSONArray("items")));
            }
            if ("playlists".equals(op)) return playlists(request);
            if ("browse".equals(op)) return browse(request);
            if ("resolve".equals(op)) return resolve(request);
            if ("event".equals(op)) return event(request);
            if ("action".equals(op)) return action(request);
            if ("search".equals(op)) return search(request);
            if ("continue".equals(op)) {
                return new Outcome(200, Replies.ok().put("items",
                        BrowseTree.continueItems(api.recent(50), backend, Math.max(1, Math.min(20, request.optInt("limit", 8))))));
            }
            if ("track-levels".equals(op)) return trackDetail(request, true);
            if ("track-lyrics".equals(op)) return trackDetail(request, false);
            if ("screens".equals(op)) return new Outcome(200, screens.screens());
            if ("screen-session".equals(op)) return new Outcome(200, screens.session(Json.str(request, "device")));
            if ("screen-command".equals(op)) return new Outcome(200, screens.command(request));
            return failure(400, "bad_request");
        } catch (IllegalArgumentException refused) {
            return failure(400, "bad_request");
        } catch (MediaApi.Refused answered) {
            return answered.status == 404 ? failure(404, "not_found") : failure(502, "backend_refused");
        } catch (IllegalStateException notConfigured) {
            return failure(503, "not_configured");
        } catch (Exception unreachable) {
            return failure(502, "unreachable");
        }
    }

    private static Outcome failure(int status, String code) {
        return new Outcome(status, Replies.err(code));
    }

    private static Router.Response respond(Outcome o) { return Router.Response.json(o.status, o.body); }

    private Outcome playlists(JSONObject request) throws Exception {
        final int offset = request.optInt("cursor", 0);
        if (offset < 0 || offset > MediaId.MAX_SKIP) throw new IllegalArgumentException("invalid playlist page");
        String source = Json.str(request, "source");
        if (!ContentId.valid(source)) throw new IllegalArgumentException("unknown list source");
        JSONObject result = api.audioLists(source, offset);
        JSONArray entries = result.getJSONArray("items");
        JSONArray playlists = new JSONArray();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject item = entries.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("id");
            String title = item.optString("title");
            if (ContentId.valid(id) && !title.trim().isEmpty()) {
                JSONObject playlist = new JSONObject().put("contentId", id).put("title", title);
                String art = BrowseTree.art(backend, Json.str(item, "thumbnail"));
                if (art != null) playlist.put("thumbnail", art);
                playlists.put(playlist);
            }
        }
        JSONObject response = Replies.ok().put("items", playlists);
        int next = result.optInt("nextCursor", -1);
        if (next > offset && next <= MediaId.MAX_SKIP) response.put("nextCursor", next);
        return new Outcome(200, response);
    }

    private Outcome browse(JSONObject request) throws Exception {
        final String parent = Json.first(Json.str(request, "parent"), MediaId.ROOT);
        final MediaId id = MediaId.parse(parent);
        if (id.kind == MediaId.Kind.LEAF) throw new IllegalArgumentException("unknown media id");
        final int pageSize = (Integer) core.settings().get(PAGE_SIZE);
        List<MediaNode> nodes;
        // A level is one page and, in a long container, an entry that leads to the next.
        // A browser's own paging has nothing further to show.
        if (request.optInt("page", 0) > 0) {
            nodes = new ArrayList<>();
        } else if (id.kind == MediaId.Kind.ROOT) {
            nodes = BrowseTree.roots((String) core.settings().get(ROOTS));
        } else {
            nodes = cache.get(parent, clock.getAsLong(), () -> load(id, pageSize));
        }
        JSONArray items = new JSONArray();
        for (MediaNode n : nodes) items.put(n.toJson());
        return new Outcome(200, Replies.ok().put("parent", parent).put("items", items));
    }

    private List<MediaNode> load(MediaId id, int pageSize) throws Exception {
        List<MediaNode> nodes;
        if (id.kind == MediaId.Kind.CONTINUE) {
            nodes = BrowseTree.continueNodes(api.recent(50), backend, recentLists().list());
        } else if (id.kind == MediaId.Kind.RECENT) {
            nodes = BrowseTree.fromRecent(api.recent((Integer) core.settings().get(RECENT_LIMIT)), backend);
        } else if (id.kind == MediaId.Kind.CATALOG) {
            nodes = BrowseTree.fromAudioListCatalog(api.rootList(), "", 0, backend);
            nodes.add(new MediaNode(MediaId.container("audio-lists:"), "All playlists", "", null, true, false));
        } else if ("audio-lists:".equals(id.contentId)) {
            return BrowseTree.audioListSources(api.audioSources());
        } else if (id.kind == MediaId.Kind.AUDIO_SOURCE) {
            return BrowseTree.fromAudioListCatalog(api.audioLists(id.contentId, id.skip), id.contentId, id.skip, backend);
        } else if (id.kind == MediaId.Kind.AUDIO_LIST) {
            return BrowseTree.fromAudioQueue(api.queue(id.contentId), id.contentId, id.skip, pageSize, backend);
        } else {
            return BrowseTree.paged(BrowseTree.fromList(api.list(id.contentId, pageSize, id.skip), id.contentId, backend),
                    id.contentId, id.skip, pageSize);
        }
        return nodes.size() > pageSize ? new ArrayList<>(nodes.subList(0, pageSize)) : nodes;
    }

    private Outcome resolve(JSONObject request) throws Exception {
        JSONArray ids = request.optJSONArray("ids");
        if (ids == null || ids.length() == 0) throw new IllegalArgumentException("body needs 'ids'");
        List<String> mediaIds = new ArrayList<>();
        for (int i = 0; i < ids.length(); i++) {
            Object id = ids.opt(i);
            mediaIds.add(id instanceof String ? (String) id : null);
        }
        Resolver.Resolved r = Resolver.resolve(mediaIds, request.optInt("startIndex", -1), request.optBoolean("explicitPosition"),
                api, backend, "daylight-" + core.deviceId(), request.optBoolean("shuffle"));
        JSONArray tracks = new JSONArray();
        for (Track t : r.tracks) tracks.put(t.toJson());
        String first = mediaIds.isEmpty() ? null : mediaIds.get(0);
        if (first != null && first.startsWith("c:") && !r.tracks.isEmpty()) rememberList(first.substring(2));
        return new Outcome(200, Replies.ok().put("tracks", tracks).put("startIndex", r.startIndex)
                .put("startPositionMs", r.startPositionMs).put("selectionResolved", r.selectionResolved));
    }

    private RecentLists recentLists;
    private final java.util.concurrent.ExecutorService listNamer = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "daylight-recent-lists");
        t.setDaemon(true);
        return t;
    });

    /** The lists played lately, kept with the payload's state; in memory only where there is none (tests). */
    synchronized RecentLists recentLists() {
        if (recentLists != null) return recentLists;
        java.io.File dir = null;
        try {
            Object payloadDir = core == null ? null : core.shell().payloadDir();
            if (payloadDir instanceof java.io.File) dir = net.kckern.daylight.api.PayloadState.dir((java.io.File) payloadDir);
        } catch (RuntimeException none) { /* no state dir */ }
        if (dir == null) {
            try { dir = java.nio.file.Files.createTempDirectory("recent-lists").toFile(); }
            catch (java.io.IOException e) { dir = new java.io.File(System.getProperty("java.io.tmpdir")); }
        }
        recentLists = new RecentLists(new java.io.File(dir, "recent-lists.json"));
        return recentLists;
    }

    /** A list started playing: name it (its title and cover from the list route) and remember it, off the play path. */
    private void rememberList(String contentId) {
        if (!ContentId.valid(contentId)) return;
        listNamer.execute(() -> {
            try {
                JSONObject l = api.list(contentId, 1, 0);
                recentLists().record(contentId, Json.first(Json.str(l, "title"), Json.str(l, "label")),
                        BrowseTree.art(backend, Json.str(l, "image")), clock.getAsLong());
            } catch (Exception unnamed) { /* not remembered this time */ }
        });
    }

    /**
     * The installed play service was started by a tap on a widget or a tile and holds an
     * action id, nothing else. The answer is the media id of the content that action is
     * configured (or pinned) to play, or 404. Content never arrives from the tap.
     */
    private Outcome action(JSONObject request) throws Exception {
        String id = Json.str(request, "action");
        if (!net.kckern.daylight.api.SurfaceKeys.actionId(id)) throw new IllegalArgumentException("action needs an action id");
        ActionList actions = core.services().find(ActionList.class);
        String contentId = actions == null ? null : actions.mediaContentId(id);
        if (!ContentId.valid(contentId)) return failure(404, "unknown_action");
        return new Outcome(200, Replies.ok().put("mediaId", MediaId.leaf(contentId, null)));
    }

    /**
     * A car's voice search (the library session's onSearch). The query is cut and
     * cleaned (BrowseTree.searchText) and sent as one encoded parameter; an empty one
     * answers the recent list. The answer is browse entries, at most media.pageSize, and
     * "best": what "play <query>" plays. The query is never noted or logged; it is kept
     * for a minute as the key of the answer in memory, as a browse level is.
     */
    private Outcome search(JSONObject request) throws Exception {
        Object raw = request.opt("query");
        if (raw != null && raw != JSONObject.NULL && !(raw instanceof String)) throw new IllegalArgumentException("query must be text");
        final String text = BrowseTree.searchText(raw instanceof String ? (String) raw : "");
        final int pageSize = (Integer) core.settings().get(PAGE_SIZE);
        List<MediaNode> nodes;
        if (text.isEmpty()) {
            nodes = cache.get(MediaId.RECENT, clock.getAsLong(), () -> load(MediaId.parse(MediaId.RECENT), pageSize));
        } else {
            nodes = cache.get("s|" + text, clock.getAsLong(), () -> BrowseTree.fromSearch(api.search(text, pageSize), backend, pageSize));
        }
        if (nodes.size() > pageSize) nodes = new ArrayList<>(nodes.subList(0, pageSize));
        JSONArray items = new JSONArray();
        for (MediaNode n : nodes) items.put(n.toJson());
        JSONObject body = Replies.ok().put("items", items);
        String best = BrowseTree.best(nodes);
        if (best != null) body.put("best", best);
        return new Outcome(200, body);
    }

    /** {accepted, reason?} and nothing else, whatever the shortcuts answered. */
    private JSONObject pinMedia(String contentId, String label) {
        String reason = PinRequest.problem(contentId, label);
        if (reason == null) {
            ShortcutPinner shortcuts = core.services().find(ShortcutPinner.class);
            if (shortcuts == null) {
                reason = "not_available";
            } else {
                try {
                    JSONObject answer = shortcuts.pinMedia(contentId, PinRequest.label(label));
                    if (answer != null && answer.optBoolean("accepted", false)) return pinAnswer(true, null);
                    reason = answer == null ? "failed" : answer.optString("reason", "failed");
                } catch (Exception e) {
                    reason = "failed";
                }
            }
        }
        // The reason of a refusal is one of a fixed set of words; anything else is "failed".
        if (!reason.matches("[a-z_]{1,32}")) reason = "failed";
        core.shell().note("MEDIA", "pin request refused: " + reason);
        return pinAnswer(false, reason);
    }

    private static JSONObject pinAnswer(boolean accepted, String reason) {
        JSONObject o = new JSONObject();
        try {
            o.put("accepted", accepted);
            if (reason != null) o.put("reason", reason);
        } catch (Exception impossible) {
            // put of a boolean and a string does not fail
        }
        return o;
    }

    private Outcome event(JSONObject e) throws Exception {
        String id = Json.str(e, "id");
        if (!ContentId.valid(id)) throw new IllegalArgumentException("event needs 'id'");
        List<ProgressReporter.Report> reports = reporter.onEvent(id, Json.str(e, "title"), Json.str(e, "listId"),
                e.optLong("positionMs", 0), e.optLong("durationMs", 0), Json.str(e, "state"), clock.getAsLong());
        for (ProgressReporter.Report report : reports) send(report);
        return new Outcome(200, Replies.ok().put("reports", reports.size()));
    }

    /**
     * Off the caller's thread once started. A report that fails is noted in the status
     * and dropped: the next one carries a later position.
     */
    private void send(final ProgressReporter.Report report) {
        Runnable job = () -> {
            try {
                api.log(report.toBody());
                lastReportAtMs = clock.getAsLong();
                lastError = "";
                reportsSent++;
            } catch (MediaApi.Refused answered) {
                lastError = answered.getMessage();          // a route and a status code
            } catch (IllegalStateException notConfigured) {
                lastError = "the household site is not set";
            } catch (Exception unreachable) {
                lastError = "no connection";
            }
        };
        ExecutorService w = worker;
        if (w == null) { job.run(); return; }
        try { w.execute(job); } catch (RuntimeException stopping) { /* the payload is stopping */ }
    }

    private List<String> problems() {
        List<String> out = new ArrayList<>();
        if (!backend.configured()) out.add("the household site is not set");
        String roots = BrowseTree.rootsProblem((String) core.settings().get(ROOTS));
        if (roots != null) out.add(ROOTS + " " + roots);
        return out;
    }

    private Launcher launcher() {
        if (launcher == null) {
            final Object context = core.shell().context();
            // A JVM test of the whole payload has no Android context: there is no player.
            if (context == null) return null;
            launcher = new Launcher() {
                @Override public void play(String mediaId) {
                    Context c = (Context) context;
                    // By name: the play screen is installed code in this capability's shell half.
                    // It is not exported, so only this app can start it. Started while the link
                    // activity is on screen, which is what lets a service context start one.
                    c.startActivity(new Intent().setClassName(c, PLAY_ACTIVITY).putExtra("id", mediaId)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }

                @Override public void nowPlaying(String target) {
                    Context c = (Context) context;
                    c.startActivity(new Intent().setClassName(c, NOW_PLAYING_ACTIVITY).putExtra("target", target)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
                }
            };
        }
        return launcher;
    }
}
