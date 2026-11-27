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
    private static final String BROWSE_ACTIVITY = "net.kckern.daylight.cap.mediaservice.shell.BrowseActivity";
    private static final String NOW_PLAYING_ACTIVITY = "net.kckern.daylight.cap.mediaservice.shell.NowPlayingActivity";
    private static final String ROOTS = "media.roots";
    /** Whether this device takes "Play on" from the household's web (the phone: long-polls the backend). */
    static final String PLAY_ON_TARGET = "media.playOnTarget";
    /** Downloads kept on this phone: the most they may take (MB; 0 for no cap), and whether mobile data may be used. */
    static final String DOWNLOAD_CAP_MB = "media.downloadCapMb";
    /** Crossfade between songs on this phone, seconds (0 = off): the household default; the person's choice in Now playing wins. */
    static final String CROSSFADE_SEC = "media.crossfadeSec";
    static final String DOWNLOAD_ON_CELLULAR = "media.downloadOnCellular";
    /** A kept book is removed a day after it is finished (with Undo for a day). Off by default. */
    static final String REMOVE_FINISHED = "media.removeFinished";
    /** Where downloads are kept: internal, or sd (a removable card, when the phone has one). */
    static final String DOWNLOAD_LOCATION = "media.downloadLocation";
    /** Minutes from finished to removed with media.removeFinished (a day; shorter for a check). */
    static final String REMOVE_FINISHED_AFTER = "media.removeFinishedAfterMin";
    /** Kept automatically while you listen (spec §3.10): on by default; off removes nothing already kept. */
    static final String AUTO_KEEP = "media.autoKeep";
    /** Minutes of a long item heard on this phone before it is kept automatically. */
    static final String AUTO_KEEP_AFTER = "media.autoKeepAfterMin";
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
        /** Opens a page of the phone's library: a container media id, its kind and title. */
        default void browse(String mediaId, String kind, String title) { }
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
        // Media calls decide "is home there": a short connect timeout (captive Wi-Fi answers nothing).
        BackendHttp http = BackendHttp.fastConnect(backend::deviceHeader, CONNECT_MS);
        // Media calls (resolve, browse, progress) give up quickly both ways; the inbox's long poll
        // and the screen remote keep the ordinary read timeout.
        if (api == null) api = new BackendMediaApi(backend, BackendHttp.fast(backend::deviceHeader, CONNECT_MS, READ_MS_MEDIA));
        if (screens == null) screens = new ScreenRemote(http, backend::url, () -> (String) core.settings().get(REMOTE_NAME));
        if (clock == null) clock = System::currentTimeMillis;
        // The tabs a car shows: "Label=target;Label=target", a target being recent,
        // catalog or a container's content id.
        core.settings().declare(ROOTS, SettingsRegistry.Type.STRING, "Recent=recent;Browse=catalog",
                value -> BrowseTree.rootsProblem((String) value));
        core.settings().declare(RECENT_LIMIT, SettingsRegistry.Type.INTEGER, 30, SettingsRegistry.range(1, 100));
        // How many entries one browse level holds. A car limits what it shows per level.
        core.settings().declare(PAGE_SIZE, SettingsRegistry.Type.INTEGER, 50, SettingsRegistry.range(10, 200));
        core.settings().declare(PLAY_ON_TARGET, SettingsRegistry.Type.BOOLEAN, false, null);
        core.settings().declare(DOWNLOAD_CAP_MB, SettingsRegistry.Type.INTEGER, 4096, SettingsRegistry.range(0, 512_000));
        core.settings().declare(CROSSFADE_SEC, SettingsRegistry.Type.INTEGER, 4, SettingsRegistry.range(0, 12));
        core.settings().declare(DOWNLOAD_ON_CELLULAR, SettingsRegistry.Type.BOOLEAN, false, null);
        core.settings().declare(REMOVE_FINISHED, SettingsRegistry.Type.BOOLEAN, false, null);
        core.settings().declare(REMOVE_FINISHED_AFTER, SettingsRegistry.Type.INTEGER, 1440, SettingsRegistry.range(1, 100_000));
        core.settings().declare(AUTO_KEEP, SettingsRegistry.Type.BOOLEAN, true, null);
        core.settings().declare(AUTO_KEEP_AFTER, SettingsRegistry.Type.INTEGER, 10, SettingsRegistry.range(1, 600));
        core.settings().declare(DOWNLOAD_LOCATION, SettingsRegistry.Type.STRING, "internal",
                value -> "internal".equals(value) || "sd".equals(value) ? null : "media.downloadLocation: internal or sd");
        if (inbox == null) {
            boolean emulator = runningOnEmulator();
            inbox = new PlayInbox(http, backend::url, InboxIdentity.inboxDeviceId(core.deviceId(), emulator),
                    InboxIdentity.installId(stateDir()), InboxIdentity.model(buildModel()), this::inboxToken, mediaId -> {
                Launcher l = launcher();
                if (l == null) throw new IllegalStateException("no player");
                l.play(mediaId);
            }, new PlayInbox.Keeper() {
                @Override public void keep(String contentId, String title) throws Exception {
                    Outcome o = MediaServiceCapability.this.keep(new JSONObject().put("id", contentId));
                    if (o.status != 200) throw new IllegalStateException(o.body.optString("error", "could_not_keep"));
                    signalKeeper();
                }
                @Override public void unkeep(String contentId) {
                    // The web's Remove all on a kept artist or author (spec §3.11): the group goes.
                    if (kept().group(contentId) != null) kept().removeGroup(contentId, clock.getAsLong());
                    else kept().remove(contentId, clock.getAsLong());
                    signalKeeper();
                }
            }, answered -> { if (answered) health.answered(); else health.failed(clock.getAsLong()); });
        }
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
                    if (!target.isEmpty() && !"local".equals(target) && !ScreenRemote.ID.matcher(target).matches()
                            && !ScreenRemote.BROWSER.matcher(target).matches()) {
                        throw new IllegalArgumentException("expected media/now-playing?target=<local or a device id>");
                    }
                    Launcher l = launcher();
                    if (l == null) return LinkEffect.toast("Not available on this device");
                    l.nowPlaying(target);
                    return LinkEffect.none();
                }
                // media/<kind>/<content id>: the same as media/open?kind=&id= (spec's form).
                java.util.regex.Matcher alias = java.util.regex.Pattern.compile("(book|album|artist|playlist)/(.+)").matcher(arg == null ? "" : arg);
                if (alias.matches()) {
                    java.util.Map<String, String> q = new java.util.HashMap<>(query);
                    q.put("kind", alias.group(1));
                    q.put("id", alias.group(2));
                    query = q;
                    arg = "open";
                }
                if ("open".equals(arg)) {
                    // A page of the phone's library (media/open?kind=album&id=plex:123): a book,
                    // album, artist or playlist. The id is held to the content-id rule.
                    String kind = query.get("kind") == null ? "" : query.get("kind");
                    String cid = query.get("id");
                    if (!kind.matches("book|album|artist|playlist") || !ContentId.valid(cid)) {
                        throw new IllegalArgumentException("expected media/open?kind=<book|album|artist|playlist>&id=<content id>");
                    }
                    Launcher l = launcher();
                    if (l == null) return LinkEffect.toast("Not available on this device");
                    String title = query.get("title") == null ? "" : query.get("title");
                    l.browse(MediaId.container(cid), kind, title.length() > 120 ? title.substring(0, 120) : title);
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
        if (Boolean.TRUE.equals(core.settings().get(PLAY_ON_TARGET)) && inbox != null) {
            inbox.start();
            scheduleInboxJob();
            // Which inbox this install answers (an emulator never the phone's); never the token.
            core.shell().note("MEDIA", "inbox: polling as " + inbox.deviceId() + ", token " + (inboxToken().isEmpty() ? "absent" : "present"));
        }
        // Progress kept while offline goes out as soon as the payload runs with a backend.
        ExecutorService w0 = worker;
        if (w0 != null) w0.execute(this::flushPending);
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
        if (inbox != null) inbox.stop();
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

    /** Chapters answered this session, so a replay or a reopen of Now playing asks home once. */
    private final java.util.Map<String, JSONObject> chaptersSeen = java.util.Collections.synchronizedMap(
            new java.util.LinkedHashMap<String, JSONObject>(16, 0.75f, true) {
                @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, JSONObject> e) { return size() > 64; }
            });

    /**
     * One track's chapters for Now playing: {ok, chapters:{chapters, durationMs, provider}} or
     * {ok, none:true}. Home first; without home, the chapters kept with the track on this phone,
     * then the ones seen this session; never an error (spec: no chapters is just no chapter UI).
     */
    private Outcome trackChapters(JSONObject request) throws Exception {
        String id = Json.str(request, "id");
        if (!ContentId.valid(id)) return failure(400, "bad_request");
        JSONObject found = null;
        try {
            found = api.chapters(id);
            if (found != null) chaptersSeen.put(id, found);
            else return new Outcome(200, Replies.ok().put("none", true));
        } catch (MediaApi.Refused refused) {
            if (refused.status == 404) return new Outcome(200, Replies.ok().put("none", true));
            if (refused.status < 500) throw refused;
        } catch (java.io.IOException offline) {
            // fall through to what this phone holds
        }
        if (found == null) found = keptChapters(id);
        if (found == null) found = chaptersSeen.get(id);
        return new Outcome(200, found == null ? Replies.ok().put("none", true) : Replies.ok().put("chapters", found));
    }

    /** The chapters stored with a kept track, or null. */
    private JSONObject keptChapters(String trackId) {
        JSONObject holder = kept().holding(trackId);
        JSONArray tracks = holder == null ? null : holder.optJSONArray("tracks");
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null && trackId.equals(t.optString("id")) && t.optJSONObject("chapters") != null) return t.optJSONObject("chapters");
        }
        return null;
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
            if ("lookup".equals(op)) return lookup(request);
            if ("library".equals(op)) return library();
            if ("parents".equals(op)) {
                String cid = Json.str(request, "id");
                if (!ContentId.valid(cid)) return failure(400, "bad_request");
                return new Outcome(200, Replies.ok().put("parents", Lookup.parents(api.info(cid), kinds())));
            }
            if ("progress".equals(op)) {
                JSONArray ids = request.optJSONArray("ids");
                java.util.Set<String> want = new java.util.HashSet<>();
                for (int i = 0; ids != null && i < ids.length() && i < 500; i++) if (ContentId.valid(ids.optString(i))) want.add(ids.optString(i));
                return new Outcome(200, Replies.ok().put("progress", Lookup.progress(api.recent(200), want)));
            }
            if ("mark-finished".equals(op)) {
                JSONArray ids = request.optJSONArray("ids");
                boolean finished = request.optBoolean("finished", true);
                int done = 0;
                for (int i = 0; ids != null && i < ids.length() && i < 200; i++) {
                    String cid = ids.optString(i);
                    if (!ContentId.valid(cid)) continue;
                    api.markWatched(cid, finished);
                    done++;
                }
                return new Outcome(200, Replies.ok().put("marked", done));
            }
            if ("save-playlist".equals(op)) return savePlaylist(request);
            if ("keep".equals(op)) return keep(request);
            if ("kept".equals(op)) return keptList();
            if ("kept-finished".equals(op)) {
                JSONObject recent = api.recent(100);
                health.answered();
                return new Outcome(200, Replies.ok().put("finished", finishedBooks(kept().list(), recent)));
            }
            if ("kept-restore".equals(op)) {
                int groups = kept().restoreGroups(request.optJSONArray("groups"));
                return new Outcome(200, Replies.ok().put("restored", kept().restore(request.optJSONArray("items")))
                        .put("groupsRestored", groups));
            }
            if ("keeps-report".equals(op)) {
                if (inbox != null) inbox.reportKeeps(request.optJSONArray("items") == null ? new JSONArray() : request.optJSONArray("items"));
                return new Outcome(200, Replies.ok());
            }
            if ("inbox-once".equals(op)) {
                // The background job's check with the app closed (KeepJob.INBOX_ID, every 15 min).
                if (inbox == null || !Boolean.TRUE.equals(core.settings().get(PLAY_ON_TARGET))) {
                    return new Outcome(200, Replies.ok().put("status", "off"));
                }
                String result;
                try { inbox.checkOnce(); result = "checked"; }
                catch (PlayInbox.Unauthorized refused) { result = "unauthorized"; }
                catch (PlayInbox.NotServed none) { result = "not served"; }
                catch (Exception unreachable) { result = "unreachable"; health.failed(clock.getAsLong()); }
                core.shell().note("MEDIA", "inbox: background check " + result);
                return new Outcome(200, Replies.ok().put("status", result));
            }
            if ("inbox".equals(op)) {
                return new Outcome(200, Replies.ok().put("status", inbox == null ? "none" : inbox.status())
                        .put("deviceId", inbox == null ? "" : inbox.deviceId()).put("installId", inbox == null ? "" : inbox.installId())
                        .put("homeDown", health.down(clock.getAsLong())));
            }
            if ("playerRules".equals(op)) {
                return new Outcome(200, Replies.ok().put("crossfadeSec", (Integer) core.settings().get(CROSSFADE_SEC)));
            }
            if ("downloadRules".equals(op)) {
                return new Outcome(200, Replies.ok().put("capMb", (Integer) core.settings().get(DOWNLOAD_CAP_MB))
                        .put("onCellular", Boolean.TRUE.equals(core.settings().get(DOWNLOAD_ON_CELLULAR)))
                        .put("removeFinished", Boolean.TRUE.equals(core.settings().get(REMOVE_FINISHED)))
                        .put("removeFinishedAfterMin", (Integer) core.settings().get(REMOVE_FINISHED_AFTER))
                        .put("autoKeep", !Boolean.FALSE.equals(core.settings().get(AUTO_KEEP)))
                        .put("autoKeepAfterMin", (Integer) core.settings().get(AUTO_KEEP_AFTER))
                        .put("location", (String) core.settings().get(DOWNLOAD_LOCATION)));
            }
            if ("unkeep".equals(op)) {
                String id = Json.str(request, "id");
                if (!ContentId.valid(id)) return failure(400, "bad_request");
                JSONArray orphaned = new JSONArray();
                // From a group's row: the unit leaves the group (kept on its own too, it stays).
                boolean fromGroup = "group".equals(Json.str(request, "from"));
                boolean stays = fromGroup && kept().get(id) != null && kept().get(id).optBoolean("alone", false);
                for (String t : fromGroup ? kept().leaveGroup(id, clock.getAsLong()) : kept().remove(id, clock.getAsLong())) orphaned.put(t);
                return new Outcome(200, Replies.ok().put("orphaned", orphaned).put("stays", stays));
            }
            if ("group-preview".equals(op)) return groupPreview(request, false);
            if ("group-new".equals(op)) return groupPreview(request, true);
            if ("group-save".equals(op)) return groupSave(request);
            if ("group-remove".equals(op)) {
                String id = Json.str(request, "id");
                if (!GroupKeeps.validId(id)) return failure(400, "bad_request");
                int units = kept().unitsOf(id).size();
                JSONArray orphaned = new JSONArray();
                for (String t : kept().removeGroup(id, clock.getAsLong())) orphaned.put(t);
                return new Outcome(200, Replies.ok().put("orphaned", orphaned).put("units", units));
            }
            if ("continue".equals(op)) {
                int limit = Math.max(1, Math.min(20, request.optInt("limit", 8)));
                flushHides();
                // A hide home has not heard yet keeps its card away here (offline, or just tapped).
                JSONArray items = hides().filter(BrowseTree.continueItems(api.recent(50), backend, limit + 4));
                JSONArray cut = new JSONArray();
                for (int i = 0; i < items.length() && i < limit; i++) cut.put(items.get(i));
                health.answered();
                return new Outcome(200, Replies.ok().put("items", cut));
            }
            if ("continue-hide".equals(op)) return continueHide(request);
            if ("about".equals(op)) return about(request);
            if ("book-finished".equals(op)) return bookFinished(request);
            if ("track-levels".equals(op)) return trackDetail(request, true);
            if ("track-lyrics".equals(op)) return trackDetail(request, false);
            if ("track-chapters".equals(op)) return trackChapters(request);
            if ("screens".equals(op)) return new Outcome(200, ScreenRemote.without(screens.screens(), core.deviceId(), InboxIdentity.inboxDeviceId(core.deviceId(), runningOnEmulator())));
            if ("screen-session".equals(op)) return new Outcome(200, screens.session(Json.str(request, "device")));
            if ("screen-command".equals(op)) return new Outcome(200, screens.command(request));
            return failure(400, "bad_request");
        } catch (IllegalArgumentException refused) {
            return failure(400, "bad_request");
        } catch (MediaApi.Refused answered) {
            Outcome o = answered.status == 404 ? failure(404, "not_found") : failure(502, "backend_refused");
            return withReason(o, FailureReason.of(answered));
        } catch (IllegalStateException notConfigured) {
            return failure(503, "not_configured");
        } catch (Exception unreachable) {
            return withReason(failure(502, "unreachable"), FailureReason.of(unreachable));
        }
    }

    private static Outcome failure(int status, String code) {
        return new Outcome(status, Replies.err(code));
    }

    /** A failed answer that also says why home did not answer (FailureReason), for the phone's words. */
    private static Outcome withReason(Outcome o, String reason) {
        try { o.body.put("reason", reason); } catch (Exception never) { }
        return o;
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
        if (id.kind == MediaId.Kind.KEPT) return BrowseTree.keptNodes(kept().list(), pageSize, null);
        if (id.kind == MediaId.Kind.CONTAINER) {
            JSONObject k = kept().get(id.contentId);
            if (k != null && health.down(clock.getAsLong())) return BrowseTree.keptTracks(k, 0, pageSize);
        }
        try {
            List<MediaNode> nodes = loadFromHome(id, pageSize);
            health.answered();
            return nodes;
        } catch (Exception unreachable) {
            if (unreachable instanceof IllegalArgumentException) throw unreachable;
            if (unreachable instanceof MediaApi.Refused && ((MediaApi.Refused) unreachable).status < 500) throw unreachable;
            health.failed(clock.getAsLong());
            // Offline: a kept collection opens from the phone, and every other level says
            // what it can show instead of an error: what is on this phone.
            if (id.kind == MediaId.Kind.CONTAINER && kept().get(id.contentId) != null) {
                return BrowseTree.keptTracks(kept().get(id.contentId), 0, pageSize);
            }
            List<JSONObject> k = kept().list();
            if (k.isEmpty()) throw unreachable;
            return BrowseTree.keptNodes(k, pageSize, "Offline: showing what is on this phone");
        }
    }

    private List<MediaNode> loadFromHome(MediaId id, int pageSize) throws Exception {
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

    /** A long part (20 min or more) makes a collection a book: "parts", resumed, finished. */
    static final long BOOK_PART_MS = 20 * 60_000L;
    /** A re-sync never releases more than this share of a list in one pass (a short answer is not a removal). */
    static final double MAX_RELEASE_SHARE = 0.5;

    /**
     * "Keep on this phone": the collection a play belongs to (a c: id as it is; a track's
     * album otherwise), resolved whole. {@code mode}:
     * <ul>
     * <li>preview: what it is, nothing saved ("Keep the book · 14 parts");</li>
     * <li>keep: kept (again) with its tracks, its old removal cancelled;</li>
     * <li>refresh: an existing keep resolved again (re-sync, a retry's fresh URLs); never
     *   brings back a collection removed meanwhile, never releases more than half of a list.</li>
     * </ul>
     * The answer lists the tracks (id, url) and the kind (book, album, playlist).
     */
    /**
     * The phone's Queue → Save as playlist: the queue's content ids in order become a
     * household list (POST /api/v1/media/household/playlists). Ids that are not content ids
     * are left out; the words are a title and item titles only.
     */
    private Outcome savePlaylist(JSONObject request) throws Exception {
        String title = Json.str(request, "title").trim();
        JSONArray items = request.optJSONArray("items");
        if (title.isEmpty() || title.length() > 80 || items == null) return failure(400, "bad_request");
        JSONArray clean = new JSONArray();
        for (int i = 0; i < items.length() && clean.length() < 1000; i++) {
            JSONObject it = items.optJSONObject(i);
            String cid = it == null ? "" : it.optString("id");
            if (!ContentId.valid(cid)) continue;
            clean.put(new JSONObject().put("id", cid).put("title", it.optString("title", "")));
        }
        if (clean.length() == 0) return failure(400, "bad_request");
        JSONObject made = api.savePlaylist(title, clean);
        return new Outcome(200, Replies.ok().put("id", made.optString("id")).put("title", made.optString("title", title))
                .put("count", made.optInt("count", clean.length())));
    }

    private Outcome keep(JSONObject request) throws Exception {
        String mode = Json.first(Json.str(request, "mode"), "keep");
        String raw = Json.str(request, "id");
        String cid = raw.startsWith("c:") ? raw.substring(2) : raw.startsWith("p:") ? MediaId.parse(raw).contentId : raw;
        if (!ContentId.valid(cid)) return failure(400, "bad_request");
        boolean fromList = raw.startsWith("c:");
        if (!fromList) {
            // A track: keep its album (a book, a record), when the backend names one.
            JSONObject info = api.info(cid);
            if (groupKindOf(info, cid) != null) {
                // The web's "Keep on Phone" of an artist or author arrives as a bare id.
                if ("preview".equals(mode)) {
                    return new Outcome(200, Replies.ok().put("contentId", cid).put("kind", "group")
                            .put("groupKind", groupKindOf(info, cid)).put("title", "").put("tracks", new JSONArray()));
                }
                if ("keep".equals(mode) && !request.optBoolean("auto", false)) return keepWholeGroup(cid, groupKindOf(info, cid));
            }
            JSONObject meta = info == null ? null : info.optJSONObject("metadata");
            String album = meta == null ? "" : meta.optString("albumId", "");
            if (!album.isEmpty()) cid = ContentId.source(cid) + ":" + album;
        }
        if ("refresh".equals(mode) && (kept().get(cid) == null || kept().tombstoned(cid))) return failure(409, "not_kept");
        // An artist or an author is never flattened into one kept item (spec §3.11): a preview
        // says it is a group (the phone opens "Keep all…"); a keep from the web keeps it as one.
        if (!"refresh".equals(mode) && !request.optBoolean("auto", false) && kept().get(cid) == null) {
            String groupKind = groupKindOf(fromList ? safeInfo(cid) : null, cid);
            if (groupKind != null) {
                if ("preview".equals(mode)) {
                    return new Outcome(200, Replies.ok().put("contentId", cid).put("kind", "group").put("groupKind", groupKind)
                            .put("title", "").put("tracks", new JSONArray()));
                }
                return keepWholeGroup(cid, groupKind);
            }
        }
        // Kept automatically while listening (spec §3.10): {auto:true, only:[track ids]}. A
        // manual keep is never turned into an automatic one; a manual Keep of an automatic
        // one makes it manual (the whole collection, never removed by those rules).
        boolean auto = "keep".equals(mode) && request.optBoolean("auto", false);
        JSONObject existing = kept().tombstoned(cid) ? null : kept().get(cid);
        if (auto && existing != null && !KeptCollections.auto(existing)) {
            return new Outcome(200, keepAnswer(cid, existing.optString("title"), existing.optString("art", null),
                    existing.optJSONArray("tracks"), false, existing.optString("kind")).put("manual", true));
        }
        List<String> scope = auto ? strings(request.optJSONArray("only"))
                : "refresh".equals(mode) && KeptCollections.auto(existing) ? KeptCollections.only(existing) : null;
        // The whole list, not a player's 500-track window: a kept playlist is all of it.
        List<Track> all = QueueMapper.fromQueue(api.queue(cid, false), backend, "daylight-" + core.deviceId());
        // Home's queue puts a book's heard parts last (its watched/unwatched order, for
        // shows). Kept, a book is in its own order: its first part first, its next part next
        // (a place offline moves on to the part after, never to one home has not heard).
        boolean ordered = false;
        for (Track t : all) ordered |= t.longForm;
        JSONObject listing = null;
        try { listing = api.list(cid, ordered ? Math.min(all.size(), LIST_ORDER_MAX) : 1, 0); }
        catch (Exception unnamed) { /* the first track's album and cover; home's order */ }
        if (ordered) all = inListOrder(all, listing);
        if (scope != null && !scope.isEmpty()) all = scoped(all, scope);
        if (all.isEmpty()) return failure(404, "not_found");
        boolean cut = all.size() > MAX_KEPT_TRACKS;
        if (cut) all = new ArrayList<>(all.subList(0, MAX_KEPT_TRACKS));
        JSONArray tracks = new JSONArray();
        boolean longParts = false;
        java.util.Set<String> albums = new java.util.HashSet<>();
        for (Track t : all) {
            JSONObject tj = t.toJson();
            // A long part keeps its chapters with it, so they show offline (spec §5).
            if (t.durationMs >= BOOK_PART_MS && all.size() <= 4) {
                try {
                    JSONObject ch = api.chapters(t.id);
                    if (ch != null) { tj.put("chapters", ch); chaptersSeen.put(t.id, ch); }
                } catch (Exception noChapters) { /* kept without; a later refresh may add them */ }
            }
            tracks.put(tj);
            if (t.durationMs >= BOOK_PART_MS) longParts = true;
            albums.add(t.album);
        }
        String title = all.get(0).album, art = all.get(0).artUrl;
        String listType = "";
        if (listing != null) {
            JSONObject l = listing;
            title = Json.first(Json.str(l, "title"), Json.str(l, "label"), title);
            String image = BrowseTree.art(backend, Json.str(l, "image"));
            if (image != null) art = image;
            listType = Json.first(Json.str(l, "type"), Json.str(l, "itemType"));
        }
        String kind = kindOf(longParts, albums.size(), listType);
        long now = clock.getAsLong();
        String groupId = auto ? "" : Json.str(request, "group");
        if ("keep".equals(mode) && GroupKeeps.validId(groupId)) {
            // One unit of a kept artist or author (spec §3.11): its own collection, in the group.
            kept().saveUnit(cid, title, art, tracks, now, kind, groupId);
        } else if ("keep".equals(mode)) {
            kept().save(cid, title, art, tracks, now, kind, auto ? scope : null);
            if (auto && KeptCollections.auto(existing)) {
                // The window moved on (or a book's one part became the whole book): what it no
                // longer holds is released like a re-sync's removal, so its audio may go.
                java.util.Set<String> fresh = new java.util.HashSet<>(KeptCollections.trackIds(new JSONObject().put("tracks", tracks)));
                List<String> dropped = new ArrayList<>();
                for (String t : KeptCollections.trackIds(existing)) if (!fresh.contains(t)) dropped.add(t);
                kept().release(cid, dropped, now);
            }
        } else if ("refresh".equals(mode)) {
            JSONObject before = kept().get(cid);
            java.util.Set<String> fresh = new java.util.HashSet<>(KeptCollections.trackIds(new JSONObject().put("tracks", tracks)));
            List<String> dropped = new ArrayList<>();
            for (String t : KeptCollections.trackIds(before)) if (!fresh.contains(t)) dropped.add(t);
            int had = KeptCollections.trackIds(before).size();
            if (had > 0 && dropped.size() > had * MAX_RELEASE_SHARE) {
                // Half a list gone at once is more likely a short answer than an edit: keep it all.
                if (core != null) core.shell().note("MEDIA", "keep: download.release_refused (" + dropped.size() + " of " + had + ")");
                return new Outcome(200, keepAnswer(cid, title, art, before.optJSONArray("tracks"), cut, kind)
                        .put("releaseRefused", dropped.size()));
            }
            if (!kept().refreshIfKept(cid, title, art, tracks, now, kind)) return failure(409, "not_kept");
            kept().release(cid, dropped, now);
        }
        JSONObject answer = keepAnswer(cid, title, art, tracks, cut, kind);
        if (auto) answer.put("auto", true);
        String member = KeptCollections.groupOf(kept().get(cid));
        if (!member.isEmpty()) answer.put("group", member);
        return new Outcome(200, answer);
    }

    // ── keeping an artist or an author (spec §3.11) ──────────────────────────

    /**
     * What "Keep all…" on an artist or author would keep, nothing saved: the group (its kind
     * and, when kept before, its switches) and each unit (album or book) with its tracks
     * (id, url: the shell reads the sizes), kind, finished, started, whether the group holds
     * it now and whether it is past the 5000-track cap; in download order (the started book
     * first, then the author's order; albums newest first). {@code onlyNew}: a re-sync of a
     * group that follows; only the units it would add now.
     */
    private Outcome groupPreview(JSONObject request, boolean onlyNew) throws Exception {
        String raw = Json.str(request, "id");
        String gid = raw.startsWith("c:") ? raw.substring(2) : raw;
        if (!GroupKeeps.validId(gid)) return failure(400, "bad_request");
        JSONObject saved = kept().group(gid);
        if (onlyNew && (saved == null || !saved.optBoolean("follow", false))) {
            return new Outcome(200, Replies.ok().put("units", new JSONArray()));
        }
        JSONObject first = api.list(gid, 100, 0);
        JSONArray items = first == null ? null : first.optJSONArray("items");
        JSONArray all = new JSONArray();
        for (int i = 0; items != null && i < items.length(); i++) all.put(items.get(i));
        int total = first == null ? 0 : first.optInt("total", all.length());
        for (int skip = all.length(); skip < Math.min(total, GroupKeeps.MAX_UNITS) && items != null && items.length() > 0; skip = all.length()) {
            JSONObject more = api.list(gid, 100, skip);
            items = more == null ? null : more.optJSONArray("items");
            for (int i = 0; items != null && i < items.length(); i++) all.put(items.get(i));
        }
        List<JSONObject> units = GroupKeeps.unitsOf(all);
        if (units.isEmpty()) return failure(404, "not_found");
        java.util.Set<String> held = new java.util.HashSet<>(kept().unitsOf(gid));
        if (onlyNew) {
            java.util.Set<String> elsewhere = new java.util.HashSet<>();
            for (JSONObject k : kept().list()) if (!gid.equals(KeptCollections.groupOf(k))) elsewhere.add(k.optString("contentId"));
            List<String> listed = new ArrayList<>();
            for (JSONObject u : units) listed.add(u.optString("contentId"));
            java.util.Set<String> fresh = new java.util.HashSet<>(GroupKeeps.newUnits(listed, held, KeptCollections.excluded(saved), elsewhere));
            List<JSONObject> keep = new ArrayList<>();
            for (JSONObject u : units) if (fresh.contains(u.optString("contentId"))) keep.add(u);
            units = keep;
            if (units.isEmpty()) return new Outcome(200, Replies.ok().put("units", new JSONArray()));
        }
        // Each unit's tracks, four at a time (an author of 36 books answers in seconds).
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(4);
        List<java.util.concurrent.Future<List<Track>>> queued = new ArrayList<>();
        for (JSONObject u : units) {
            String uid = u.optString("contentId");
            queued.add(pool.submit(() -> QueueMapper.fromQueue(api.queue(uid, false), backend, "daylight-" + core.deviceId())));
        }
        java.util.Set<String> allTracks = new java.util.HashSet<>();
        List<List<Track>> tracksOf = new ArrayList<>();
        try {
            for (java.util.concurrent.Future<List<Track>> f : queued) {
                List<Track> ts;
                try { ts = f.get(30, java.util.concurrent.TimeUnit.SECONDS); } catch (Exception one) { ts = new ArrayList<>(); }
                tracksOf.add(ts);
                for (Track t : ts) allTracks.add(t.id);
            }
        } finally {
            pool.shutdownNow();
        }
        JSONObject progress = null;
        try { progress = Lookup.progress(api.recent(500), allTracks); } catch (Exception unknown) { /* none finished */ }
        List<String> kinds = new ArrayList<>();
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; i < units.size(); i++) {
            JSONObject u = units.get(i);
            List<Track> ts = tracksOf.get(i);
            if (ts.isEmpty()) continue;
            boolean longParts = false;
            java.util.Set<String> albums = new java.util.HashSet<>();
            JSONArray tj = new JSONArray();
            List<String> ids = new ArrayList<>();
            for (Track t : ts) {
                if (t.durationMs >= BOOK_PART_MS || t.longForm) longParts = true;
                albums.add(t.album);
                tj.put(new JSONObject().put("id", t.id).put("url", t.url));
                ids.add(t.id);
            }
            String kind = kindOf(longParts, albums.size(), "");
            kinds.add(kind);
            String art = BrowseTree.art(backend, u.optString("image"));
            if (art == null && !ts.isEmpty()) art = ts.get(0).artUrl;
            JSONObject o = new JSONObject().put("contentId", u.optString("contentId")).put("title", u.optString("title"))
                    .put("year", u.optInt("year")).put("index", u.optInt("index")).put("kind", kind).put("tracks", tj)
                    .put("count", ts.size()).put("finished", GroupKeeps.finished(ids, progress))
                    .put("started", GroupKeeps.started(ids, progress)).put("held", held.contains(u.optString("contentId")));
            if (art != null) o.put("art", art);
            out.add(o);
        }
        String gkind = GroupKeeps.groupKind(Json.first(Json.str(request, "kind"), saved == null ? "" : saved.optString("kind")), kinds);
        out = GroupKeeps.ordered(out, gkind);
        List<Integer> counts = new ArrayList<>();
        for (JSONObject o : out) counts.add(o.optInt("count"));
        int within = GroupKeeps.withinCap(counts, MAX_KEPT_TRACKS);
        int tracks = 0;
        JSONArray unitsJson = new JSONArray();
        for (int i = 0; i < out.size(); i++) {
            tracks += out.get(i).optInt("count");
            if (i >= within) out.get(i).put("overCap", true);
            unitsJson.put(out.get(i));
        }
        String title = Json.first(Json.str(first, "title"), Json.str(first, "label"), saved == null ? "" : saved.optString("title"));
        String gart = BrowseTree.art(backend, Json.str(first, "image"));
        JSONObject group = new JSONObject().put("id", gid).put("title", title).put("kind", gkind)
                .put("follow", saved == null ? GroupKeeps.AUTHOR.equals(gkind) : saved.optBoolean("follow"))
                .put("removeFinished", saved == null ? GroupKeeps.AUTHOR.equals(gkind) : saved.optBoolean("removeFinished"))
                .put("kept", saved != null);
        if (gart != null) group.put("art", gart);
        health.answered();
        return new Outcome(200, Replies.ok().put("group", group).put("units", unitsJson).put("totalTracks", tracks)
                .put("cap", MAX_KEPT_TRACKS).put("withinCap", within));
    }

    private JSONObject safeInfo(String cid) {
        try { return api.info(cid); } catch (Exception unknown) { return null; }
    }

    /** "artist" or "author" when {@code info} names an artist (an author is an artist of an audiobook library); null otherwise. */
    static String groupKindOf(JSONObject info, String cid) {
        if (info == null) return null;
        JSONObject meta = info.optJSONObject("metadata");
        String type = Json.first(Json.str(info, "type"), meta == null ? "" : Json.str(meta, "type")).toLowerCase(java.util.Locale.ROOT);
        if (!"artist".equals(type) && !"author".equals(type)) return null;
        String library = Json.first(Json.str(info, "librarySectionTitle"), meta == null ? "" : Json.str(meta, "librarySectionTitle"))
                .toLowerCase(java.util.Locale.ROOT);
        return "author".equals(type) || library.contains("book") ? GroupKeeps.AUTHOR : GroupKeeps.ARTIST;
    }

    /**
     * A keep of a whole artist or author without the sheet (from the web): the group with its
     * defaults, every unit not finished and within the cap kept as its own item; the phone's
     * sync then sizes and downloads each under the usual rules.
     */
    private Outcome keepWholeGroup(String gid, String kind) throws Exception {
        Outcome p = groupPreview(new JSONObject().put("id", gid).put("kind", kind), false);
        if (p.status != 200) return p;
        JSONObject group = p.body.getJSONObject("group");
        JSONArray units = p.body.getJSONArray("units");
        JSONArray chosen = new JSONArray(), listed = new JSONArray();
        for (int i = 0; i < units.length(); i++) {
            JSONObject u = units.getJSONObject(i);
            listed.put(u.optString("contentId"));
            if (!u.optBoolean("finished") && !u.optBoolean("overCap")) chosen.put(u.optString("contentId"));
        }
        groupSave(new JSONObject().put("group", group).put("chosen", chosen).put("listed", listed));
        int kept = 0;
        for (int i = 0; i < chosen.length(); i++) {
            Outcome o = keep(new JSONObject().put("id", "c:" + chosen.getString(i)).put("mode", "keep").put("group", gid));
            if (o.status == 200) kept++;
        }
        if (core != null) core.shell().note("MEDIA", "keep: group kept from a bare id (" + kept + " of " + chosen.length() + " units)");
        return new Outcome(200, Replies.ok().put("contentId", gid).put("title", group.optString("title")).put("kind", "group")
                .put("group", gid).put("units", kept).put("tracks", new JSONArray()));
    }

    /**
     * The group's record after "Keep all…" or Choose…: its switches, and the units left out
     * (listed and not chosen) so a re-sync never brings them back. The units themselves are
     * kept one by one by the shell (keep with {@code group}), in download order.
     */
    private Outcome groupSave(JSONObject request) throws Exception {
        JSONObject in = request.optJSONObject("group");
        String gid = in == null ? "" : Json.str(in, "id");
        if (!GroupKeeps.validId(gid)) return failure(400, "bad_request");
        JSONObject before = kept().group(gid);
        List<String> chosen = strings(request.optJSONArray("chosen"));
        List<String> listed = strings(request.optJSONArray("listed"));
        java.util.Set<String> excluded = GroupKeeps.excludedAfter(KeptCollections.excluded(before), listed, chosen);
        String kind = GroupKeeps.groupKind(Json.str(in, "kind"), new ArrayList<>());
        JSONObject g = new JSONObject().put("id", gid).put("title", Json.str(in, "title")).put("kind", kind)
                .put("follow", in.optBoolean("follow", GroupKeeps.AUTHOR.equals(kind)))
                .put("removeFinished", GroupKeeps.AUTHOR.equals(kind) && in.optBoolean("removeFinished", true))
                .put("keptAt", clock.getAsLong()).put("excluded", new JSONArray(new java.util.TreeSet<>(excluded)));
        if (!Json.str(in, "art").isEmpty()) g.put("art", Json.str(in, "art"));
        kept().putGroup(g);
        // Units the group held and the person now unchecked: they leave it.
        JSONArray orphaned = new JSONArray();
        int left = 0;
        java.util.Set<String> keep = new java.util.HashSet<>(chosen);
        for (String uid : kept().unitsOf(gid)) {
            if (keep.contains(uid) || !listed.contains(uid)) continue;
            for (String t : kept().leaveGroup(uid, clock.getAsLong())) orphaned.put(t);
            left++;
        }
        return new Outcome(200, Replies.ok().put("group", kept().group(gid)).put("orphaned", orphaned).put("left", left)
                .put("new", before == null));
    }

    /** The most entries of a collection's own listing read to put its parts in order. */
    static final int LIST_ORDER_MAX = 500;

    /**
     * {@code all} in the order of the collection's own listing (a book's parts as the book has
     * them); tracks the listing does not name keep their place after those it does. Unchanged
     * without a listing.
     */
    static List<Track> inListOrder(List<Track> all, JSONObject listing) {
        JSONArray items = listing == null ? null : listing.optJSONArray("items");
        if (items == null || items.length() == 0) return all;
        java.util.Map<String, Integer> at = new java.util.HashMap<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            String id = it == null ? "" : Json.first(Json.str(it, "id"), Json.str(it, "contentId"));
            if (!id.isEmpty()) at.putIfAbsent(id, i);
        }
        List<Track> out = new ArrayList<>(all);
        // Stable: the unnamed stay in home's order, after the named.
        out.sort((a, b) -> Integer.compare(at.getOrDefault(a.id, Integer.MAX_VALUE), at.getOrDefault(b.id, Integer.MAX_VALUE)));
        return out;
    }

    /**
     * The tracks of a collection an automatic keep holds: those named in {@code only}, in the
     * collection's own play order (the shell downloads the current part first).
     */
    static List<Track> scoped(List<Track> all, List<String> only) {
        java.util.Set<String> want = new java.util.HashSet<>(only);
        List<Track> out = new ArrayList<>();
        for (Track t : all) if (want.contains(t.id)) out.add(t);
        return out;
    }

    private static List<String> strings(JSONArray a) {
        List<String> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) if (ContentId.valid(a.optString(i))) out.add(a.optString(i));
        return out;
    }

    /**
     * The kept books home says are finished: a book is linear, so it is finished when its last
     * part is (marked finished, or heard to 97 %). Only books; an album is never "finished".
     */
    static JSONArray finishedBooks(List<JSONObject> kept, JSONObject recent) {
        java.util.Map<String, JSONObject> byId = new java.util.HashMap<>();
        JSONArray items = recent == null ? null : recent.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null) byId.putIfAbsent(Json.str(it, "contentId"), it);
        }
        JSONArray out = new JSONArray();
        for (JSONObject k : kept) {
            if (!"book".equals(k.optString("kind"))) continue;
            List<String> ids = KeptCollections.trackIds(k);
            if (ids.isEmpty()) continue;
            JSONObject last = byId.get(ids.get(ids.size() - 1));
            if (last == null) continue;
            long played = last.optLong("playhead", 0), duration = last.optLong("duration", 0);
            if (last.optBoolean("finished") || (duration > 0 && played >= duration * 0.97)) out.put(k.optString("contentId"));
        }
        return out;
    }

    /** book (long parts), playlist (a list of several albums, or a playlist), or album. */
    static String kindOf(boolean longParts, int albums, String listType) {
        String t = listType == null ? "" : listType.toLowerCase(java.util.Locale.ROOT);
        if (longParts || t.contains("audiobook") || t.contains("book")) return "book";
        if (t.contains("playlist") || albums > 1) return "playlist";
        return "album";
    }

    private JSONObject keepAnswer(String cid, String title, String art, JSONArray tracks, boolean cut, String kind) throws Exception {
        JSONObject out = Replies.ok().put("contentId", cid).put("title", title == null ? "" : title).put("tracks", tracks)
                .put("cut", cut).put("kind", kind)
                .put("capMb", core == null ? 4096 : (Integer) core.settings().get(DOWNLOAD_CAP_MB))
                .put("onCellular", core != null && Boolean.TRUE.equals(core.settings().get(DOWNLOAD_ON_CELLULAR)));
        if (art != null) out.put("art", art);
        return out;
    }

    private Outcome keptList() throws Exception {
        JSONArray items = new JSONArray();
        for (JSONObject k : kept().list()) {
            JSONObject o = new JSONObject().put("contentId", k.optString("contentId")).put("title", k.optString("title"))
                    .put("tracks", k.optJSONArray("tracks") == null ? new JSONArray() : k.optJSONArray("tracks"))
                    .put("keptAt", k.optLong("keptAt"));
            if (k.has("art")) o.put("art", k.optString("art"));
            if (!k.optString("kind").isEmpty()) o.put("kind", k.optString("kind"));
            if (KeptCollections.auto(k)) {
                o.put("auto", true);
                List<String> only = KeptCollections.only(k);
                if (!only.isEmpty()) o.put("only", new JSONArray(only));
            }
            if (!KeptCollections.groupOf(k).isEmpty()) {
                o.put("group", KeptCollections.groupOf(k));
                if (k.optBoolean("alone", false)) o.put("alone", true);
            }
            items.put(o);
        }
        JSONArray groups = new JSONArray();
        for (JSONObject g : kept().groups()) groups.put(g);
        // Only these tracks' audio may be deleted: ones an explicit removal released. While a
        // kept file could not be read, nothing may be (the shell is told why).
        JSONArray deletable = new JSONArray();
        List<String> bad = kept().quarantined();
        if (bad.isEmpty()) for (String t : kept().deletable()) deletable.put(t);
        return new Outcome(200, Replies.ok().put("items", items).put("deletable", deletable)
                .put("quarantined", new JSONArray(bad)).put("groups", groups));
    }

    /**
     * Sends progress kept while offline, oldest first; stops at the first that still cannot
     * go. One the backend calls stale (it has newer progress, from another player) is
     * dropped, not retried, and the phone's own resume point takes the backend's.
     */
    private void flushPending() {
        if (!flushing.compareAndSet(false, true)) return;   // one flush at a time: no double posts
        try { flushPendingOnce(); } finally { flushing.set(false); }
    }

    /** How long a play of a kept item waits for home's word on where it was. */
    static final long PLACE_WAIT_MS = 500;

    /**
     * A kept collection answered from the phone, with the request's own choices (a picked
     * track, shuffle), and the place: the phone's, unless home answers within a second with
     * a place and the phone has nothing unsent for it (home then knows the newer one: it was
     * heard on another screen). A late or absent answer updates the phone's places in the
     * background for the next play.
     */
    private Resolver.Resolved keptFirst(Resolver.Resolved offline, JSONObject request) {
        List<Track> tracks = new ArrayList<>(offline.tracks);
        int start = offline.startIndex;
        long at = offline.startPositionMs;
        int asked = request.optInt("startIndex", -1);
        if (request.optBoolean("shuffle")) {
            java.util.Collections.shuffle(tracks);
            start = 0;
            at = 0;
        } else if (request.optBoolean("explicitPosition") && asked >= 0 && asked < tracks.size()) {
            start = asked;
            at = 0;
        } else if (!health.down(clock.getAsLong())) {
            String id = tracks.get(start).id;
            Long home = homePlace(id);
            if (home != null && pending().get(id) == null) {
                long dur = tracks.get(start).durationMs;
                at = dur > 0 && home * 1000 >= dur - 1000 ? 0 : home * 1000;
            }
        }
        flushSoon();
        return new Resolver.Resolved(tracks, start, Math.max(0, at), true);
    }

    /**
     * Home's place for one item in seconds, if it answers within {@link #PLACE_WAIT_MS};
     * null otherwise. A later answer is kept as the phone's place for the next play.
     */
    private Long homePlace(String contentId) {
        java.util.concurrent.CompletableFuture<Long> f = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
            try {
                JSONObject recent = api.recent(100);
                health.answered();
                JSONArray items = recent == null ? null : recent.optJSONArray("items");
                for (int i = 0; items != null && i < items.length(); i++) {
                    JSONObject it = items.optJSONObject(i);
                    if (it == null || !contentId.equals(Json.str(it, "contentId"))) continue;
                    long seconds = it.optLong("playhead", -1);
                    if (seconds >= 0 && pending().get(contentId) == null) {
                        positions().keep(new JSONObject().put("assetId", contentId).put("seconds", seconds)
                                .put("observedAt", clock.getAsLong()).put("fromHome", true));
                    }
                    return seconds >= 0 ? seconds : null;
                }
                return null;
            } catch (Exception unreachable) {
                health.failed(clock.getAsLong());
                return null;
            }
        });
        try { return f.get(PLACE_WAIT_MS, java.util.concurrent.TimeUnit.MILLISECONDS); }
        catch (Exception notInTime) { return null; }
    }

    /** Off the caller's thread: a play never waits on old reports going out. */
    private void flushSoon() {
        ExecutorService w = worker;
        if (w != null && !pending().waiting().isEmpty()) {
            try { w.execute(this::flushPending); } catch (java.util.concurrent.RejectedExecutionException stopping) { }
        }
    }

    /**
     * A place heard on this phone and not yet sent is newer than anything home knows of
     * this phone's listening: a play resumes from it (home keeps the newer of the two when it
     * arrives). A position the person picked is left alone.
     */
    private Resolver.Resolved newerUnsent(Resolver.Resolved r, boolean explicitPosition) {
        if (explicitPosition || r == null || r.tracks.isEmpty() || r.startIndex < 0 || r.startIndex >= r.tracks.size()) return r;
        JSONObject unsent = pending().get(r.tracks.get(r.startIndex).id);
        if (unsent == null) return r;
        long ms = Math.max(0, unsent.optLong("seconds", 0)) * 1000;
        long dur = r.tracks.get(r.startIndex).durationMs;
        if (ms <= 0 || (dur > 0 && ms >= dur - 1000)) return r;
        return new Resolver.Resolved(r.tracks, r.startIndex, ms, r.selectionResolved);
    }

    private void flushPendingOnce() {
        for (JSONObject body : pending().waiting()) {
            try {
                body.put("sentAt", clock.getAsLong());
                answered(body, api.log(body));
                pending().sent(body.optString("assetId"));
            } catch (MediaApi.Refused refused) {
                // A 4xx is a refusal to keep it: it will never be accepted. A 5xx: later.
                if (refused.status < 500) { pending().sent(body.optString("assetId")); continue; }
                return;
            } catch (Exception stillOffline) {
                return;
            }
        }
    }

    /** Whether play/log said the report was older than what it has. */
    static boolean stale(JSONObject answer) {
        if (answer == null) return false;
        if (answer.optBoolean("stale", false)) return true;
        JSONObject r = answer.optJSONObject("response");
        return r != null && r.optBoolean("stale", false);
    }

    /** The newer position the backend holds, in seconds, when a stale answer says it; -1 otherwise. */
    static long serverSeconds(JSONObject answer) {
        JSONObject r = answer == null ? null : answer.optJSONObject("response");
        for (JSONObject o : new JSONObject[] { r, answer }) {
            if (o == null) continue;
            for (String key : new String[] { "seconds", "playhead", "currentSeconds" }) {
                if (o.has(key) && o.optLong(key, -1) >= 0) return o.optLong(key);
            }
        }
        return -1;
    }

    /** A stale answer: the phone's offline resume point follows the backend's newer one. */
    private void answered(JSONObject body, JSONObject answer) {
        if (!stale(answer)) return;
        long seconds = serverSeconds(answer);
        try {
            if (seconds >= 0) positions().keep(new JSONObject(body.toString()).put("seconds", seconds)
                    .put("observedAt", clock.getAsLong()));
        } catch (Exception ignored) { }
        if (core != null) core.shell().note("MEDIA", "play/log: newer progress on home for " + body.optString("assetId") + "; this report dropped");
    }

    private Outcome resolve(JSONObject request) throws Exception {
        JSONArray ids = request.optJSONArray("ids");
        if (ids == null || ids.length() == 0) throw new IllegalArgumentException("body needs 'ids'");
        List<String> mediaIds = new ArrayList<>();
        for (int i = 0; i < ids.length(); i++) {
            Object id = ids.opt(i);
            mediaIds.add(id instanceof String ? (String) id : null);
        }
        long began = android.os.SystemClock.elapsedRealtime();
        Resolver.Resolved r = null;
        Resolver.Resolved offline = mediaIds.size() == 1 ? Offline.resolve(mediaIds.get(0), kept(), positions()) : null;
        // A kept item plays from the phone first, always: home is asked only for its place
        // (a moment, then in the background), never waited on for the tracks.
        if (offline != null) r = keptFirst(offline, request);
        if (r == null) {
            try {
                r = Resolver.resolve(mediaIds, request.optInt("startIndex", -1), request.optBoolean("explicitPosition"),
                        queueCache(), backend, "daylight-" + core.deviceId(), request.optBoolean("shuffle"));
                health.answered();
                r = newerUnsent(r, request.optBoolean("explicitPosition"));
                flushSoon();
            } catch (Exception unreachable) {
                // No backend (no network, a restart): a collection kept on this phone plays from here.
                // A bad request or a 404 is an answer, not an outage.
                if (unreachable instanceof IllegalArgumentException) throw unreachable;
                if (unreachable instanceof MediaApi.Refused && ((MediaApi.Refused) unreachable).status < 500) throw unreachable;
                health.failed(clock.getAsLong());
                if (offline == null) throw unreachable;
                r = offline;
            }
        }
        JSONArray tracks = new JSONArray();
        for (Track t : r.tracks) tracks.put(t.toJson());
        try {
            String cache = queueCache == null ? "" : queueCache.last;
            android.util.Log.i("Daylight-Media", "play answered " + (offline != null ? "from the phone" : "by home") + " in "
                    + (android.os.SystemClock.elapsedRealtime() - began) + " ms" + (cache.isEmpty() ? "" : ", list " + cache));
        } catch (Throwable jvmTest) { /* no android.util.Log in a JVM test */ }
        String first = mediaIds.isEmpty() ? null : mediaIds.get(0);
        if (first != null && first.startsWith("c:") && !r.tracks.isEmpty()) rememberList(first.substring(2));
        return new Outcome(200, Replies.ok().put("tracks", tracks).put("startIndex", r.startIndex)
                .put("startPositionMs", r.startPositionMs).put("selectionResolved", r.selectionResolved));
    }

    private QueueCache queueCache;
    private MediaApi queueCacheFor;
    private final java.util.concurrent.ExecutorService queueRefresher = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "daylight-queue-refresh");
        t.setDaemon(true);
        return t;
    });

    /** Music lists' last answers, played at once while home is asked again (QueueCache). */
    private synchronized MediaApi queueCache() {
        if (queueCache == null || queueCacheFor != api) {
            queueCacheFor = api;
            queueCache = new QueueCache(api, new java.io.File(stateDir(), "queue-cache"), queueRefresher, System::currentTimeMillis);
        }
        queueCache.last = "";
        return queueCache;
    }

    private RecentLists recentLists;
    private PlayInbox inbox;
    private final java.util.concurrent.ExecutorService listNamer = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "daylight-recent-lists");
        t.setDaemon(true);
        return t;
    });

    /** The lists played lately, kept with the payload's state; in memory only where there is none (tests). */
    private java.io.File stateDir;
    /** Where the payload keeps small state (payloads/state), or a temp dir without one (tests). */
    synchronized java.io.File stateDir() {
        if (stateDir != null) return stateDir;
        java.io.File dir = null;
        try {
            Object payloadDir = core == null ? null : core.shell().payloadDir();
            if (payloadDir instanceof java.io.File) dir = net.kckern.daylight.api.PayloadState.dir((java.io.File) payloadDir);
        } catch (RuntimeException none) { /* no state dir */ }
        if (dir == null) {
            try { dir = java.nio.file.Files.createTempDirectory("media-state").toFile(); }
            catch (java.io.IOException e) { dir = new java.io.File(System.getProperty("java.io.tmpdir")); }
        }
        stateDir = dir;
        return dir;
    }

    /** The most tracks one kept collection holds; a longer list is kept to here and says so. */
    static final int MAX_KEPT_TRACKS = 5000;
    /** Media calls give up connecting after this: offline is learnt in seconds. */
    static final int CONNECT_MS = 3_000;
    /** A media call home connected to and that answers nothing gives up after this. */
    static final int READ_MS_MEDIA = 10_000;
    private final java.util.concurrent.atomic.AtomicBoolean flushing = new java.util.concurrent.atomic.AtomicBoolean();
    private final BackendHealth health = new BackendHealth();

    /** The token the shell holds for the inbox (empty when it holds none, or is too old to say). */
    private String inboxToken() {
        try {
            Object shell = core == null ? null : core.shell();
            return shell == null ? "" : ((net.kckern.daylight.api.ShellServices) shell).inboxToken();
        } catch (LinkageError olderShell) {
            return "";
        }
    }

    private static boolean runningOnEmulator() {
        try {
            return InboxIdentity.emulator(android.os.Build.FINGERPRINT, android.os.Build.HARDWARE,
                    android.os.Build.PRODUCT, android.os.Build.MODEL);
        } catch (Throwable noAndroid) {
            return false;   // a JVM test
        }
    }

    private static String buildModel() {
        try { return android.os.Build.MODEL; } catch (Throwable noAndroid) { return ""; }
    }

    /** Kept collections changed from here (the inbox): the shell's keeper downloads or deletes to match. */
    static final String KEEP_JOB = "net.kckern.daylight.cap.mediaservice.shell.KeepJob";
    static final int KEEP_JOB_SYNC_ID = 7_204;

    /** The shell's background inbox check (KeepJob.INBOX_ID); keep in step. */
    static final int INBOX_JOB_ID = 7_211;
    static final long INBOX_JOB_EVERY_MS = 15 * 60_000L;

    /**
     * Every 15 min with any network, persisted over reboots: the inbox checked with the app
     * closed, so a keep from the web lands without opening the app. Scheduled once; a pending
     * job is left as it is. (setPersisted needs RECEIVE_BOOT_COMPLETED, which the shell holds.)
     */
    @android.annotation.SuppressLint("MissingPermission")
    private void scheduleInboxJob() {
        Object context = core == null ? null : core.shell().context();
        if (context == null) return;
        try {
            android.content.Context c = (android.content.Context) context;
            android.app.job.JobScheduler js = (android.app.job.JobScheduler) c.getSystemService(android.content.Context.JOB_SCHEDULER_SERVICE);
            if (js.getPendingJob(INBOX_JOB_ID) != null) return;
            js.schedule(new android.app.job.JobInfo.Builder(INBOX_JOB_ID,
                    new android.content.ComponentName(c.getPackageName(), KEEP_JOB))
                    .setPeriodic(INBOX_JOB_EVERY_MS)
                    .setRequiredNetworkType(android.app.job.JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true).build());
        } catch (Throwable noJob) {
            core.shell().note("MEDIA", "inbox: background check not scheduled (" + noJob.getClass().getSimpleName() + ")");
        }
    }

    private void signalKeeper() {
        Object context = core == null ? null : core.shell().context();
        if (context == null) return;
        try {
            android.content.Context c = (android.content.Context) context;
            android.app.job.JobScheduler js = (android.app.job.JobScheduler) c.getSystemService(android.content.Context.JOB_SCHEDULER_SERVICE);
            js.schedule(new android.app.job.JobInfo.Builder(KEEP_JOB_SYNC_ID,
                    new android.content.ComponentName(c.getPackageName(), KEEP_JOB)).setOverrideDeadline(0).build());
        } catch (Throwable noJob) {
            core.shell().note("MEDIA", "keep: could not ask the shell to sync (" + noJob.getClass().getSimpleName() + ")");
        }
    }

    private KeptCollections kept;

    /** A track or collection still kept on the phone: its place is never pushed out of the positions. */
    private boolean stillKept(String contentId) {
        try { return kept().holding(contentId) != null; } catch (RuntimeException unknown) { return true; }
    }
    private PendingProgress pending, positions;

    synchronized KeptCollections kept() {
        if (kept == null) kept = new KeptCollections(new java.io.File(stateDir(), "kept"));
        return kept;
    }

    synchronized PendingProgress pending() {
        if (pending == null) pending = new PendingProgress(new java.io.File(stateDir(), "pending-progress.json"), this::stillKept);
        return pending;
    }

    /** The last position reported for each item (sent or not): where an offline play resumes. */
    synchronized PendingProgress positions() {
        if (positions == null) positions = new PendingProgress(new java.io.File(stateDir(), "positions.json"), this::stillKept);
        return positions;
    }

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
        JSONObject ok = Replies.ok().put("mediaId", MediaId.leaf(contentId, null));
        // The action's own label, so the play service's notice says what is starting.
        JSONObject described = actions.describe(id);
        String label = described == null ? "" : described.optString("label", "").trim();
        if (!label.isEmpty()) ok.put("title", label.length() > 80 ? label.substring(0, 80) : label);
        return new Outcome(200, ok);
    }

    /**
     * A car's voice search (the library session's onSearch). The query is cut and
     * cleaned (BrowseTree.searchText) and sent as one encoded parameter; an empty one
     * answers the recent list. The answer is browse entries, at most media.pageSize, and
     * "best": what "play <query>" plays. The query is never noted or logged; it is kept
     * for a minute as the key of the answer in memory, as a browse level is.
     */
    /**
     * The phone's search (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md):
     * results grouped Books, Albums, Artists, Playlists, Tracks, audio only. With no home,
     * the collections kept on this phone that match, as {offline: true}.
     */
    private Outcome lookup(JSONObject request) throws Exception {
        Object raw = request.opt("query");
        if (raw != null && raw != JSONObject.NULL && !(raw instanceof String)) throw new IllegalArgumentException("query must be text");
        final String text = BrowseTree.searchText(raw instanceof String ? (String) raw : "");
        if (text.isEmpty()) return new Outcome(200, Replies.ok().put("groups", new JSONArray()).put("offline", false));
        JSONObject body;
        String reason = null;
        try {
            JSONObject found = api.search(text, 60);
            LibraryKinds kinds = kinds();
            body = Lookup.groups(found, backend, 5, kinds);
            health.answered();
            // An author found by name shows their books too (at most two authors, eight books each).
            for (String[] a : Lookup.authors(found, 2, kinds)) {
                try { Lookup.prependBooks(body, Lookup.booksOf(api.list(a[0], 8, 0), a[1], backend, 8)); }
                catch (Exception oneAuthor) { /* the author row still leads to them */ }
            }
        } catch (IllegalArgumentException bad) {
            throw bad;
        } catch (Exception unreachable) {
            health.failed(clock.getAsLong());
            body = Lookup.offline(kept().list(), text);
            // Why home did not answer: the phone says "Home isn't answering", not "Offline", for a slow home.
            reason = FailureReason.of(unreachable);
        }
        JSONObject out = Replies.ok();
        if (reason != null) out.put("reason", reason);
        for (java.util.Iterator<String> k = body.keys(); k.hasNext(); ) { String key = k.next(); out.put(key, body.get(key)); }
        return new Outcome(200, out);
    }

    private volatile LibraryKinds kinds;
    private volatile long kindsAt;
    static final long KINDS_MS = 10 * 60_000L;

    /**
     * What each audio library holds, as home says (asked at most every 10 minutes); the last
     * answer while home is away; the title rule only when home has no such route (404).
     */
    LibraryKinds kinds() {
        LibraryKinds k = kinds;
        long now = clock.getAsLong();
        if (k != null && k.fromHome && now - kindsAt < KINDS_MS) return k;
        try {
            k = LibraryKinds.of(api.audioLibraries());
            kinds = k;
            kindsAt = now;
            return k;
        } catch (MediaApi.Refused refused) {
            if (refused.status == 404) {
                if (core != null) core.shell().note("MEDIA", "home has no audio-libraries route: library kinds by title until it is updated");
                kinds = LibraryKinds.legacy();
                kindsAt = now;
                return kinds;
            }
        } catch (Exception unreachable) { /* the last answer, below */ }
        return k != null ? k : LibraryKinds.legacy();
    }

    private ContinueHides hides;

    synchronized ContinueHides hides() {
        if (hides == null) hides = new ContinueHides(new java.io.File(stateDir(), "continue-hides.json"));
        return hides;
    }

    /**
     * Remove from (or, Undo, back into) Continue listening: applied on the phone at once and
     * sent to home now or when it answers. {contentId, hidden}.
     */
    private Outcome continueHide(JSONObject request) throws Exception {
        String id = Json.str(request, "contentId");
        if (!ContentId.valid(id)) return failure(400, "bad_request");
        boolean hidden = request.optBoolean("hidden", true);
        if (hidden) hides().hide(id, clock.getAsLong()); else hides().unhide(id, clock.getAsLong());
        boolean sent = flushHides();
        return new Outcome(200, Replies.ok().put("hidden", hidden).put("sent", sent));
    }

    /** Sends the hides home has not heard, oldest first; false when one is still waiting. */
    private boolean flushHides() {
        for (JSONObject w : hides().waiting()) {
            String id = w.optString("contentId"), op = w.optString("op");
            try {
                api.hideContinue(id, "hide".equals(op));
                hides().sent(id, op);
            } catch (MediaApi.Refused refused) {
                // 4xx: never accepted (a 404 from a home without the route waits for the update instead).
                if (refused.status == 404) return false;
                if (refused.status < 500) { hides().sent(id, op); continue; }
                return false;
            } catch (Exception offline) {
                return false;
            }
        }
        return true;
    }

    /**
     * An author's, speaker's or artist's header (About): home's info, and for an author or a
     * speaker their books' lengths and progress. {id: content id, books: true for an author}.
     */
    private Outcome about(JSONObject request) throws Exception {
        String id = Json.str(request, "id");
        if (!ContentId.valid(id)) return failure(400, "bad_request");
        JSONObject info = api.info(id);
        JSONObject leaves = null, recent = null;
        if (request.optBoolean("books")) {
            String local = ContentId.local(id);
            if (local.matches("\\d+")) {
                try { leaves = api.list(ContentId.source(id) + ":library/metadata/" + local + "/allLeaves", 500, 0); }
                catch (Exception none) { /* the header without lengths */ }
            }
            try { recent = api.recent(200); } catch (Exception none) { /* without progress */ }
        }
        health.answered();
        return new Outcome(200, Replies.ok().put("about", About.of(info, leaves, recent, backend)));
    }

    /**
     * Mark finished from Continue listening: every part of the book a part belongs to (its
     * info's albumId), then the item leaves Continue. {contentId: a part}.
     */
    private Outcome bookFinished(JSONObject request) throws Exception {
        String id = Json.str(request, "contentId");
        if (!ContentId.valid(id)) return failure(400, "bad_request");
        boolean finished = request.optBoolean("finished", true);
        JSONObject info = api.info(id);
        JSONObject meta = info == null ? null : info.optJSONObject("metadata");
        String album = meta == null ? "" : Json.str(meta, "albumId");
        String book = album.isEmpty() ? "" : ContentId.source(id) + ":" + album;
        List<String> parts = new ArrayList<>();
        if (ContentId.valid(book)) {
            JSONArray items = api.list(book, 200, 0).optJSONArray("items");
            for (int i = 0; items != null && i < items.length(); i++) {
                String part = Json.str(items.optJSONObject(i), "id");
                if (ContentId.valid(part) && !"container".equals(Json.str(items.optJSONObject(i), "itemType"))) parts.add(part);
            }
        }
        if (parts.isEmpty()) parts.add(id);
        int done = 0;
        for (String part : parts) { api.markWatched(part, finished); done++; }
        if (finished) hides().hide(id, clock.getAsLong()); else hides().unhide(id, clock.getAsLong());
        // Undo: home's "not finished" starts a part over; the card's place is put back.
        long place = request.optLong("restoreSeconds", -1), length = request.optLong("durationSeconds", 0);
        if (!finished && place > 0) {
            try {
                api.log(new ProgressReporter.Report(id, Json.str(request, "title"), null, place,
                        length > 0 ? Math.min(99.0, place * 100.0 / length) : 0, false).toBody());
            } catch (Exception notNow) { /* the part starts over; nothing else is lost */ }
        }
        flushHides();
        health.answered();
        JSONArray all = new JSONArray();
        for (String part : parts) all.put(part);
        return new Outcome(200, Replies.ok().put("marked", done).put("book", book).put("parts", all));
    }

    /** The library's first level: the audio Plex libraries, then the household's list sources; offline, what is kept. */
    private Outcome library() throws Exception {
        try {
            JSONObject libraries;
            try {
                libraries = api.audioLibraries();
                kinds = LibraryKinds.of(libraries);
                kindsAt = clock.getAsLong();
            } catch (MediaApi.Refused older) {
                if (older.status != 404) throw older;
                // A home older than the audio-libraries route: the list endpoint's libraries.
                libraries = api.libraries();
            }
            JSONArray items = Lookup.libraryRoot(libraries, api.audioSources(), kinds());
            health.answered();
            return new Outcome(200, Replies.ok().put("items", items).put("offline", false));
        } catch (Exception unreachable) {
            health.failed(clock.getAsLong());
            JSONArray items = new JSONArray();
            for (MediaNode n : BrowseTree.keptNodes(kept().list(), 200, null)) items.put(n.toJson().put("kind", "kept"));
            return new Outcome(200, Replies.ok().put("items", items).put("offline", true).put("reason", FailureReason.of(unreachable)));
        }
    }

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
        long heard = clock.getAsLong();
        for (ProgressReporter.Report report : reports) { report.observedAt = heard; send(report); }
        return new Outcome(200, Replies.ok().put("reports", reports.size()));
    }

    /**
     * Off the caller's thread once started. A report that fails is noted in the status
     * and dropped: the next one carries a later position.
     */
    private void send(final ProgressReporter.Report report) {
        Runnable job = () -> {
            try {
                JSONObject body = report.toBody();
                positions().keep(body);
                try {
                    body.put("sentAt", clock.getAsLong());
                    answered(body, api.log(body));
                } catch (MediaApi.Refused answered) {
                    // A server error is a backend that was not there; a 4xx is a refusal to keep.
                    if (answered.status >= 500) pending().keep(body);
                    throw answered;
                } catch (java.io.IOException offline) {
                    pending().keep(body);
                    throw offline;
                }
                pending().sent(report.contentId);
                lastReportAtMs = clock.getAsLong();
                lastError = "";
                reportsSent++;
                flushSoon();
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

    /**
     * Whether the installed shell's Now playing starts an item itself (Starting.EXTRA_PLAY,
     * shell 134 and later). The payload is updated apart from the shell, so an older shell is
     * still handed the play screen. Read from the installed version code.
     */
    static final long NOW_PLAYING_PLAYS_FROM = 134;

    private static boolean shellPlaysFromNowPlaying(Context c) {
        try {
            android.content.pm.PackageInfo info = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            long code = android.os.Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            return code >= NOW_PLAYING_PLAYS_FROM;
        } catch (Exception unknown) {
            return false;
        }
    }

    private Launcher launcher() {
        if (launcher == null) {
            final Object context = core.shell().context();
            // A JVM test of the whole payload has no Android context: there is no player.
            if (context == null) return null;
            launcher = new Launcher() {
                @Override public void play(String mediaId) {
                    Context c = (Context) context;
                    // By name: Now playing is installed code in this capability's shell half. It
                    // shows the item starting from its first frame and starts it on its own
                    // controller (its Starting extras, by name), so no second screen sits over it.
                    // Not exported, so only this app can start it. Started while the link activity
                    // is on screen, which is what lets a service context start one. A shell older
                    // than these extras ignores them: then the play screen starts it, as before.
                    Intent now = new Intent().setClassName(c, NOW_PLAYING_ACTIVITY).putExtra("target", "local")
                            .putExtra("starting.id", mediaId).putExtra("starting.play", true)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    if (shellPlaysFromNowPlaying(c)) c.startActivity(now);
                    else c.startActivity(new Intent().setClassName(c, PLAY_ACTIVITY).putExtra("id", mediaId)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }

                @Override public void browse(String mediaId, String kind, String title) {
                    Context c = (Context) context;
                    c.startActivity(new Intent().setClassName(c, BROWSE_ACTIVITY).putExtra("parent", mediaId)
                            .putExtra("kind", kind).putExtra("title", title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
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
