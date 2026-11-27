package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.os.SystemClock;
import android.util.Log;

import androidx.media3.common.C;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadCursor;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.Requirements;

import net.kckern.daylight.shellkit.KeptIndex;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * "Keep on this phone": whole collections (a book, an album, a playlist) downloaded with
 * Media3's download stack into one cache in the app's own files, the player reading through
 * that cache first. Built to the lifecycle spec
 * (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md) and the hardening
 * plan (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md).
 *
 * <p>One state per kept item, the spec's words (shell-kit {@link KeptIndex}): Checking,
 * Needs room, Queued, Waiting for Wi-Fi / home / storage, Downloading, Paused, Partly ready,
 * Ready, Updating, Removing, Not available, Damaged; written for every screen and sent to the
 * web through the payload's inbox.
 *
 * <p>Nothing kept is lost without the person asking: audio is deleted only for tracks the
 * payload says a removal (Remove, Remove finished, Remove all, Cancel, a list's own re-sync)
 * released. A missing SD card, a short answer, a corrupt list, a lowered limit, a full disk:
 * none deletes anything.
 *
 * <p>Every track is keyed by its content id ({@link #cacheKey}), so any play path finds the
 * copy, and a track two collections hold is stored once.
 */
final class KeepStore {
    private static final String TAG = "Daylight-Media";
    private static final long WAIT_MS = 15_000;
    private static final String PREFS = "daylight.keep";
    private static final String MIRROR = "kept-mirror.json";
    private static final String CHANNEL = "daylight_downloads";
    static final int UNDO_NOTIFICATION = 7_210;
    static final String ACTION_UNDO = "net.kckern.daylight.keep.UNDO";
    static final String ACTION_CANCEL = "net.kckern.daylight.keep.CANCEL";
    static final String ACTION_RESUME_ALL = "net.kckern.daylight.keep.RESUME";
    /** Stop reason for an item the person paused (Media3: any non-zero reason stops it). */
    private static final int STOP_PAUSED = 1;
    private static KeepStore instance;

    final DownloadManager manager;
    private final Context app;
    private final SimpleCache cache;
    private final File cacheDir;
    /** internal, sd, or sd-missing (the card holding the downloads is out). */
    final String location;
    private final SharedPreferences prefs;
    private final PayloadMedia media = new PayloadMedia();
    /**
     * Two executors, one per purpose. {@code io} asks home (preview, keep, retry, the sync, the
     * self-check), so it can wait 30 s on one call; {@code local} keeps the On this phone index
     * and runs Remove, Pause and Resume, and never waits on the network, so those answer at
     * once whatever home is doing.
     */
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-keep");
        t.setDaemon(true);
        return t;
    });
    private final ExecutorService local = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-keep-local");
        t.setDaemon(true);
        return t;
    });
    /** Held while downloads are added or a removal deletes them, so a sync never puts back what a Remove took away. */
    private final Object downloadsLock = new Object();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable refreshNow = () -> local.execute(this::refreshOnce);
    /** Bytes per collection when they last moved, against the uptime clock (never the wall clock). */
    private final Map<String, long[]> moved = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile long capMb = 4096;
    private volatile boolean onCellular, removeFinished;
    private volatile long removeFinishedAfterMs = KeepRules.DAY_MS;
    /** The payload's download rules have been read (the limit shown is then the real one). */
    volatile boolean rulesKnown;
    /** media.autoKeep and media.autoKeepAfterMin (spec §3.10), as the payload last said (kept in prefs between starts). */
    private volatile boolean autoKeepOn = true;
    private volatile int autoKeepAfterMin = 10;
    private final AutoKeepLog autoLog;

    static synchronized KeepStore get(Context context) {
        if (instance == null) instance = new KeepStore(context.getApplicationContext());
        return instance;
    }

    static String cacheKey(String contentId) { return "track:" + contentId; }

    /** A track's download key for one file version at home ("" : the plain key). */
    static String versionedKey(String contentId, String fileVersion) {
        return fileVersion == null || fileVersion.isEmpty() ? cacheKey(contentId) : cacheKey(contentId) + "@" + fileVersion;
    }

    /** The content id a download key is for (any version). */
    static String trackOf(String key) {
        String k = key.startsWith("track:") ? key.substring(6) : key;
        int at = k.indexOf('@');
        return at < 0 ? k : k.substring(0, at);
    }

    /**
     * The key the player reads a track from: the copy that is whole. A changed file at home is
     * downloaded under a new key while the old copy keeps playing; the player moves to the new
     * one only when it is whole. The plain key before any version was seen.
     */
    private static final Map<String, String> KEYS = new java.util.concurrent.ConcurrentHashMap<>();

    static String playKey(String contentId) {
        String k = KEYS.get(contentId);
        return k != null ? k : cacheKey(contentId);
    }

    private String keyFor(String contentId) { return playKey(contentId); }

    private void setKey(String contentId, String key, String version) {
        KEYS.put(contentId, key);
        prefs.edit().putString("key." + contentId, key).putString("ver." + contentId, version == null ? "" : version).apply();
    }

    private KeepStore(Context app) {
        this.app = app;
        this.prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.autoLog = new AutoKeepLog(app.getFilesDir());
        autoKeepOn = prefs.getBoolean("rule.autoKeep", true);
        autoKeepAfterMin = prefs.getInt("rule.autoKeepAfterMin", 10);
        for (Map.Entry<String, ?> e : prefs.getAll().entrySet()) {
            if (e.getKey().startsWith("key.") && e.getValue() instanceof String) KEYS.put(e.getKey().substring(4), (String) e.getValue());
        }
        net.kckern.daylight.shellkit.PlaylistArtwork.useKept(new File(app.getFilesDir(), "kept-art"));
        File sd = removableDir(app);
        String setting = prefs.getString("location.setting", KeepRules.INTERNAL);
        String before = prefs.getString("location.active", KeepRules.INTERNAL);
        location = KeepRules.location(setting, sd != null, before);
        cacheDir = KeepRules.SD.equals(location) ? new File(sd, "media-cache")
                : KeepRules.SD_MISSING.equals(location) ? new File(app.getFilesDir(), "media-cache-card-out")
                : new File(app.getFilesDir(), "media-cache");
        if (!KeepRules.SD_MISSING.equals(location)) prefs.edit().putString("location.active", location).apply();
        StandaloneDatabaseProvider db = new StandaloneDatabaseProvider(app);
        cache = new SimpleCache(cacheDir, new NoOpCacheEvictor(), db);
        manager = new DownloadManager(app, db, cache, http(), Executors.newFixedThreadPool(2));
        manager.setMaxParallelDownloads(2);
        manager.setRequirements(requirements(false));
        // The card holding the downloads is out: nothing runs, nothing is reconciled, nothing deleted.
        if (KeepRules.SD_MISSING.equals(location)) manager.pauseDownloads();
        manager.addListener(new DownloadManager.Listener() {
            @Override public void onDownloadChanged(DownloadManager m, Download d, Exception e) {
                if (d.state == Download.STATE_FAILED) local.execute(() -> failed(d.request.id, e));
                if (d.state == Download.STATE_COMPLETED) local.execute(() -> completed(d.request.id));
                refreshSoon();
            }
            @Override public void onDownloadRemoved(DownloadManager m, Download d) {
                String again = prefs.getString("readd." + d.request.id, "");
                prefs.edit().remove("readd." + d.request.id).apply();
                if (!again.isEmpty()) add(request(d.request.id, again));
                refreshSoon();
            }
            @Override public void onDownloadsPausedChanged(DownloadManager m, boolean paused) { refreshSoon(); }
            @Override public void onRequirementsStateChanged(DownloadManager m, Requirements r, int notMet) { refreshSoon(); }
        });
        KeepJob.scheduleDaily(app);
        io.execute(() -> syncOnce(false));
    }

    /** The phone's removable card's app folder, or null when there is none or it is not inserted. */
    static File removableDir(Context app) {
        try {
            File[] dirs = app.getExternalFilesDirs(null);
            for (int i = 1; dirs != null && i < dirs.length; i++) {
                File d = dirs[i];
                if (d != null && android.os.Environment.isExternalStorageRemovable(d)
                        && android.os.Environment.MEDIA_MOUNTED.equals(android.os.Environment.getExternalStorageState(d))) return d;
            }
        } catch (RuntimeException none) { /* no card */ }
        return null;
    }

    private static DataSource.Factory http() {
        return new DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true);
    }

    /** The player's data source: the download cache first (read only), then the network. */
    DataSource.Factory playback() {
        return new CacheDataSource.Factory()
                .setCache(cache)
                .setUpstreamDataSourceFactory(new DefaultDataSource.Factory(app, http()))
                .setCacheWriteDataSinkFactory(null)
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    private Requirements requirements(boolean cellular) {
        boolean anyNetwork = cellular || prefs.getBoolean("cellularOnce", false);
        return new Requirements((anyNetwork ? Requirements.NETWORK : Requirements.NETWORK_UNMETERED)
                | Requirements.DEVICE_STORAGE_NOT_LOW);
    }

    private void applyRules() {
        try {
            JSONObject rules = new JSONObject(media.downloadRules(WAIT_MS));
            onCellular = rules.optBoolean("onCellular", false);
            capMb = rules.optLong("capMb", 4096);
            removeFinished = rules.optBoolean("removeFinished", false);
            removeFinishedAfterMs = rules.optLong("removeFinishedAfterMin", 1440) * 60_000L;
            autoKeepOn = rules.optBoolean("autoKeep", true);
            autoKeepAfterMin = rules.optInt("autoKeepAfterMin", 10);
            prefs.edit().putBoolean("rule.autoKeep", autoKeepOn).putInt("rule.autoKeepAfterMin", autoKeepAfterMin).apply();
            String loc = rules.optString("location", KeepRules.INTERNAL);
            if (!loc.equals(prefs.getString("location.setting", KeepRules.INTERNAL))) {
                // Takes effect on the next start: moving between locations downloads again there.
                prefs.edit().putString("location.setting", loc).apply();
                Log.i(TAG, "keep: download location set to " + loc + " (next start; kept items download again there)");
            }
            rulesKnown = true;
            boolean c = onCellular;
            main.post(() -> manager.setRequirements(requirements(c)));
        } catch (Exception keepDefaults) { /* Wi-Fi only */ }
    }

    /** Whether a keep byte (a size check, a cover, a re-sync, a track) may be fetched on the network the phone is on now. */
    // ACCESS_NETWORK_STATE is media-service's own permission (capability.yml, pinned in
    // tools/phone-list.test.mjs); the library is linted without the merged manifest.
    @android.annotation.SuppressLint("MissingPermission")
    boolean networkAllowsNow() {
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            boolean connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            return KeepRules.networkAllows(connected, cm.isActiveNetworkMetered(), onCellular || prefs.getBoolean("cellularOnce", false));
        } catch (RuntimeException unknown) {
            return false;
        }
    }

    // ── room ─────────────────────────────────────────────────────────────────

    long freeBytes() {
        try { return new StatFs((cacheDir.exists() ? cacheDir : app.getFilesDir()).getPath()).getAvailableBytes(); }
        catch (RuntimeException unknown) { return 0; }
    }

    /** Bytes of kept audio on the phone (downloads; not the cache's own index files). */
    long keptBytes() {
        long n = 0;
        for (Download d : downloads().values()) n += Math.max(0, d.getBytesDownloaded());
        return n;
    }

    /** The limit that applies: the setting, or free space minus 2 GB, whichever is smaller. */
    long limitBytes() { return KeptIndex.effectiveLimitBytes(capMb, freeBytes(), keptBytes()); }

    /** {kept, capMb, free, limit, room (line), over (line)} for the screens. */
    JSONObject room() {
        try {
            long kept = keptBytes(), free = freeBytes(), limit = limitBytes();
            // Until the limit is read, the line leaves it out rather than show a wrong one.
            String line = rulesKnown ? KeptIndex.roomLine(kept, capMb, free)
                    : KeptIndex.size(kept) + " kept · " + KeptIndex.size(free) + " free on phone";
            return new JSONObject().put("kept", kept).put("capMb", capMb).put("free", free).put("limit", limit)
                    .put("room", line).put("over", rulesKnown ? KeptIndex.overLine(limit, kept) : "")
                    .put("location", location);
        } catch (Exception e) { return new JSONObject(); }
    }

    // ── keeping: preview (Checking), decide (Needs room / Queued), start ──────

    /**
     * What Keep would keep, before anything is saved or downloaded: its kind and count, its
     * size (on an allowed network), the room left after, the network rule, and whether to ask.
     * {@code done} hears the answer (or {ok:false, words}) on the main thread.
     */
    void preview(String mediaId, Consumer<JSONObject> done) {
        prefs.edit().putLong("checking." + mediaId, System.currentTimeMillis()).apply();
        refreshSoon();
        io.execute(() -> {
            JSONObject out;
            try {
                applyRules();
                JSONObject r = new JSONObject(media.keepMode(mediaId, "preview", 30_000));
                if (!r.optBoolean("ok", false)) {
                    out = notPreviewed(r.optString("error", ""), net.kckern.daylight.shellkit.FailureWords.reasonOf(r));
                } else {
                    JSONArray tracks = r.optJSONArray("tracks");
                    int n = tracks == null ? 0 : tracks.length();
                    long need = networkAllowsNow() ? missingBytes(tracks) : -1;
                    long limit = limitBytes(), kept = keptBytes(), free = freeBytes();
                    boolean wifiOnly = !onCellular;
                    out = new JSONObject().put("ok", true).put("contentId", r.optString("contentId")).put("title", r.optString("title"))
                            .put("kind", r.optString("kind")).put("count", n).put("need", need)
                            .put("keep", KeepRules.keepWords(r.optString("kind"), n))
                            .put("room", KeepRules.roomWords(need, limit - kept - Math.max(0, need), wifiOnly))
                            .put("fits", need < 0 || kept + need <= limit)
                            .put("needMore", Math.max(0, kept + need - limit))
                            .put("ask", need > 0 && KeepRules.askFirst(need, limit, free));
                }
            } catch (Exception e) {
                // No answer at all: Daylight still starting, or the call failed on the way.
                out = notPreviewed("unreachable", e instanceof net.kckern.daylight.api.PayloadPort.NotReadyException ? "starting" : "");
            }
            prefs.edit().remove("checking." + mediaId).apply();
            refreshSoon();
            JSONObject answer = out;
            main.post(() -> done.accept(answer));
        });
    }

    /**
     * A preview home did not answer, by cause: not found and refused are said and stop there;
     * offline, a home not answering and a start still running keep it waiting for home
     * ("away": KeepFlow then keeps it, and it is fetched when home answers).
     */
    private JSONObject notPreviewed(String error, String reason) {
        net.kckern.daylight.shellkit.FailureWords.Cause cause = "bad_request".equals(error) || "not_found".equals(error)
                ? net.kckern.daylight.shellkit.FailureWords.Cause.NOT_FOUND
                : net.kckern.daylight.shellkit.FailureWords.cause(reason, net.kckern.daylight.shellkit.FailureWords.networkValidated(app));
        String words;
        boolean away = false;
        switch (cause) {
            case NOT_FOUND: words = "This can't be kept: home does not have it"; break;
            case REFUSED: words = "This can't be kept: home refused this phone"; break;
            default: words = waitingWords(cause); away = true;
        }
        try { return new JSONObject().put("ok", false).put("away", away).put("words", words).put("cause", cause.name()); }
        catch (Exception never) { return new JSONObject(); }
    }

    /** What a keep waiting for home says, by why home did not answer. */
    static String waitingWords(net.kckern.daylight.shellkit.FailureWords.Cause cause) {
        switch (cause) {
            case OFFLINE: return "Offline: it will be kept when home answers";
            case STARTING: return "Daylight is still starting: it will be kept when home answers";
            default: return "Home isn't answering: it will be kept when it does";
        }
    }

    /**
     * Keeps the collection {@code mediaId} belongs to, the person having seen what it is and
     * its size (and confirmed, when asked). Away from home it waits ("Waiting for home").
     */
    void keep(String mediaId, Consumer<String> done) {
        event("keep.asked", null);
        io.execute(() -> {
            String line;
            try {
                applyRules();
                JSONObject reply;
                try { reply = new JSONObject(media.keepMode(mediaId, "keep", 30_000)); }
                catch (Exception noAnswer) { reply = new JSONObject().put("ok", false).put("error", "unreachable"); }
                if (!reply.optBoolean("ok", false)) {
                    JSONObject not = notPreviewed(reply.optString("error", ""), net.kckern.daylight.shellkit.FailureWords.reasonOf(reply));
                    if (!not.optBoolean("away")) line = not.optString("words");
                    else {
                        addPending(mediaId);
                        KeepJob.scheduleRetry(app);
                        line = not.optString("words");
                    }
                } else {
                    event("keep.received", new JSONObject().put("tracks", count(reply)));
                    // Kept by hand: no longer declined for automatic keeps, nothing automatic left on it.
                    String kc = reply.optString("contentId");
                    prefs.edit().remove("autoDeclined." + kc).remove("autoFinishedAt." + kc).apply();
                    autoLog.clear(kc);
                    line = decide(reply);
                }
            } catch (Exception failed) {
                Log.w(TAG, "keep failed: " + failed.getClass().getSimpleName());
                line = "Could not keep this on the phone";
            }
            refreshSoon();
            say(done, line);
        });
    }

    /**
     * Checking → Needs room or Queued, for every kept collection not yet admitted (a keep from
     * the web arrives this way, through the same rules). Admitted: its tracks are queued in
     * play order. Needs room: kept, not downloading, checked again at every sync.
     */
    private String decide(JSONObject k) throws Exception {
        String cid = k.optString("contentId");
        JSONArray tracks = k.optJSONArray("tracks");
        if (!networkAllowsNow()) {
            // The size is fetched only where a keep may fetch: decided on the next allowed network.
            prefs.edit().putBoolean("undecided." + cid, true).apply();
            return "Keeping " + Json.first(k.optString("title"), "it") + ": waiting for Wi-Fi";
        }
        long need = missingBytes(tracks);
        long kept = keptBytes(), limit = limitBytes();
        prefs.edit().remove("undecided." + cid).putLong("size." + cid, need + downloadedBytes(tracks)).apply();
        if (kept + need > limit) {
            prefs.edit().putLong("needroom." + cid, kept + need - limit).apply();
            event("keep.failed", new JSONObject().put("reason", "needs_room").put("bytes", need));
            return "Needs " + KeptIndex.size(kept + need - limit) + " more room";
        }
        prefs.edit().remove("needroom." + cid).putBoolean("admitted." + cid, true).apply();
        start(k);
        return "Keeping " + Json.first(k.optString("title"), "this") + " on this phone · " + KeptIndex.size(Math.max(1, need))
                + (onCellular ? "" : " · on Wi-Fi") + (k.optBoolean("cut") ? " · only the first 5000 tracks" : "");
    }

    private void start(JSONObject k) {
        JSONArray tracks = k.optJSONArray("tracks");
        int n = tracks == null ? 0 : tracks.length();
        String cid = k.optString("contentId");
        synchronized (downloadsLock) {
            // Removed while its size was checked (Remove runs on its own executor): not started.
            if (prefs.getBoolean("removing." + cid, false)) return;
            prefs.edit().putLong("startedAt." + cid, System.currentTimeMillis()).apply();
            // In play order: a partly kept book plays from its start. An automatic keep names
            // the part playing ("first"): it goes first, then the rest in play order from it.
            List<Integer> order = new ArrayList<>();
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < n; i++) ids.add(tracks.optJSONObject(i) == null ? "" : tracks.optJSONObject(i).optString("id"));
            for (String id : AutoKeepRules.bookOrder(ids, k.optString("first", ""))) order.add(ids.indexOf(id));
            for (int i : order) {
                JSONObject t = i < 0 ? null : tracks.optJSONObject(i);
                if (t == null) continue;
                String key = keyFor(t.optString("id"));
                Download d = download(key);
                if (d == null || d.state == Download.STATE_FAILED) add(request(key, t.optString("url")));
            }
        }
        keepCovers(k);
    }

    // ── removing ─────────────────────────────────────────────────────────────

    /** Remove one: the payload records it (its tombstone is the second key), its released tracks are deleted. */
    void remove(String contentId, String reason, Consumer<String> done) {
        prefs.edit().putBoolean("removing." + contentId, true).apply();
        // The person removed something kept automatically: it is not kept automatically again
        // (until they keep it by hand).
        if (autoInIndex(contentId)) prefs.edit().putBoolean("autoDeclined." + contentId, true).apply();
        refreshSoon();
        local.execute(() -> {
            String line = removeNow(contentId, reason) ? "Removed from this phone" : "Could not remove it";
            refreshSoon();
            say(done, line);
        });
    }

    void remove(String contentId, Consumer<String> done) { remove(contentId, "remove", done); }

    private boolean removeNow(String contentId, String reason) {
        try {
            long freed = 0;
            JSONObject reply = new JSONObject(media.unkeep(contentId, WAIT_MS));
            JSONArray orphaned = reply.optJSONArray("orphaned");
            synchronized (downloadsLock) {
            Map<String, Download> all = downloads();
            for (int i = 0; orphaned != null && i < orphaned.length(); i++) {
                String id = orphaned.getString(i);
                for (Download d : all.values()) {
                    if (!id.equals(trackOf(d.request.id))) continue;
                    freed += d.getBytesDownloaded();
                    delete(d.request.id, reason);
                }
                KEYS.remove(id);
                prefs.edit().remove("key." + id).remove("ver." + id).apply();
            }
            clearItem(contentId);
            }
            event("keep.removed", new JSONObject().put("reason", reason).put("tracks", orphaned == null ? 0 : orphaned.length()).put("bytes", freed));
            return true;
        } catch (Exception failed) {
            prefs.edit().remove("removing." + contentId).apply();
            // A keep still waiting for home lives only on this phone: it goes without home.
            boolean waitingOnly = removePendingFor(contentId) && !keptHas(contentId);
            if (waitingOnly) event("keep.removed", eventOf("reason", reason));
            return waitingOnly;
        }
    }

    private boolean keptHas(String contentId) {
        for (JSONObject k : keptItemsOrEmpty()) if (k != null && contentId.equals(k.optString("contentId"))) return true;
        return false;
    }

    private static JSONObject eventOf(String key, String value) {
        try { return new JSONObject().put(key, value); } catch (Exception never) { return new JSONObject(); }
    }

    private void clearItem(String cid) {
        SharedPreferences.Editor e = prefs.edit();
        for (String p : new String[] { "removing.", "admitted.", "size.", "paused.", "needroom.", "undecided.", "finishedAt.", "wasReady.", "startedAt.",
                "autoFinishedAt.", "autoPlayedAt.", "autoReady.", "autoSeries." }) {
            e.remove(p + cid);
        }
        e.apply();
        removePendingFor(cid);
    }

    /** Remove all (confirmed on screen, with the total). */
    void removeAll(String reason, Consumer<String> done) {
        local.execute(() -> {
            int n = 0;
            for (JSONObject k : keptItemsOrEmpty()) {
                if (k.optBoolean("auto")) prefs.edit().putBoolean("autoDeclined." + k.optString("contentId"), true).apply();
                if (removeNow(k.optString("contentId"), reason)) n++;
            }
            refreshSoon();
            say(done, n == 0 ? "Nothing to remove" : "Removed " + n + (n == 1 ? " item" : " items") + " from this phone");
        });
    }

    /** Remove finished: the books home says are finished. */
    void removeFinished(Consumer<String> done) {
        io.execute(() -> {
            int n = 0;
            for (String cid : finished()) if (removeNow(cid, "finished")) n++;
            refreshSoon();
            say(done, n == 0 ? "No finished books on this phone" : "Removed " + n + (n == 1 ? " finished book" : " finished books"));
        });
    }

    /** Cancel (the notification): stops keeping what is not ready yet. */
    void cancelUnfinished(Consumer<String> done) {
        local.execute(() -> {
            int n = 0;
            for (JSONObject e : KeptIndex.read(app.getFilesDir())) {
                if (e.optInt("total") == 0) continue;
                if (KeptIndex.ready(e) || KeptIndex.REMOVING.equals(e.optString("state"))) continue;
                // Cancelled by the person: an automatic keep is not made again by itself.
                if (e.optBoolean("auto")) prefs.edit().putBoolean("autoDeclined." + e.optString("contentId"), true).apply();
                if (removeNow(e.optString("contentId"), "cancelled")) n++;
            }
            refreshSoon();
            say(done, n == 0 ? "Nothing to cancel" : "Stopped keeping " + n + (n == 1 ? " item" : " items"));
        });
    }

    // ── pause, resume, retry, mobile data once ───────────────────────────────

    void pause(String contentId) {
        prefs.edit().putBoolean("paused." + contentId, true).apply();
        local.execute(() -> { for (String key : keysOf(contentId)) stop(key, STOP_PAUSED); refreshSoon(); });
    }

    void resume(String contentId) {
        prefs.edit().remove("paused." + contentId).apply();
        main.post(manager::resumeDownloads);
        local.execute(() -> { for (String key : keysOf(contentId)) stop(key, Download.STOP_REASON_NONE); refreshSoon(); });
    }

    void resumeAll() {
        SharedPreferences.Editor e = prefs.edit();
        for (String key : prefs.getAll().keySet()) if (key.startsWith("paused.")) e.remove(key);
        e.apply();
        main.post(() -> { manager.resumeDownloads(); manager.setStopReason(null, Download.STOP_REASON_NONE); });
        refreshSoon();
    }

    /** "Use mobile data once": what is waiting now goes on mobile data; the rule is back once it is all ready. */
    void useMobileDataOnce() {
        prefs.edit().putBoolean("cellularOnce", true).apply();
        event("keep.mobile_once", null);
        boolean c = onCellular;
        main.post(() -> manager.setRequirements(requirements(c)));
        io.execute(() -> syncOnce(false));
    }

    /** "Retry": the failed or damaged tracks of one item, with fresh stream URLs, whatever the backoff says. */
    void retry(String contentId, Consumer<String> done) {
        io.execute(() -> {
            String line;
            try {
                JSONObject reply = new JSONObject(media.keepMode("c:" + contentId, "refresh", 30_000));
                if (!reply.optBoolean("ok", false)) throw new IllegalStateException(reply.optString("error"));
                int again = 0;
                JSONArray tracks = reply.optJSONArray("tracks");
                for (int i = 0; tracks != null && i < tracks.length(); i++) {
                    JSONObject t = tracks.getJSONObject(i);
                    String key = keyFor(t.optString("id"));
                    Download d = download(key);
                    if (d == null || d.state == Download.STATE_FAILED || prefs.getBoolean("damaged." + key, false)) {
                        String reason = prefs.getString("reason." + key, "");
                        clearFailure(key);
                        prefs.edit().putBoolean("reresolved." + key, true).apply();
                        fetchAgain(key, t.optString("url"), reason);
                        again++;
                    }
                }
                line = again == 0 ? "Nothing to retry" : "Trying " + again + (again == 1 ? " track" : " tracks") + " again";
            } catch (Exception unreachable) {
                line = "Home not reachable: it will try again on its own";
            }
            refreshSoon();
            say(done, line);
        });
    }

    /** A screen's action, by name (through KeepJob, so it runs whether or not the player is up). */
    void action(String action, String contentId, String mediaId, Runnable then) {
        Consumer<String> done = line -> { if (then != null) then.run(); };
        switch (action) {
            case "keep": keep(mediaId.isEmpty() ? "c:" + contentId : mediaId, done); break;
            case "retry": retry(contentId, done); break;
            case "remove": remove(contentId, "remove", done); break;
            case "pause": pause(contentId); if (then != null) then.run(); break;
            case "resume": resume(contentId); if (then != null) then.run(); break;
            case "resume-all": resumeAll(); if (then != null) then.run(); break;
            case "cancel": cancelUnfinished(done); break;
            case "remove-all": removeAll("remove_all", done); break;
            case "remove-finished": removeFinished(done); break;
            case "mobile-once": useMobileDataOnce(); if (then != null) then.run(); break;
            case "undo": keep("c:" + contentId, done); break;
            case "resync-open": {
                // Opened online: kept lists re-synced, at most once an hour.
                long now = System.currentTimeMillis();
                boolean due = now - KeepRules.notAfterNow(prefs.getLong("resyncAt", 0), now) > 3_600_000L;
                sync(due, then);
                break;
            }
            default: if (then != null) then.run();
        }
    }

    // ── damaged ──────────────────────────────────────────────────────────────

    /**
     * A kept track failed to play (a parse error, a short file): Damaged. It is fetched again
     * from scratch on the next allowed network; the player has already skipped past it.
     */
    void markDamaged(String contentId) {
        String key = keyFor(contentId);
        prefs.edit().putBoolean("damaged." + key, true).remove("verified." + key).apply();
        event("keep.damaged", null);
        local.execute(() -> {
            String url = urlOf(key);
            if (url != null && networkAllowsNow()) fetchAgain(key, url, KeepRules.INCOMPLETE);
            else KeepJob.scheduleRetry(app);
            refreshSoon();
        });
    }

    /** The weekly self-check: every completed track's bytes and first bytes; the damaged are fetched again. */
    void verifyAll(Runnable then) {
        io.execute(() -> {
            int ok = 0, damaged = 0;
            for (Download d : downloads().values()) {
                if (d.state != Download.STATE_COMPLETED) continue;
                prefs.edit().remove("verified." + d.request.id).apply();
                if (whole(d)) ok++;
                else { damaged++; prefs.edit().putBoolean("damaged." + d.request.id, true).apply(); }
            }
            try { UiTelemetry.event("Downloads", "keep.verify", new JSONObject().put("ok", ok).put("damaged", damaged)); }
            catch (Exception ignored) { }
            syncOnce(false);
            if (then != null) then.run();
        });
    }

    // ── one sync pass ────────────────────────────────────────────────────────

    void sync(boolean resync, Runnable then) {
        io.execute(() -> {
            try { syncOnce(resync); }
            finally { if (then != null) then.run(); }
        });
    }

    private void syncOnce(boolean resync) {
        try {
            if (KeepRules.SD_MISSING.equals(location)) return;   // the card is out: nothing reconciled
            applyRules();
            JSONObject reply = keptReply();
            if (reply == null) return;                            // no real answer: change nothing
            reply = reseedIfLost(reply);
            keepPending();
            long now = System.currentTimeMillis();
            boolean due = resync || now - KeepRules.notAfterNow(prefs.getLong("resyncAt", 0), now) > KeepRules.DAY_MS;
            if (due && networkAllowsNow()) {
                resyncAll(reply.optJSONArray("items"));
                prefs.edit().putLong("resyncAt", now).apply();
                JSONObject fresh = keptReply();
                if (fresh != null) reply = fresh;
                checkFinished(now);
            }
            admit(reply.optJSONArray("items"));
            reconcile(reply, now);
            autoSweep(reply.optJSONArray("items"), now);
            autoPendingOnWifi();
            if (prefs.getBoolean("cellularOnce", false) && allReady()) {
                prefs.edit().remove("cellularOnce").apply();
                boolean c = onCellular;
                main.post(() -> manager.setRequirements(requirements(c)));
            }
        } catch (Exception later) {
            Log.i(TAG, "keep sync: " + later.getClass().getSimpleName());
        } finally {
            refreshSoon();
        }
    }

    /** Lists re-synced from home (refresh only: a collection removed meanwhile stays removed). */
    private void resyncAll(JSONArray items) {
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.optJSONObject(i);
            if (k == null) continue;
            try {
                int before = count(k);
                JSONObject r = new JSONObject(media.keepMode("c:" + k.optString("contentId"), "refresh", 30_000));
                if (r.optBoolean("ok", false) && (count(r) != before || r.optInt("releaseRefused", 0) > 0)) {
                    event("keep.resynced", new JSONObject().put("before", before).put("after", count(r))
                            .put("refused", r.optInt("releaseRefused", 0)));
                }
            } catch (Exception later) { /* the next re-sync */ }
        }
    }

    /** Items not yet admitted (a web keep, one waiting for Wi-Fi or room) go through decide; old keeps are admitted. */
    private void admit(JSONArray items) {
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.optJSONObject(i);
            if (k == null) continue;
            String cid = k.optString("contentId");
            if (prefs.getBoolean("admitted." + cid, false)) continue;
            boolean anyHere = false;
            JSONArray tracks = k.optJSONArray("tracks");
            for (int j = 0; tracks != null && j < tracks.length() && !anyHere; j++) anyHere = download(keyFor(tracks.optJSONObject(j).optString("id"))) != null;
            boolean waiting = prefs.contains("needroom." + cid) || prefs.contains("undecided." + cid);
            if (anyHere && !waiting) {
                prefs.edit().putBoolean("admitted." + cid, true).apply();   // kept before admission existed
                continue;
            }
            try {
                if (!waiting) event("keep.received", new JSONObject().put("tracks", count(k)));
                decide(k);
            } catch (Exception later) { /* next sync */ }
        }
    }

    private void reconcile(JSONObject reply, long now) throws Exception {
        JSONArray items = reply.optJSONArray("items");
        Set<String> deletable = new HashSet<>();   // content ids an explicit removal released
        JSONArray d0 = reply.optJSONArray("deletable");
        for (int i = 0; d0 != null && i < d0.length(); i++) deletable.add(d0.getString(i));
        Map<String, Download> all = downloads();
        Map<String, String> replacing = new HashMap<>();   // new version's key -> the copy playing now
        Map<String, String> wanted = new LinkedHashMap<>();
        Map<String, String> collectionOf = new HashMap<>();
        Set<String> keptAnywhere = new HashSet<>();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.getJSONObject(i);
            String cid = k.optString("contentId");
            boolean admitted = prefs.getBoolean("admitted." + cid, false);
            JSONArray tracks = k.optJSONArray("tracks");
            for (int j = 0; tracks != null && j < tracks.length(); j++) {
                JSONObject t = tracks.getJSONObject(j);
                String key = wantKey(t, all, replacing);
                keptAnywhere.add(key);
                keptAnywhere.add(keyFor(t.optString("id")));
                if (!admitted) continue;
                if (!wanted.containsKey(key)) wanted.put(key, t.optString("url"));
                collectionOf.putIfAbsent(key, cid);
            }
        }
        Set<String> retryDue = new HashSet<>();
        for (Download d : all.values()) {
            String id = d.request.id;
            if (!keptAnywhere.contains(id)) {
                // Two keys: kept by nothing, and released on purpose. Otherwise it stays.
                if (deletable.contains(trackOf(id))) delete(id, "removed");
                continue;
            }
            String old = replacing.get(id);
            if (old != null && d.state == Download.STATE_COMPLETED && whole(d)) {
                // The new file at home is whole here: the player moves to it, the old copy goes.
                String cid = trackOf(id);
                setKey(cid, id, id.contains("@") ? id.substring(id.indexOf('@') + 1) : "");
                delete(old, "replaced");
                event("keep.replaced", null);
                continue;
            }
            if (!wanted.containsKey(id)) continue;   // kept, not admitted (needs room): left as it is
            if (d.state == Download.STATE_COMPLETED && !whole(d)) {
                Log.w(TAG, "keep: a completed track is damaged, fetching it again");
                if (!prefs.getBoolean("damaged." + id, false)) event("keep.damaged", null);
                prefs.edit().putBoolean("damaged." + id, true).apply();
                if (networkAllowsNow()) fetchAgain(id, wanted.get(id), KeepRules.INCOMPLETE);
            } else if (d.state == Download.STATE_FAILED) {
                boolean reresolved = prefs.getBoolean("reresolved." + id, false);
                if (KeepRules.permanentAfter(prefs.getInt("status." + id, 0), reresolved)) continue;
                // A 404 gets one fresh URL at once; anything else waits for its backoff.
                boolean firstNotFound = KeepRules.permanent(prefs.getInt("status." + id, 0)) && !reresolved;
                if (firstNotFound || KeepRules.retryDue(prefs.getInt("attempts." + id, 1), prefs.getLong("failedAt." + id, 0), now)) retryDue.add(id);
            }
        }
        // A readd pref left behind for a track no longer kept is dropped.
        SharedPreferences.Editor clean = prefs.edit();
        for (String key : prefs.getAll().keySet()) {
            if (key.startsWith("readd.") && !keptAnywhere.contains(key.substring(6)) && !all.containsKey(key.substring(6))) clean.remove(key);
        }
        clean.apply();
        int fetched = 0;
        synchronized (downloadsLock) {
            for (Map.Entry<String, String> w : wanted.entrySet()) {
                if (all.containsKey(w.getKey()) || w.getValue().isEmpty()) continue;
                // Removed (on the local executor) since this sync read the list: not fetched again.
                String cid = collectionOf.get(w.getKey());
                if (cid != null && (!prefs.getBoolean("admitted." + cid, false) || prefs.getBoolean("removing." + cid, false))) continue;
                add(request(w.getKey(), w.getValue()));
                fetched++;
            }
        }
        if (fetched > 0) Log.i(TAG, "keep: fetching " + fetched + " kept tracks");
        if (!retryDue.isEmpty() && networkAllowsNow()) {
            Set<String> collections = new HashSet<>();
            for (String id : retryDue) collections.add(collectionOf.get(id));
            for (String cid : collections) {
                try {
                    JSONObject fresh = new JSONObject(media.keepMode("c:" + cid, "refresh", 30_000));
                    JSONArray tracks = fresh.optJSONArray("tracks");
                    for (int i = 0; tracks != null && i < tracks.length(); i++) {
                        JSONObject t = tracks.getJSONObject(i);
                        String key = keyFor(t.optString("id"));
                        if (!retryDue.contains(key)) continue;
                        prefs.edit().putBoolean("reresolved." + key, true).apply();
                        fetchAgain(key, t.optString("url"), prefs.getString("reason." + key, ""));
                    }
                } catch (Exception unreachable) { /* due again at the next sync */ }
            }
        }
        watchStalls(items);
    }

    /**
     * The download key a kept track should have: the copy there now, unless home names a
     * different file version, in which case the new version's key (fetched beside the old one,
     * which keeps playing until the new one is whole: {@code replacing}). A version seen for the
     * first time on a track already kept is recorded, not fetched again.
     */
    private String wantKey(JSONObject t, Map<String, Download> all, Map<String, String> replacing) {
        String id = t.optString("id"), v = t.optString("fileVersion", "");
        String cur = KEYS.get(id);
        if (cur == null && all.containsKey(cacheKey(id))) cur = cacheKey(id);
        String recorded = prefs.contains("ver." + id) ? prefs.getString("ver." + id, "") : null;
        if (cur == null) {
            String k = versionedKey(id, v);
            setKey(id, k, v);
            return k;
        }
        if (v.isEmpty() || v.equals(recorded)) return cur;
        if (recorded == null || recorded.isEmpty()) {
            setKey(id, cur, v);   // first sight of a version: what is here is it
            return cur;
        }
        String next = versionedKey(id, v);
        if (next.equals(cur)) return cur;
        replacing.put(next, cur);
        return next;
    }

    /** Runs downloads from a job (KeepScheduler) while they last, at most {@code maxMs}; {@code more} hears whether to go on later. */
    void runDownloads(long maxMs, Consumer<Boolean> more) {
        // The foreground service, when Android allows it here (it shows the notification).
        main.post(() -> {
            try { DownloadService.start(app, KeepService.class); }
            catch (RuntimeException notAllowedFromBackground) {
                Log.i(TAG, "keep: running downloads from the job (no foreground start allowed now)");
            }
        });
        long until = SystemClock.elapsedRealtime() + maxMs;
        Runnable[] check = new Runnable[1];
        check[0] = () -> {
            boolean idle = manager.isIdle() || manager.getDownloadsPaused() || manager.getNotMetRequirements() != 0;
            if (idle) { more.accept(false); return; }
            if (SystemClock.elapsedRealtime() >= until) { more.accept(true); return; }
            main.postDelayed(check[0], 10_000);
        };
        main.postDelayed(check[0], 10_000);
    }

    /**
     * Whole: the length known, every byte of it cached, and the first bytes audio (a page or
     * an error stored as a track is not). Checked once per completion, then remembered.
     */
    private boolean whole(Download d) {
        long len = d.contentLength;
        String key = d.request.id;
        if (len <= 0 || len == C.LENGTH_UNSET) return false;
        if (prefs.getLong("verified." + key, -1) == len && !prefs.getBoolean("damaged." + key, false)) return true;
        try {
            if (cache.getCachedBytes(key, 0, len) < len) return false;
            // The cache's index says the spans are there; the files must be too, at full length
            // (a file cut short on disk is not whole, whatever the index says).
            for (androidx.media3.datasource.cache.CacheSpan span : cache.getCachedSpans(key)) {
                if (span.file == null || !span.file.isFile() || span.file.length() < span.length) return false;
            }
            byte[] head = new byte[12];
            CacheDataSource src = new CacheDataSource(cache, null);
            int got;
            try {
                src.open(new DataSpec.Builder().setUri(Uri.parse("cache://" + key)).setKey(key).setLength(head.length).build());
                got = src.read(head, 0, head.length);
            } finally {
                src.close();
            }
            boolean audio = got >= 4 && KeepRules.looksLikeAudio(head);
            if (audio) prefs.edit().putLong("verified." + key, len).remove("damaged." + key).apply();
            return audio;
        } catch (Exception unreadable) {
            return false;
        }
    }

    private void fetchAgain(String key, String url, String reason) {
        if (url == null || url.isEmpty()) return;
        if (KeepRules.discardPartial(reason) || prefs.getBoolean("damaged." + key, false)) {
            // Never resumed onto: removed, then fetched from scratch (onDownloadRemoved adds it back).
            prefs.edit().putString("readd." + key, url).apply();
            delete(key, "refetch");
        } else {
            add(request(key, url));
        }
    }

    private void watchStalls(JSONArray items) {
        boolean met = manager.getNotMetRequirements() == 0 && !manager.getDownloadsPaused();
        long up = SystemClock.elapsedRealtime();
        Map<String, Download> all = downloads();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.optJSONObject(i);
            if (k == null) continue;
            String cid = k.optString("contentId");
            long bytes = 0;
            List<String> moving = new ArrayList<>();
            JSONArray tracks = k.optJSONArray("tracks");
            for (int j = 0; tracks != null && j < tracks.length(); j++) {
                String key = keyFor(tracks.optJSONObject(j).optString("id"));
                Download d = all.get(key);
                if (d == null) continue;
                bytes += d.getBytesDownloaded();
                if (d.state == Download.STATE_DOWNLOADING) moving.add(key);
            }
            long[] last = moved.get(cid);
            if (last == null || last[0] != bytes || moving.isEmpty()) { moved.put(cid, new long[] { bytes, up }); continue; }
            if (KeepRules.stalled(true, met, last[1], up)) {
                Log.w(TAG, "keep: stalled 30 min, restarting once");
                event("keep.stalled", jsonOf("tracks", moving.size()));
                for (String key : moving) main.post(() -> { manager.setStopReason(key, 2); manager.setStopReason(key, Download.STOP_REASON_NONE); });
                moved.put(cid, new long[] { bytes, up });
            }
        }
    }

    // ── finished books ───────────────────────────────────────────────────────

    private List<String> finished() {
        List<String> out = new ArrayList<>();
        try {
            JSONObject r = new JSONObject(media.keptFinished(WAIT_MS));
            JSONArray f = r.optJSONArray("finished");
            for (int i = 0; f != null && i < f.length(); i++) out.add(f.getString(i));
        } catch (Exception unreachable) { /* not known now */ }
        return out;
    }

    /** Marks books home calls finished; with media.removeFinished, removes one a day on, with Undo for a day. */
    private void checkFinished(long now) {
        List<String> done = finished();
        Set<String> doneSet = new HashSet<>(done);
        SharedPreferences.Editor e = prefs.edit();
        for (String key : prefs.getAll().keySet()) {
            if (key.startsWith("finishedAt.") && !doneSet.contains(key.substring(11))) e.remove(key);
        }
        for (String cid : done) if (!prefs.contains("finishedAt." + cid)) e.putLong("finishedAt." + cid, now);
        e.apply();
        if (!removeFinished) return;
        for (String cid : done) {
            if (!KeepRules.removeFinishedDue(prefs.getLong("finishedAt." + cid, 0), now, removeFinishedAfterMs)) continue;
            String title = titleOf(cid);
            boolean auto = autoInIndex(cid);
            if (!removeNow(cid, "finished_auto")) continue;
            if (auto) {
                // Kept automatically: no notification; listed on On this phone instead.
                autoLog.removed(cid, title, AutoKeepRules.FINISHED, now);
                event("keep.auto.removed", eventOf("reason", AutoKeepRules.SETTING));
            } else {
                notifyRemovedFinished(cid, title);
            }
        }
    }

    private void notifyRemovedFinished(String cid, String title) {
        try {
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW));
            Intent undo = new Intent(app, KeepService.class).setAction(ACTION_UNDO).putExtra("contentId", cid);
            PendingIntent pi = PendingIntent.getService(app, cid.hashCode(), undo, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new Notification.Builder(app, CHANNEL)
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("Removed " + (title.isEmpty() ? "a book" : title) + " from this phone (finished)")
                    .setTimeoutAfter(KeepRules.DAY_MS)
                    .addAction(new Notification.Action.Builder(null, "Undo", pi).build())
                    .setAutoCancel(true)
                    .build();
            nm.notify(UNDO_NOTIFICATION + Math.floorMod(cid.hashCode(), 50), n);
        } catch (RuntimeException notShown) { /* the row is gone; Keep brings it back */ }
    }

    // ── the kept list: answers, the mirror, pending keeps ────────────────────

    private JSONObject keptReply() {
        try {
            JSONObject reply = new JSONObject(media.kept(WAIT_MS));
            if (!reply.optBoolean("ok", false) || reply.optJSONArray("items") == null) return null;
            if (reply.optJSONArray("quarantined") == null) reply.put("quarantined", new JSONArray());
            if (reply.optJSONArray("deletable") == null) reply.put("deletable", new JSONArray());
            return reply;
        } catch (Exception noAnswer) {
            return null;
        }
    }

    private List<JSONObject> keptItemsOrEmpty() {
        List<JSONObject> out = new ArrayList<>();
        JSONObject r = keptReply();
        JSONArray items = r == null ? null : r.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) out.add(items.optJSONObject(i));
        return out;
    }

    /**
     * The shell's mirror of the kept list puts back what the payload lost: all of it (a new
     * payload, a cleared state) or one collection whose file it could not read. One removed
     * on purpose is not put back. The mirror follows the payload's list, empty included.
     */
    private JSONObject reseedIfLost(JSONObject reply) throws Exception {
        JSONArray items = reply.optJSONArray("items");
        JSONArray mirror = readMirror();
        boolean lost = (items.length() == 0 && mirror.length() > 0) || reply.optJSONArray("quarantined").length() > 0;
        if (lost && mirror.length() > 0) {
            int restored = new JSONObject(media.keptRestore(mirror, WAIT_MS)).optInt("restored", 0);
            if (restored > 0) {
                Log.w(TAG, "keep: restored " + restored + " kept collections from the shell's copy");
                event("keep.restored", new JSONObject().put("count", restored));
                JSONObject again = keptReply();
                if (again != null) reply = again;
            }
        }
        if (reply.optJSONArray("quarantined").length() == 0) writeMirror(reply.optJSONArray("items"));
        return reply;
    }

    private JSONArray readMirror() {
        try {
            File f = new File(app.getFilesDir(), MIRROR);
            return f.isFile() ? new JSONArray(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)) : new JSONArray();
        } catch (Exception unreadable) { return new JSONArray(); }
    }

    private void writeMirror(JSONArray items) {
        try {
            File tmp = new File(app.getFilesDir(), MIRROR + ".tmp");
            Files.write(tmp.toPath(), items.toString().getBytes(StandardCharsets.UTF_8));
            if (!tmp.renameTo(new File(app.getFilesDir(), MIRROR))) {
                Files.write(new File(app.getFilesDir(), MIRROR).toPath(), items.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception notWritten) { /* the next sync */ }
    }

    private synchronized JSONArray pending() {
        try { return new JSONArray(prefs.getString("pending", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private synchronized void addPending(String mediaId) {
        JSONArray p = pending();
        for (int i = 0; i < p.length(); i++) if (mediaId.equals(p.optString(i))) return;
        p.put(mediaId);
        prefs.edit().putString("pending", p.toString()).apply();
    }

    /** Drops every waiting keep the row {@code contentId} stands for ("c:" or "p:"); true if any went. */
    private synchronized boolean removePendingFor(String contentId) {
        JSONArray p = pending();
        List<String> all = new ArrayList<>();
        for (int i = 0; i < p.length(); i++) all.add(p.optString(i));
        List<String> left = KeepRules.pendingWithout(all, contentId);
        if (left.size() == all.size()) return false;
        prefs.edit().putString("pending", new JSONArray(left).toString()).apply();
        return true;
    }

    private synchronized void removePending(String mediaId) {
        JSONArray p = pending(), out = new JSONArray();
        for (int i = 0; i < p.length(); i++) if (!mediaId.equals(p.optString(i))) out.put(p.optString(i));
        prefs.edit().putString("pending", out.toString()).apply();
    }

    private void keepPending() {
        JSONArray p = pending();
        if (p.length() == 0) return;
        for (int i = 0; i < p.length(); i++) {
            String id = p.optString(i);
            try {
                JSONObject reply = new JSONObject(media.keepMode(id, "keep", 30_000));
                if (reply.optBoolean("ok", false)) {
                    removePending(id);
                    event("keep.received", new JSONObject().put("tracks", count(reply)));
                    decide(reply);
                } else if ("not_found".equals(reply.optString("error"))) {
                    removePending(id);
                }
            } catch (Exception stillAway) { /* the next sync */ }
        }
        if (pending().length() > 0) KeepJob.scheduleRetry(app);
    }

    // ── kept automatically while you listen (spec §3.10) ─────────────────────

    /** Whether media.autoKeep is on, and its threshold (a debuggable build may shorten it, see {@link #timing}). */
    boolean autoKeepOn() { return autoKeepOn; }

    int autoKeepAfterMin() { return timing().afterMin(autoKeepAfterMin); }

    /**
     * The grace and stale periods: the spec's, unless a debuggable build has
     * {@code files/autokeep-debug.json} ({graceMin, staleMin, afterMin}) to check them quickly.
     */
    private volatile AutoKeepRules.Timing timingRead;
    private volatile long timingReadAt;

    AutoKeepRules.Timing timing() {
        long up = SystemClock.elapsedRealtime();
        if (timingRead != null && up - timingReadAt < 60_000) return timingRead;
        timingRead = readTiming();
        timingReadAt = up;
        return timingRead;
    }

    private AutoKeepRules.Timing readTiming() {
        boolean debuggable = (app.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable) return AutoKeepRules.Timing.DEFAULT;
        try {
            File f = new File(app.getFilesDir(), "autokeep-debug.json");
            return AutoKeepRules.Timing.from(f.isFile() ? new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)) : null, true);
        } catch (Exception unreadable) { return AutoKeepRules.Timing.DEFAULT; }
    }

    /** {connected, metered} for the network the phone is on now. */
    @android.annotation.SuppressLint("MissingPermission")
    private boolean[] network() {
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
            boolean connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            return new boolean[] { connected, cm.isActiveNetworkMetered() };
        } catch (RuntimeException unknown) { return new boolean[] { false, true }; }
    }

    /** On Wi-Fi (connected, not metered): an item resumed from Continue listening is kept at once. */
    boolean onUnmeteredNetwork() {
        boolean[] n = network();
        return n[0] && !n[1];
    }

    /** Whether the kept item {@code contentId} (a collection) was kept automatically, by the index. */
    boolean autoInIndex(String contentId) {
        for (JSONObject k : KeptIndex.read(app.getFilesDir())) if (contentId.equals(k.optString("contentId"))) return k.optBoolean("auto");
        return false;
    }

    /** The line On this phone and the book page show for an item not kept automatically, or "". */
    String autoLine(String contentId) { return autoLog.lineFor(contentId, System.currentTimeMillis()); }

    java.util.List<JSONObject> autoLogShown() { return autoLog.shown(System.currentTimeMillis()); }

    /**
     * Keeps the collection of the item playing ({@code trackId}) automatically: a book all its
     * parts with this one first, a series ({@code listId} set) this lecture and the next two.
     * The keep rules apply (Wi-Fi unless mobile data is allowed; on mobile data this part
     * only), within the automatic share of the limit; no room: skipped and said on the row.
     * Called again as a series moves on, it moves the window; with nothing to change it
     * changes nothing. Never touches a manual keep. No notification of its own.
     */
    void autoKeep(String trackId, String listId, long heardMs, String trigger) {
        io.execute(() -> {
            try { autoKeepNow(trackId, listId, heardMs, trigger); }
            catch (Exception later) { Log.i(TAG, "keep: automatic keep not made now (" + later.getClass().getSimpleName() + ")"); }
            refreshSoon();
        });
    }

    private void autoKeepNow(String trackId, String listId, long heardMs, String trigger) throws Exception {
        if (trackId == null || trackId.isEmpty() || KeepRules.SD_MISSING.equals(location)) return;
        applyRules();
        if (!autoKeepOn) return;
        boolean series = AutoKeepRules.series(listId);
        boolean[] net = network();
        if (!net[0]) return;   // offline: tried again while listening, or by the Wi-Fi job
        if (net[1] && !onCellular) {
            // Mobile data and not allowed for keeps: nothing now; kept when the phone is on Wi-Fi.
            rememberAutoPending(trackId, listId, heardMs);
            if (prefs.getLong("autoSkippedMobile." + trackId, 0) == 0) {
                prefs.edit().putLong("autoSkippedMobile." + trackId, System.currentTimeMillis()).apply();
                event("keep.auto.skipped", eventOf("reason", "mobile_data"));
            }
            return;
        }
        JSONObject preview = new JSONObject(media.keepMode(trackId, "preview", 30_000));
        if (!preview.optBoolean("ok", false)) return;
        String cid = preview.optString("contentId"), kind = preview.optString("kind");
        if ("playlist".equals(kind)) {
            // A playlist is music: never kept automatically.
            event("keep.auto.skipped", eventOf("reason", "music"));
            return;
        }
        if (prefs.getBoolean("autoDeclined." + cid, false)) return;
        JSONObject existing = null;
        for (JSONObject k : keptItemsOrEmpty()) if (k != null && cid.equals(k.optString("contentId"))) existing = k;
        if (existing != null && !existing.optBoolean("auto")) return;   // a manual keep: left as it is
        JSONArray all = preview.optJSONArray("tracks");
        List<String> ids = new ArrayList<>();
        for (int i = 0; all != null && i < all.length(); i++) ids.add(all.getJSONObject(i).optString("id"));
        List<String> scope = AutoKeepRules.scope(series, ids, trackId, net[1], onCellular);
        if (scope == null) return;
        List<String> keptNow = existing == null ? new ArrayList<>() : idsOf(existing.optJSONArray("tracks"));
        if (existing != null && AutoKeepRules.sameParts(keptNow, scope)) {
            autoPlayed(cid);
            return;
        }
        // Room: what this keep adds, within the automatic share, nothing pushed out.
        JSONArray adding = new JSONArray();
        for (int i = 0; all != null && i < all.length(); i++) {
            JSONObject t = all.getJSONObject(i);
            if (scope.contains(t.optString("id")) && !keptNow.contains(t.optString("id"))) adding.put(t);
        }
        long need = missingBytes(adding), otherAuto = 0;
        for (JSONObject e : KeptIndex.read(app.getFilesDir())) {
            if (e.optBoolean("auto") && !cid.equals(e.optString("contentId"))) otherAuto += Math.max(e.optLong("bytes"), e.optLong("expectedBytes"));
        }
        if (!AutoKeepRules.fits(otherAuto, need, keptBytes(), limitBytes())) {
            autoLog.skipped(cid, preview.optString("title"), System.currentTimeMillis());
            event("keep.auto.skipped", new JSONObject().put("reason", "needs_room").put("bytes", need));
            return;
        }
        JSONObject reply = new JSONObject(media.keepAuto(trackId, AutoKeepRules.payloadScope(ids, scope), 30_000));
        if (!reply.optBoolean("ok", false) || reply.optBoolean("manual", false)) return;
        long now = System.currentTimeMillis();
        autoLog.clear(cid);
        prefs.edit().remove("autoPending." + trackId).remove("autoSkippedMobile." + trackId).remove("needroom." + cid)
                .remove("undecided." + cid).putBoolean("admitted." + cid, true).putLong("autoPlayedAt." + cid, now)
                .putBoolean("autoSeries." + cid, series)
                .putLong("size." + cid, need + downloadedBytes(reply.optJSONArray("tracks"))).apply();
        reply.put("first", trackId);
        start(reply);
        // On mobile data only this part was kept: the rest when the phone is on Wi-Fi.
        if (net[1] && !AutoKeepRules.sameParts(ids, scope)) rememberAutoPending(trackId, listId, heardMs);
        if (existing == null) {
            event("keep.auto.started", new JSONObject().put("kind", series ? "series" : Json.first(kind, "book"))
                    .put("minutes", heardMs / 60_000).put("trigger", trigger).put("tracks", scope.size()));
        } else {
            List<String> dropped = new ArrayList<>(keptNow);
            dropped.removeAll(scope);
            if (!dropped.isEmpty()) event("keep.auto.removed", new JSONObject().put("reason", AutoKeepRules.WINDOW).put("tracks", dropped.size()));
        }
        // What the window let go is deleted by the sync (the payload released it).
        syncOnce(false);
    }

    private static List<String> idsOf(JSONArray tracks) {
        List<String> out = new ArrayList<>();
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null) out.add(t.optString("id"));
        }
        return out;
    }

    private void rememberAutoPending(String trackId, String listId, long heardMs) {
        try {
            prefs.edit().putString("autoPending." + trackId, new JSONObject().put("listId", listId == null ? "" : listId)
                    .put("heardMs", heardMs).put("at", System.currentTimeMillis()).toString()).apply();
        } catch (Exception never) { return; }
        KeepJob.scheduleOnWifi(app);
    }

    /** Automatic keeps that waited for Wi-Fi (on mobile data, not allowed): kept now that the phone is on it. */
    private void autoPendingOnWifi() {
        if (!onUnmeteredNetwork() || !autoKeepOn) return;
        for (String key : new ArrayList<>(prefs.getAll().keySet())) {
            if (!key.startsWith("autoPending.")) continue;
            String trackId = key.substring("autoPending.".length());
            try {
                JSONObject p = new JSONObject(prefs.getString(key, "{}"));
                prefs.edit().remove(key).apply();
                autoKeepNow(trackId, p.optString("listId"), p.optLong("heardMs"), "wifi");
            } catch (Exception later) { /* the next sync */ }
        }
    }

    private void autoPlayed(String cid) {
        long now = System.currentTimeMillis();
        if (now - prefs.getLong("autoPlayedAt." + cid, 0) > 60_000) prefs.edit().putLong("autoPlayedAt." + cid, now).apply();
    }

    /**
     * The player heard {@code trackId} at this position: an automatic keep holding it was
     * played now (its 30 days start again); its book's last part heard to 97 % is finished
     * here, before home says so.
     */
    void notePlaying(String trackId, long positionMs, long durationMs) {
        local.execute(() -> {
            JSONObject k = keptHolding(trackId);
            if (k == null || !k.optBoolean("auto")) return;
            String cid = k.optString("contentId");
            autoPlayed(cid);
            JSONArray ids = k.optJSONArray("trackIds");
            boolean last = ids != null && ids.length() > 0 && trackId.equals(ids.optString(ids.length() - 1));
            if (last && !k.optBoolean("series") && "book".equals(k.optString("kind"))
                    && AutoKeepRules.heardToEnd(positionMs, durationMs) && !prefs.contains("autoFinishedAt." + cid)) {
                prefs.edit().putLong("autoFinishedAt." + cid, System.currentTimeMillis()).apply();
                KeepJob.scheduleSweep(app, timing().graceMs);
                refreshSoon();
            }
        });
    }

    /** A sweep of automatic keeps now (On this phone opened, a part ended): removals that are due happen. */
    void autoSweepSoon() { io.execute(() -> syncOnce(false)); }

    /**
     * Removes automatic keeps that are due (spec §3.10): a finished book 24 h after it was
     * finished (home says so, or the last part heard to 97 % here), anything not played for
     * 30 days. Each removal is listed 7 days with Keep again. Manual keeps are never removed here.
     */
    private void autoSweep(JSONArray items, long now) {
        List<JSONObject> auto = new ArrayList<>();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.optJSONObject(i);
            if (k != null && k.optBoolean("auto")) auto.add(k);
        }
        if (auto.isEmpty()) return;
        AutoKeepRules.Timing timing = timing();
        // Home's word on what is finished, when it answers (Mark finished on any screen).
        List<String> doneAtHome = networkAllowsNow() ? finishedOrNull() : null;
        long next = 0;
        for (JSONObject k : auto) {
            String cid = k.optString("contentId");
            if (doneAtHome != null && doneAtHome.contains(cid) && !prefs.contains("autoFinishedAt." + cid)) {
                prefs.edit().putLong("autoFinishedAt." + cid, now).apply();
            }
            // A series is never "finished" by its window's last lecture: its window moves on, and
            // one left unplayed goes after 30 days.
            long finishedAt = prefs.getBoolean("autoSeries." + cid, false) ? 0 : prefs.getLong("autoFinishedAt." + cid, 0);
            long played = prefs.getLong("autoPlayedAt." + cid, k.optLong("keptAt", now));
            String reason = AutoKeepRules.removal(true, finishedAt, played, now, timing.graceMs, timing.staleMs);
            if (reason == null) {
                long due = AutoKeepRules.nextDue(true, finishedAt, played, now, timing.graceMs, timing.staleMs);
                if (due > 0 && (next == 0 || due < next)) next = due;
                continue;
            }
            String title = k.optString("title");
            if (removeNow(cid, "auto_" + reason)) {
                autoLog.removed(cid, title, reason, now);
                event("keep.auto.removed", eventOf("reason", reason));
            }
        }
        if (next > 0) KeepJob.scheduleSweep(app, Math.max(60_000L, next - now));
    }

    /** The kept books home says are finished, or null when home did not answer. */
    private List<String> finishedOrNull() {
        try {
            JSONObject r = new JSONObject(media.keptFinished(WAIT_MS));
            if (!r.optBoolean("ok", false)) return null;
            List<String> out = new ArrayList<>();
            JSONArray f = r.optJSONArray("finished");
            for (int i = 0; f != null && i < f.length(); i++) out.add(f.getString(i));
            return out;
        } catch (Exception unreachable) { return null; }
    }

    /**
     * Where a track plays from, for the player's recovery: on this phone (its copy whole), kept
     * but not here yet (a part still downloading), or not kept.
     */
    int where(String contentId) {
        if (contentId == null || contentId.isEmpty()) return PlaybackRecovery.NOT_KEPT;
        if (playsFromPhone(contentId)) return PlaybackRecovery.ON_PHONE;
        return isKept(contentId) ? PlaybackRecovery.KEPT_NOT_YET : PlaybackRecovery.NOT_KEPT;
    }

    // ── what each screen shows, and the web ──────────────────────────────────

    boolean isKept(String contentId) { return keptHolding(contentId) != null; }

    JSONObject keptHolding(String contentId) {
        for (JSONObject k : KeptIndex.read(app.getFilesDir())) {
            if (contentId.equals(k.optString("contentId"))) return k;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) return k;
        }
        return null;
    }

    /** Whether this track plays from the phone (its file checked whole): Now playing says "Playing from this phone". */
    boolean playsFromPhone(String contentId) {
        String key = keyFor(contentId);
        Download d = download(key);
        return d != null && d.state == Download.STATE_COMPLETED && !prefs.getBoolean("damaged." + key, false)
                && prefs.getLong("verified." + key, -1) == d.contentLength;
    }

    private void refreshSoon() {
        // Many download changes in a second become one refresh.
        main.removeCallbacks(refreshNow);
        main.postDelayed(refreshNow, 1_000);
    }

    void refresh() { refreshSoon(); }

    private void refreshOnce() {
        try {
            JSONObject reply = keptReply();
            JSONArray items = reply == null ? null : reply.optJSONArray("items");
            if (items == null) return;
            Map<String, Download> all = downloads();
            JSONArray index = new JSONArray(), report = new JSONArray();
            Set<String> covers = new HashSet<>();
            int notMet = manager.getNotMetRequirements();
            boolean globallyPaused = manager.getDownloadsPaused() && !KeepRules.SD_MISSING.equals(location);
            long free = freeBytes(), limit = limitBytes();
            for (int i = 0; i < items.length(); i++) {
                JSONObject k = items.getJSONObject(i);
                String cid = k.optString("contentId");
                KeptIndex.Facts f = new KeptIndex.Facts();
                JSONArray tracks = k.optJSONArray("tracks");
                JSONArray ids = new JSONArray();
                long bytes = 0, expected = 0;
                String reason = "";
                for (int j = 0; tracks != null && j < tracks.length(); j++) {
                    JSONObject t = tracks.getJSONObject(j);
                    String id = t.optString("id"), key = keyFor(id);
                    if (t.has("artUrl")) covers.add(t.optString("artUrl"));
                    ids.put(id);
                    f.total++;
                    Download d = all.get(key);
                    if (prefs.getBoolean("damaged." + key, false)) f.damaged++;
                    if (d == null) continue;
                    bytes += d.getBytesDownloaded();
                    if (d.contentLength > 0) expected += d.contentLength;
                    if (d.state == Download.STATE_COMPLETED && whole(d)) f.done++;
                    else if (d.state == Download.STATE_FAILED) {
                        f.failed++;
                        if (reason.isEmpty()) reason = prefs.getString("reason." + key, KeepRules.UNKNOWN);
                    } else if (d.state == Download.STATE_DOWNLOADING) f.moving++;
                }
                f.removing = prefs.getBoolean("removing." + cid, false);
                f.needsRoom = prefs.contains("needroom." + cid);
                f.notAvailable = KeepRules.SD_MISSING.equals(location);
                f.paused = prefs.getBoolean("paused." + cid, false) || (globallyPaused && f.done < f.total);
                f.waitingNetwork = prefs.contains("undecided." + cid)
                        || (notMet & (Requirements.NETWORK | Requirements.NETWORK_UNMETERED)) != 0;
                f.waitingStorage = (notMet & Requirements.DEVICE_STORAGE_NOT_LOW) != 0;
                f.wasReady = prefs.getBoolean("wasReady." + cid, false);
                String state = f.state();
                if (KeptIndex.READY.equals(state) && !f.wasReady) {
                    prefs.edit().putBoolean("wasReady." + cid, true).apply();
                    long started = prefs.getLong("startedAt." + cid, 0);
                    long secs = started > 0 ? Math.max(1, (System.currentTimeMillis() - started) / 1000) : 0;
                    event("keep.ready", new JSONObject().put("tracks", f.total).put("bytes", bytes).put("seconds", secs));
                }
                long size = Math.max(Math.max(bytes, expected), prefs.getLong("size." + cid, 0));
                JSONObject e = new JSONObject().put("contentId", cid).put("title", k.optString("title")).put("kind", k.optString("kind"))
                        .put("trackIds", ids).put("done", f.done).put("total", f.total).put("failed", f.failed)
                        .put("damaged", f.damaged).put("bytes", bytes).put("expectedBytes", size).put("state", state)
                        .put("finished", prefs.contains("finishedAt." + cid))
                        .put("needBytes", prefs.getLong("needroom." + cid, 0));
                if (k.optBoolean("auto")) {
                    e.put("auto", true);
                    if (prefs.getBoolean("autoSeries." + cid, false)) e.put("series", true);
                    if (prefs.contains("autoFinishedAt." + cid)) e.put("finished", true);
                    if (KeptIndex.READY.equals(state) && !prefs.getBoolean("autoReady." + cid, false)) {
                        prefs.edit().putBoolean("autoReady." + cid, true).apply();
                        event("keep.auto.ready", new JSONObject().put("tracks", f.total).put("bytes", bytes));
                    }
                }
                if (!reason.isEmpty() && f.failed > 0) e.put("reason", reason);
                if (k.has("art")) { e.put("art", k.optString("art")); covers.add(k.optString("art")); }
                index.put(e);
                report.put(reportItem(e, free, limit));
            }
            // Kept while away, and being checked: shown, and told to the web.
            JSONArray away = pending();
            for (int i = 0; i < away.length(); i++) {
                String mid = away.optString(i);
                String cid = KeepRules.pendingContentId(mid);
                JSONObject e = new JSONObject().put("contentId", cid).put("title", "").put("trackIds", new JSONArray())
                        .put("done", 0).put("total", 0).put("failed", 0).put("bytes", 0).put("state", KeptIndex.WAITING_HOME);
                index.put(e);
                report.put(reportItem(e, free, limit));
            }
            long now = System.currentTimeMillis();
            for (String key : new ArrayList<>(prefs.getAll().keySet())) {
                if (!key.startsWith("checking.")) continue;
                if (now - KeepRules.notAfterNow(prefs.getLong(key, 0), now) > 120_000) { prefs.edit().remove(key).apply(); continue; }
                JSONObject e = new JSONObject().put("contentId", key.substring(9)).put("title", "").put("trackIds", new JSONArray())
                        .put("done", 0).put("total", 0).put("failed", 0).put("bytes", 0).put("state", KeptIndex.CHECKING);
                index.put(e);
                report.put(reportItem(e, free, limit));
            }
            KeptIndex.write(app.getFilesDir(), index, capMb);
            // Something unfinished: a persisted job keeps watch, so a reboot, an update or the
            // process going away resumes it by itself (a minute after, on any network).
            if (!allReady(index)) KeepJob.scheduleRetry(app);
            net.kckern.daylight.shellkit.PlaylistArtwork.keepOnly(covers);
            // Saving covers and telling the web go to the network executor: the index never waits on them.
            boolean fetchCovers = networkAllowsNow();
            io.execute(() -> {
                if (fetchCovers) for (String c : covers) net.kckern.daylight.shellkit.PlaylistArtwork.keep(c);
                try { media.keepsReport(report, WAIT_MS); } catch (Exception later) { /* the next refresh */ }
            });
        } catch (Exception unavailable) {
            Log.i(TAG, "kept index not refreshed: " + unavailable.getClass().getSimpleName());
        }
    }

    /**
     * One item for the web (POST /device/:id/keeps): the phone's own state name and words, its
     * tracks (so the web can match a track to the album holding it), sizes and the room.
     */
    private JSONObject reportItem(JSONObject e, long free, long limit) throws Exception {
        String state = e.optString("state");
        JSONObject o = new JSONObject().put("contentId", e.optString("contentId")).put("state", state)
                .put("done", e.optInt("done")).put("total", e.optInt("total")).put("failed", e.optInt("failed"))
                .put("bytes", e.optLong("bytes")).put("totalBytes", e.optLong("expectedBytes"))
                .put("neededBytes", e.optLong("needBytes")).put("finished", e.optBoolean("finished"))
                .put("freeBytes", free).put("limitBytes", limit)
                .put("trackIds", e.optJSONArray("trackIds") == null ? new JSONArray() : e.optJSONArray("trackIds"));
        if (!e.optString("title").isEmpty()) o.put("title", e.optString("title"));
        // Kept automatically while listening (spec §3.10): the web says so.
        if (e.optBoolean("auto")) o.put("auto", true);
        // The phone's own words, so the web says exactly what the phone says.
        o.put("reason", e.has("reason") && !KeptIndex.READY.equals(state) ? e.optString("reason") : KeptIndex.describe(e));
        return o;
    }

    /** For the notification: {items, done, total} over what is not ready yet. */
    int[] progress() {
        int items = 0, done = 0, total = 0;
        for (JSONObject e : KeptIndex.read(app.getFilesDir())) {
            if (KeptIndex.ready(e) || e.optInt("total") == 0) continue;
            items++;
            done += e.optInt("done");
            total += e.optInt("total");
        }
        return new int[] { items, done, total };
    }

    /** The downloads notification's title: "Keeping The Book for offline" when only automatic keeps are moving. */
    String notificationTitle() {
        int items = 0, done = 0, total = 0;
        List<String> autoTitles = new ArrayList<>();
        for (JSONObject e : KeptIndex.read(app.getFilesDir())) {
            if (KeptIndex.ready(e) || e.optInt("total") == 0) continue;
            items++;
            done += e.optInt("done");
            total += e.optInt("total");
            if (e.optBoolean("auto")) autoTitles.add(e.optString("title"));
        }
        return AutoKeepRules.notificationTitle(items, done, total, autoTitles);
    }

    /** Every item ready, or waiting on something only the person or the phone can change (room, a pause, a card). */
    private static boolean allReady(JSONArray index) {
        for (int i = 0; i < index.length(); i++) {
            String s = index.optJSONObject(i).optString("state");
            if (!(KeptIndex.READY.equals(s) || KeptIndex.PAUSED.equals(s) || KeptIndex.NEEDS_ROOM.equals(s)
                    || KeptIndex.NOT_AVAILABLE.equals(s) || KeptIndex.PARTLY_READY.equals(s))) return false;
        }
        return true;
    }

    private boolean allReady() {
        for (JSONObject e : KeptIndex.read(app.getFilesDir())) if (!KeptIndex.ready(e)) return false;
        return true;
    }

    // ── failures and completions ─────────────────────────────────────────────

    private void failed(String key, Exception e) {
        String reason = e == null ? KeepRules.UNKNOWN : KeepRules.reasonFor(e);
        int status = e == null ? 0 : KeepRules.statusOf(e);
        int attempts = prefs.getInt("attempts." + key, 0) + 1;
        prefs.edit().putString("reason." + key, reason).putInt("status." + key, status)
                .putInt("attempts." + key, attempts).putLong("failedAt." + key, System.currentTimeMillis()).apply();
        Log.w(TAG, "keep: a track failed (" + reason + ", attempt " + attempts + ")");
        event("keep.failed", jsonOf("reason", reason, "status", status, "attempt", attempts));
        if (!KeepRules.permanentAfter(status, prefs.getBoolean("reresolved." + key, false))) KeepJob.scheduleRetry(app);
    }

    private void completed(String key) {
        clearFailure(key);
        prefs.edit().remove("reresolved." + key).apply();
    }

    private void clearFailure(String key) {
        prefs.edit().remove("reason." + key).remove("status." + key).remove("attempts." + key).remove("failedAt." + key).apply();
    }

    // ── the download manager ─────────────────────────────────────────────────

    private static DownloadRequest request(String key, String url) {
        return new DownloadRequest.Builder(key, Uri.parse(url)).setCustomCacheKey(key).build();
    }

    /** One read of every download (one cursor), by id. */
    private Map<String, Download> downloads() {
        Map<String, Download> out = new HashMap<>();
        try (DownloadCursor c = manager.getDownloadIndex().getDownloads()) {
            while (c.moveToNext()) out.put(c.getDownload().request.id, c.getDownload());
        } catch (Exception unreadable) { /* none known now */ }
        return out;
    }

    private Download download(String key) {
        try { return manager.getDownloadIndex().getDownload(key); } catch (Exception e) { return null; }
    }

    private List<String> keysOf(String cid) {
        List<String> out = new ArrayList<>();
        for (JSONObject e : KeptIndex.read(app.getFilesDir())) {
            if (!cid.equals(e.optString("contentId"))) continue;
            JSONArray ids = e.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) out.add(keyFor(ids.optString(i)));
        }
        return out;
    }

    private String urlOf(String key) {
        for (JSONObject k : keptItemsOrEmpty()) {
            JSONArray tracks = k.optJSONArray("tracks");
            for (int i = 0; tracks != null && i < tracks.length(); i++) {
                JSONObject t = tracks.optJSONObject(i);
                if (t != null && key.equals(keyFor(t.optString("id")))) return t.optString("url");
            }
        }
        return null;
    }

    private String titleOf(String cid) {
        for (JSONObject e : KeptIndex.read(app.getFilesDir())) if (cid.equals(e.optString("contentId"))) return e.optString("title");
        return "";
    }

    /**
     * Through the service started in the foreground, so it shows the grouped notification and
     * keeps going with the app closed; where Android refuses a foreground start (from the
     * background, Android 12+) straight to the manager, run by the job (KeepJob).
     */
    private void add(DownloadRequest r) {
        try { DownloadService.sendAddDownload(app, KeepService.class, r, true); }
        catch (RuntimeException notNow) { main.post(() -> manager.addDownload(r)); }
    }

    private void stop(String key, int reason) {
        try { DownloadService.sendSetStopReason(app, KeepService.class, key, reason, false); }
        catch (RuntimeException notNow) { main.post(() -> manager.setStopReason(key, reason)); }
    }

    private void delete(String key, String why) {
        try { DownloadService.sendRemoveDownload(app, KeepService.class, key, false); }
        catch (RuntimeException notNow) { main.post(() -> manager.removeDownload(key)); }
        if (!"refetch".equals(why)) {
            clearFailure(key);
            prefs.edit().remove("damaged." + key).remove("verified." + key).remove("reresolved." + key).remove("readd." + key).apply();
        }
    }

    private void keepCovers(JSONObject reply) {
        if (!networkAllowsNow()) return;
        Set<String> covers = new HashSet<>();
        if (reply.has("art")) covers.add(reply.optString("art"));
        JSONArray tracks = reply.optJSONArray("tracks");
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null && t.has("artUrl")) covers.add(t.optString("artUrl"));
        }
        for (String c : covers) net.kckern.daylight.shellkit.PlaylistArtwork.keep(c);
    }

    /** Sizes are read six at a time ("Checking size…" for a 24-track album takes seconds, not 20). */
    private final ExecutorService sizer = Executors.newFixedThreadPool(6, r -> {
        Thread t = new Thread(r, "Daylight-keep-size");
        t.setDaemon(true);
        return t;
    });

    private long missingBytes(JSONArray tracks) {
        List<java.util.concurrent.Future<Long>> sizes = new ArrayList<>();
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t == null) continue;
            Download d = download(keyFor(t.optString("id")));
            if (d != null && d.state == Download.STATE_COMPLETED) continue;
            String url = t.optString("url");
            sizes.add(sizer.submit(() -> size(url)));
        }
        long need = 0;
        for (java.util.concurrent.Future<Long> f : sizes) {
            try { need += f.get(12, java.util.concurrent.TimeUnit.SECONDS); } catch (Exception unknown) { /* counts 0 */ }
        }
        return need;
    }

    private long downloadedBytes(JSONArray tracks) {
        long have = 0;
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            Download d = t == null ? null : download(keyFor(t.optString("id")));
            if (d != null && d.state == Download.STATE_COMPLETED) have += d.getBytesDownloaded();
        }
        return have;
    }

    private static int count(JSONObject k) {
        JSONArray t = k.optJSONArray("tracks");
        return t == null ? 0 : t.length();
    }

    private static long size(String url) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("HEAD");
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            long n = c.getContentLengthLong();
            c.disconnect();
            return Math.max(0, n);
        } catch (Exception unknown) {
            return 0;
        }
    }

    private void say(Consumer<String> done, String line) {
        if (done == null || line == null) return;
        main.post(() -> done.accept(line));
    }

    private static JSONObject jsonOf(Object... kv) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]); } catch (Exception ignored) { }
        return o;
    }

    /** keep.* events: no titles, sizes and counts only; sent offline-first with the tap telemetry. */
    private static void event(String name, JSONObject data) {
        try { UiTelemetry.event("Downloads", name, data == null ? new JSONObject() : data); }
        catch (Exception ignored) { }
    }

    /** First non-empty string. */
    private static final class Json {
        static String first(String a, String b) { return a == null || a.isEmpty() ? b : a; }
    }
}
