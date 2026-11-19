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
    private static final String ROOTS = "media.roots";
    private static final String RECENT_LIMIT = "media.recentLimit";
    private static final String PAGE_SIZE = "media.pageSize";
    /** A level is asked for again after this long; until then it is served from memory. */
    private static final long FRESH_MS = 60_000;

    /** Starts the installed play screen for one media id. */
    interface Launcher { void play(String mediaId); }

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
        if (api == null) api = new BackendMediaApi(backend, new BackendHttp(backend::deviceHeader));
        if (clock == null) clock = System::currentTimeMillis;
        // The tabs a car shows: "Label=target;Label=target", a target being recent,
        // catalog or a container's content id.
        core.settings().declare(ROOTS, SettingsRegistry.Type.STRING, "Recent=recent;Browse=catalog",
                value -> BrowseTree.rootsProblem((String) value));
        core.settings().declare(RECENT_LIMIT, SettingsRegistry.Type.INTEGER, 30, SettingsRegistry.range(1, 100));
        // How many entries one browse level holds. A car limits what it shows per level.
        core.settings().declare(PAGE_SIZE, SettingsRegistry.Type.INTEGER, 50, SettingsRegistry.range(10, 200));
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

    // ── the one entry for the port and the routes ─────────────────────────────

    Outcome call(JSONObject request) {
        try {
            String op = Json.str(request, "op");
            if ("browse".equals(op)) return browse(request);
            if ("resolve".equals(op)) return resolve(request);
            if ("event".equals(op)) return event(request);
            if ("action".equals(op)) return action(request);
            if ("search".equals(op)) return search(request);
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
        if (id.kind == MediaId.Kind.RECENT) {
            nodes = BrowseTree.fromRecent(api.recent((Integer) core.settings().get(RECENT_LIMIT)), backend);
        } else if (id.kind == MediaId.Kind.CATALOG) {
            nodes = BrowseTree.fromList(api.rootList(), null, backend).nodes;
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
                api, backend, "daylight-" + core.deviceId());
        JSONArray tracks = new JSONArray();
        for (Track t : r.tracks) tracks.put(t.toJson());
        return new Outcome(200, Replies.ok().put("tracks", tracks).put("startIndex", r.startIndex)
                .put("startPositionMs", r.startPositionMs).put("selectionResolved", r.selectionResolved));
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
            launcher = mediaId -> {
                Context c = (Context) context;
                // By name: the play screen is installed code in this capability's shell half.
                // It is not exported, so only this app can start it. Started while the link
                // activity is on screen, which is what lets a service context start one.
                c.startActivity(new Intent().setClassName(c, PLAY_ACTIVITY).putExtra("id", mediaId)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            };
        }
        return launcher;
    }
}
