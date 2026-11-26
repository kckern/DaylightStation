package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
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
 * Media3's download stack into one cache in the app's own files (files/media-cache, which
 * "Clear cache" never touches), and the player reading through that cache first, so a kept
 * track plays with no network, and never streams when it is kept.
 *
 * <p>Built against what users report about Plex, Plexamp, Emby and Jellyfin downloads
 * (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md):
 * <ul>
 * <li>Never stuck: Media3's scheduler starts a waiting download when the phone joins an
 *   allowed network, app closed (KeepService); a failed track is tried again after a minute,
 *   ten, an hour, then daily, with a fresh stream URL from the payload, unless the library no
 *   longer has it; a download whose bytes have not moved for 30 minutes is restarted once.</li>
 * <li>Never lost: audio is deleted only for tracks the payload's kept list says an explicit
 *   removal (or a re-sync of a playlist) released. A list that reads empty or short for any
 *   other reason deletes nothing, and one that reads empty while the shell's mirror does
 *   not is put back from the mirror. A lowered cap deletes nothing.</li>
 * <li>Always says what is happening: one state per collection (ready, downloading n of m,
 *   waiting for Wi-Fi / storage / home, failed with a reason, no room), written to shell-kit's
 *   KeptIndex for every screen and sent to the web through the payload's inbox.</li>
 * <li>Ready means whole: a completed track whose cached bytes are short is fetched again
 *   from scratch; a failure from a full phone discards the partial file.</li>
 * <li>No byte on a forbidden network: the size check, covers, re-sync and every track wait
 *   for Wi-Fi unless media.downloadOnCellular.</li>
 * <li>Kept while away: a keep asked for while home cannot be reached waits ("Waiting for
 *   home") and is kept when home answers.</li>
 * </ul>
 * Every track is keyed by its content id ({@link #cacheKey}), not its URL, so a play resolved
 * any way (Continue, a widget, the car, the web's Play on phone, offline from the payload)
 * finds it, and a track two collections hold is stored once.
 */
final class KeepStore {
    private static final String TAG = "Daylight-Media";
    private static final long WAIT_MS = 15_000;
    private static final String PREFS = "daylight.keep";
    private static final String MIRROR = "kept-mirror.json";
    private static KeepStore instance;

    /** Asks the person before a big keep; answers on the main thread. */
    interface Asker {
        void ask(String title, long needBytes, long capMb, Runnable yes, Runnable no);
    }

    final DownloadManager manager;
    private final Context app;
    private final SimpleCache cache;
    private final SharedPreferences prefs;
    private final PayloadMedia media = new PayloadMedia();
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-keep");
        t.setDaemon(true);
        return t;
    });
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Boolean> wasComplete = new HashMap<>();
    private volatile long capMb = 4096;
    private volatile boolean onCellular;

    static synchronized KeepStore get(Context context) {
        if (instance == null) instance = new KeepStore(context.getApplicationContext());
        return instance;
    }

    static String cacheKey(String contentId) { return "track:" + contentId; }

    static String trackOf(String cacheKey) { return cacheKey.startsWith("track:") ? cacheKey.substring(6) : cacheKey; }

    private KeepStore(Context app) {
        this.app = app;
        this.prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        net.kckern.daylight.shellkit.PlaylistArtwork.useKept(new File(app.getFilesDir(), "kept-art"));
        StandaloneDatabaseProvider db = new StandaloneDatabaseProvider(app);
        cache = new SimpleCache(new File(app.getFilesDir(), "media-cache"), new NoOpCacheEvictor(), db);
        manager = new DownloadManager(app, db, cache, http(), Executors.newFixedThreadPool(2));
        manager.setMaxParallelDownloads(2);
        manager.setRequirements(requirements(false));
        manager.addListener(new DownloadManager.Listener() {
            @Override public void onDownloadChanged(DownloadManager m, Download d, Exception e) {
                if (d.state == Download.STATE_FAILED) io.execute(() -> failed(d.request.id, e));
                if (d.state == Download.STATE_COMPLETED) io.execute(() -> clearFailure(d.request.id));
                refresh();
            }
            @Override public void onDownloadRemoved(DownloadManager m, Download d) {
                // A track removed to be fetched from scratch (a full phone, a short file).
                String again = prefs.getString("readd." + d.request.id, "");
                if (!again.isEmpty()) {
                    prefs.edit().remove("readd." + d.request.id).apply();
                    add(request(d.request.id, again));
                }
                refresh();
            }
            @Override public void onRequirementsStateChanged(DownloadManager m, Requirements r, int notMet) { refresh(); }
        });
        KeepJob.scheduleDaily(app);
        io.execute(() -> sync(false));
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

    private static Requirements requirements(boolean onCellular) {
        return new Requirements((onCellular ? Requirements.NETWORK : Requirements.NETWORK_UNMETERED)
                | Requirements.DEVICE_STORAGE_NOT_LOW);
    }

    private void applyRules() {
        try {
            JSONObject rules = new JSONObject(media.downloadRules(WAIT_MS));
            onCellular = rules.optBoolean("onCellular", false);
            capMb = rules.optLong("capMb", 4096);
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
            return KeepRules.networkAllows(connected, cm.isActiveNetworkMetered(), onCellular);
        } catch (RuntimeException unknown) {
            return false;   // when in doubt, fetch nothing
        }
    }

    // ── keep, remove, retry ──────────────────────────────────────────────────

    /**
     * Keeps the collection {@code mediaId} belongs to. {@code asker} (may be null: the web
     * asked) is asked first when it is over a quarter of the space set for downloads.
     * {@code done} hears a line to show, on the main thread.
     */
    void keep(String mediaId, Asker asker, Consumer<String> done) {
        io.execute(() -> {
            String line;
            try {
                applyRules();
                JSONObject reply;
                try {
                    reply = new JSONObject(media.keep(mediaId, 30_000));
                } catch (Exception noPayloadAnswer) {
                    reply = new JSONObject().put("ok", false).put("error", "unreachable");
                }
                if (!reply.optBoolean("ok", false)) {
                    String error = reply.optString("error", "");
                    if (error.equals("not_found") || error.equals("bad_request")) {
                        line = "This can't be kept: home does not have it";
                    } else {
                        // Home not reachable (away, a captive Wi-Fi): kept when it answers.
                        addPending(mediaId);
                        KeepJob.scheduleRetry(app);
                        line = "Waiting for home: it will be kept when home answers";
                        event("download.waiting-home", 0, 0);
                    }
                } else {
                    line = afterResolve(reply, asker, done);
                }
            } catch (Exception failed) {
                Log.w(TAG, "keep failed: " + failed.getClass().getSimpleName());
                line = "Could not keep this on the phone";
            }
            refresh();
            if (line != null) say(done, line);
        });
    }

    /** The collection is resolved and kept by the payload: size it, weigh it, start it. Null line: asked, answer later. */
    private String afterResolve(JSONObject reply, Asker asker, Consumer<String> done) throws Exception {
        JSONArray tracks = reply.optJSONArray("tracks");
        int n = tracks == null ? 0 : tracks.length();
        String cid = reply.optString("contentId"), title = reply.optString("title", "this");
        capMb = reply.optLong("capMb", capMb);
        onCellular = reply.optBoolean("onCellular", onCellular);
        // The size, only where a keep may fetch: a HEAD per track is still bytes on the network.
        long need = networkAllowsNow() ? missingBytes(tracks) : -1;
        long used = cache.getCacheSpace();
        if (need >= 0 && !KeptIndex.fits(capMb, used, need)) {
            media.unkeep(cid, WAIT_MS);
            prefs.edit().putString("refused." + cid, new JSONObject().put("title", title).put("need", need)
                    .put("art", reply.optString("art", "")).toString()).apply();
            event("download.refused", n, need);
            return "No room: " + KeptIndex.size(need) + " more would pass the " + capMb + " MB set for downloads";
        }
        prefs.edit().remove("refused." + cid).apply();
        if (need >= 0 && asker != null && KeepRules.askFirst(need, capMb)) {
            long needed = need;
            main.post(() -> asker.ask(title, needed, capMb,
                    () -> io.execute(() -> { say(done, start(reply, needed)); refresh(); }),
                    () -> remove(cid, line -> say(done, "Not kept"))));
            return null;
        }
        return start(reply, need);
    }

    private String start(JSONObject reply, long need) {
        JSONArray tracks = reply.optJSONArray("tracks");
        int n = tracks == null ? 0 : tracks.length();
        boolean cellular = reply.optBoolean("onCellular", false);
        main.post(() -> manager.setRequirements(requirements(cellular)));
        // In play order: a partly kept book plays from its start.
        for (int i = 0; i < n; i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null) add(request(cacheKey(t.optString("id")), t.optString("url")));
        }
        keepCovers(reply);
        event("download.start", n, Math.max(0, need));
        Log.i(TAG, "keep " + n + " tracks" + (need > 0 ? ", " + need / 1_000_000 + " MB" : ""));
        return "Keeping " + reply.optString("title", "this") + " on this phone: " + n + (n == 1 ? " track" : " tracks")
                + (need > 0 ? ", " + KeptIndex.size(need) : "") + (cellular ? "" : " (on Wi-Fi)")
                + (reply.optBoolean("cut") ? ". Only the first 5000 tracks" : "");
    }

    /** Forgets the kept collection {@code contentId}: the payload records it, and its tracks no other collection holds are deleted. */
    void remove(String contentId, Consumer<String> done) {
        io.execute(() -> {
            String line;
            try {
                prefs.edit().remove("refused." + contentId).apply();
                removePending("c:" + contentId);
                JSONObject reply = new JSONObject(media.unkeep(contentId, WAIT_MS));
                JSONArray orphaned = reply.optJSONArray("orphaned");
                for (int i = 0; orphaned != null && i < orphaned.length(); i++) {
                    delete(cacheKey(orphaned.getString(i)), "remove");
                }
                line = "Removed from this phone";
                UiTelemetry.event("Downloads", "download.remove", new JSONObject().put("tracks", orphaned == null ? 0 : orphaned.length()));
            } catch (Exception failed) {
                line = "Could not remove it";
            }
            refresh();
            say(done, line);
        });
    }

    /** "Retry now": the failed tracks of one collection, with fresh stream URLs, whatever the backoff says. */
    void retry(String contentId, Consumer<String> done) {
        io.execute(() -> {
            String line;
            try {
                JSONObject reply = new JSONObject(media.keep("c:" + contentId, 30_000));
                if (!reply.optBoolean("ok", false)) throw new IllegalStateException(reply.optString("error"));
                int again = 0;
                JSONArray tracks = reply.optJSONArray("tracks");
                for (int i = 0; tracks != null && i < tracks.length(); i++) {
                    JSONObject t = tracks.getJSONObject(i);
                    String key = cacheKey(t.optString("id"));
                    Download d = manager.getDownloadIndex().getDownload(key);
                    if (d == null || d.state == Download.STATE_FAILED) {
                        clearFailure(key);
                        fetchAgain(key, t.optString("url"), prefs.getString("reason." + key, ""));
                        again++;
                    }
                }
                line = again == 0 ? "Nothing to retry" : "Trying " + again + (again == 1 ? " track" : " tracks") + " again";
                event("download.retry", again, 0);
            } catch (Exception unreachable) {
                line = "Home not reachable: it will try again on its own";
            }
            refresh();
            say(done, line);
        });
    }

    // ── one sync pass: what is kept, against what is on the phone ────────────

    /**
     * Brings the phone in line with the payload's kept list: missing tracks fetched, failed
     * ones tried again when due, short ones fetched from scratch, stalls restarted, removed
     * ones deleted (only those), and (when {@code resync}, or a day on) every kept list
     * resolved again so a playlist kept in March is not March's forever. Then the states
     * are written and reported. Runs on the keep thread; {@code then} runs after.
     */
    void sync(boolean resync, Runnable then) {
        io.execute(() -> {
            try { sync(resync); }
            finally { if (then != null) then.run(); }
        });
    }

    private void sync(boolean resync) {
        try {
            applyRules();
            JSONObject reply = keptReply();
            // No real answer (an older payload, one still starting): change nothing.
            if (reply == null) return;
            reply = reseedIfLost(reply);
            keepPending();
            long now = System.currentTimeMillis();
            boolean due = resync || now - prefs.getLong("resyncAt", 0) > KeepRules.DAY_MS;
            if (due && networkAllowsNow() && reply.optJSONArray("quarantined").length() == 0) {
                JSONArray items = reply.optJSONArray("items");
                for (int i = 0; items != null && i < items.length(); i++) {
                    try { media.keep("c:" + items.getJSONObject(i).optString("contentId"), 30_000); }
                    catch (Exception later) { /* the next re-sync */ }
                }
                prefs.edit().putLong("resyncAt", now).apply();
                JSONObject fresh = keptReply();
                if (fresh != null) reply = fresh;
            }
            reconcile(reply, now);
        } catch (Exception later) {
            Log.i(TAG, "keep sync: " + later.getClass().getSimpleName());
        } finally {
            refresh();
        }
    }

    private void reconcile(JSONObject reply, long now) throws Exception {
        JSONArray items = reply.optJSONArray("items");
        Set<String> deletable = new HashSet<>();
        JSONArray d0 = reply.optJSONArray("deletable");
        for (int i = 0; d0 != null && i < d0.length(); i++) deletable.add(cacheKey(d0.getString(i)));
        Map<String, String> wanted = new LinkedHashMap<>();   // cache key -> stream URL, in play order
        Map<String, String> collectionOf = new HashMap<>();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.getJSONObject(i);
            JSONArray tracks = k.optJSONArray("tracks");
            for (int j = 0; tracks != null && j < tracks.length(); j++) {
                JSONObject t = tracks.getJSONObject(j);
                String key = cacheKey(t.optString("id"));
                if (!wanted.containsKey(key)) wanted.put(key, t.optString("url"));
                collectionOf.putIfAbsent(key, k.optString("contentId"));
            }
        }
        Set<String> present = new HashSet<>();
        Set<String> retryDue = new HashSet<>();
        List<Download> all = new ArrayList<>();
        try (DownloadCursor c = manager.getDownloadIndex().getDownloads()) {
            while (c.moveToNext()) all.add(c.getDownload());
        }
        for (Download d : all) {
            String id = d.request.id;
            present.add(id);
            if (!wanted.containsKey(id)) {
                // Two keys: not wanted, and released on purpose. Otherwise it stays.
                if (deletable.contains(id)) delete(id, "removed");
                continue;
            }
            if (d.state == Download.STATE_COMPLETED && !whole(d)) {
                Log.w(TAG, "keep: a completed track is short, fetching it again");
                prefs.edit().putString("reason." + id, KeepRules.INCOMPLETE).apply();
                fetchAgain(id, wanted.get(id), KeepRules.INCOMPLETE);
            } else if (d.state == Download.STATE_FAILED) {
                int status = prefs.getInt("status." + id, 0);
                if (KeepRules.permanent(status)) continue;
                long at = KeepRules.retryAt(prefs.getInt("attempts." + id, 1), prefs.getLong("failedAt." + id, 0));
                if (now >= at) retryDue.add(id);
            }
        }
        // Missing kept tracks (new on a re-synced list, or audio lost): fetched, in play order.
        int fetched = 0;
        for (Map.Entry<String, String> w : wanted.entrySet()) {
            if (present.contains(w.getKey()) || w.getValue().isEmpty()) continue;
            add(request(w.getKey(), w.getValue()));
            fetched++;
        }
        if (fetched > 0) Log.i(TAG, "keep: fetching " + fetched + " kept tracks");
        // Failed tracks that are due: a fresh URL for each, from its collection resolved again.
        if (!retryDue.isEmpty() && networkAllowsNow()) {
            Set<String> collections = new HashSet<>();
            for (String id : retryDue) collections.add(collectionOf.get(id));
            for (String cid : collections) {
                try {
                    JSONObject fresh = new JSONObject(media.keep("c:" + cid, 30_000));
                    JSONArray tracks = fresh.optJSONArray("tracks");
                    for (int i = 0; tracks != null && i < tracks.length(); i++) {
                        JSONObject t = tracks.getJSONObject(i);
                        String key = cacheKey(t.optString("id"));
                        if (retryDue.contains(key)) fetchAgain(key, t.optString("url"), prefs.getString("reason." + key, ""));
                    }
                    event("download.retry", retryDue.size(), 0);
                } catch (Exception unreachable) { /* due again at the next sync */ }
            }
        }
        watchStalls(items, now);
    }

    /** A completed track is whole when its cached bytes cover its length (unknown length: trusted). */
    private boolean whole(Download d) {
        long len = d.contentLength;
        if (len <= 0) return true;
        try { return cache.getCachedBytes(d.request.customCacheKey != null ? d.request.customCacheKey : d.request.id, 0, len) >= len; }
        catch (RuntimeException unknown) { return true; }
    }

    /** Fetches a track again: from scratch when its partial file cannot be trusted, else resumed. */
    private void fetchAgain(String key, String url, String reason) {
        if (url == null || url.isEmpty()) return;
        if (KeepRules.discardPartial(reason)) {
            prefs.edit().putString("readd." + key, url).apply();
            delete(key, "refetch");
        } else {
            add(request(key, url));
        }
    }

    private void watchStalls(JSONArray items, long now) {
        boolean met = manager.getNotMetRequirements() == 0;
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.optJSONObject(i);
            if (k == null) continue;
            String cid = k.optString("contentId");
            long bytes = 0;
            boolean downloading = false;
            List<String> moving = new ArrayList<>();
            JSONArray tracks = k.optJSONArray("tracks");
            for (int j = 0; tracks != null && j < tracks.length(); j++) {
                String key = cacheKey(tracks.optJSONObject(j).optString("id"));
                Download d;
                try { d = manager.getDownloadIndex().getDownload(key); } catch (Exception e) { d = null; }
                if (d == null) continue;
                bytes += d.getBytesDownloaded();
                if (d.state == Download.STATE_DOWNLOADING || d.state == Download.STATE_QUEUED) { downloading = true; moving.add(key); }
            }
            long last = prefs.getLong("bytes." + cid, -1);
            if (bytes != last || !downloading) {
                prefs.edit().putLong("bytes." + cid, bytes).putLong("movedAt." + cid, now).apply();
                continue;
            }
            if (KeepRules.stalled(true, met, prefs.getLong("movedAt." + cid, 0), now)) {
                Log.w(TAG, "keep: stalled 30 min, restarting once");
                event("download.stalled", moving.size(), bytes);
                for (String key : moving) {
                    main.post(() -> { manager.setStopReason(key, 1); manager.setStopReason(key, Download.STOP_REASON_NONE); });
                }
                prefs.edit().putLong("movedAt." + cid, now).apply();
            }
        }
    }

    // ── the kept list: answers, the mirror, pending keeps ────────────────────

    /** The payload's kept list with what may be deleted and what it could not read; null without a real answer. */
    private JSONObject keptReply() {
        try {
            JSONObject reply = new JSONObject(media.kept(WAIT_MS));
            if (!reply.optBoolean("ok", false)) return null;
            if (reply.optJSONArray("items") == null) return null;
            if (reply.optJSONArray("quarantined") == null) reply.put("quarantined", new JSONArray());
            if (reply.optJSONArray("deletable") == null) reply.put("deletable", new JSONArray());
            if (reply.optJSONArray("quarantined").length() > 0) {
                Log.w(TAG, "keep: " + reply.optJSONArray("quarantined").length() + " kept files could not be read; deleting nothing");
                reply.put("deletable", new JSONArray());
            }
            return reply;
        } catch (Exception noAnswer) {
            return null;
        }
    }

    /**
     * The shell remembers the last kept list it was told. A payload that answers with an
     * empty list while the mirror is not (a new payload, a cleared state) is given it back;
     * otherwise the mirror follows the payload.
     */
    private JSONObject reseedIfLost(JSONObject reply) throws Exception {
        JSONArray items = reply.optJSONArray("items");
        JSONArray mirror = readMirror();
        if (items.length() == 0 && mirror.length() > 0) {
            JSONObject r = new JSONObject(media.keptRestore(mirror, WAIT_MS));
            int restored = r.optInt("restored", 0);
            if (restored > 0) {
                Log.w(TAG, "keep: the payload had lost " + restored + " kept collections; restored from the shell");
                event("download.restored", restored, 0);
                JSONObject again = keptReply();
                if (again != null) return again;
            }
            return reply;
        }
        if (reply.optJSONArray("quarantined").length() == 0) writeMirror(items);
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

    private synchronized void removePending(String mediaId) {
        JSONArray p = pending(), out = new JSONArray();
        for (int i = 0; i < p.length(); i++) if (!mediaId.equals(p.optString(i))) out.put(p.optString(i));
        prefs.edit().putString("pending", out.toString()).apply();
    }

    /** Keeps asked for while home could not be reached: kept now, if it answers (on an allowed network). */
    private void keepPending() {
        JSONArray p = pending();
        if (p.length() == 0 || !networkAllowsNow()) return;
        for (int i = 0; i < p.length(); i++) {
            String id = p.optString(i);
            try {
                JSONObject reply = new JSONObject(media.keep(id, 30_000));
                if (reply.optBoolean("ok", false)) {
                    removePending(id);
                    afterResolve(reply, null, null);
                } else if ("not_found".equals(reply.optString("error"))) {
                    removePending(id);
                }
            } catch (Exception stillAway) { /* the next sync */ }
        }
        if (pending().length() > 0) KeepJob.scheduleRetry(app);
    }

    // ── what each screen shows, and the web ──────────────────────────────────

    /** Whether {@code contentId} (a track or a collection) is kept, whole or in part. */
    boolean isKept(String contentId) { return keptHolding(contentId) != null; }

    /** The kept collection holding {@code contentId}, or null. */
    JSONObject keptHolding(String contentId) {
        for (JSONObject k : KeptIndex.read(app.getFilesDir())) {
            if (contentId.equals(k.optString("contentId"))) return k;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) return k;
        }
        return null;
    }

    /** Rewrites the kept index (one state per collection) and sends the list to the web. Off the main thread. */
    void refresh() {
        io.execute(() -> {
            try {
                JSONObject reply = keptReply();
                JSONArray items = reply == null ? null : reply.optJSONArray("items");
                if (items == null) return;      // no answer is not "nothing kept": the index stays
                JSONArray index = new JSONArray();
                JSONArray report = new JSONArray();
                Set<String> covers = new HashSet<>();
                int notMet = manager.getNotMetRequirements();
                boolean waitingNetwork = (notMet & (Requirements.NETWORK | Requirements.NETWORK_UNMETERED)) != 0;
                boolean waitingStorage = (notMet & Requirements.DEVICE_STORAGE_NOT_LOW) != 0;
                long used = 0;
                for (int i = 0; i < items.length(); i++) {
                    JSONObject k = items.getJSONObject(i);
                    JSONArray tracks = k.optJSONArray("tracks");
                    JSONArray ids = new JSONArray();
                    int done = 0, failed = 0;
                    long bytes = 0;
                    String reason = "";
                    for (int j = 0; tracks != null && j < tracks.length(); j++) {
                        JSONObject t = tracks.getJSONObject(j);
                        String id = t.optString("id");
                        if (t.has("artUrl")) covers.add(t.optString("artUrl"));
                        ids.put(id);
                        Download d = manager.getDownloadIndex().getDownload(cacheKey(id));
                        if (d == null) continue;
                        bytes += d.getBytesDownloaded();
                        if (d.state == Download.STATE_COMPLETED && whole(d)) done++;
                        else if (d.state == Download.STATE_FAILED) {
                            failed++;
                            if (reason.isEmpty()) reason = prefs.getString("reason." + cacheKey(id), KeepRules.UNKNOWN);
                        }
                    }
                    used += bytes;
                    String cid = k.optString("contentId");
                    int total = ids.length();
                    String state = KeptIndex.stateOf(done, total, failed, waitingNetwork, waitingStorage, false);
                    JSONObject e = new JSONObject().put("contentId", cid).put("title", k.optString("title"))
                            .put("trackIds", ids).put("done", done).put("total", total).put("failed", failed)
                            .put("bytes", bytes).put("waiting", waitingNetwork && done < total).put("state", state);
                    if (!reason.isEmpty() && failed > 0) e.put("reason", reason);
                    if (k.has("art")) { e.put("art", k.optString("art")); covers.add(k.optString("art")); }
                    index.put(e);
                    report.put(reportItem(cid, KeptIndex.reportState(state), done, total, bytes, failed > 0 ? reason : state.startsWith("waiting") ? KeptIndex.describe(e) : ""));
                    noteCompletion(cid, total, done, failed, bytes);
                }
                // Kept while away, and refused for room: shown, and told to the web.
                JSONArray waitingHome = pending();
                for (int i = 0; i < waitingHome.length(); i++) {
                    String mid = waitingHome.optString(i);
                    String cid = mid.startsWith("c:") ? mid.substring(2) : mid.startsWith("p:") ? mid.substring(2).split("\\|")[0] : mid;
                    index.put(new JSONObject().put("contentId", cid).put("title", "Waiting for home").put("trackIds", new JSONArray())
                            .put("done", 0).put("total", 0).put("failed", 0).put("bytes", 0).put("state", KeptIndex.WAITING_HOME));
                    report.put(reportItem(cid, "queued", 0, 0, 0, "Waiting for home"));
                }
                for (String key : prefs.getAll().keySet()) {
                    if (!key.startsWith("refused.")) continue;
                    String cid = key.substring(8);
                    JSONObject r = new JSONObject(prefs.getString(key, "{}"));
                    index.put(new JSONObject().put("contentId", cid).put("title", r.optString("title")).put("trackIds", new JSONArray())
                            .put("done", 0).put("total", 0).put("failed", 0).put("bytes", 0).put("state", KeptIndex.REFUSED)
                            .put("needBytes", r.optLong("need")).put("art", r.optString("art")));
                    report.put(reportItem(cid, "refused", 0, 0, 0, "No room: needs " + KeptIndex.size(r.optLong("need")) + " more"));
                }
                KeptIndex.write(app.getFilesDir(), index, capMb);
                net.kckern.daylight.shellkit.PlaylistArtwork.keepOnly(covers);
                // A cover not saved yet: fetched now, only where a keep may fetch.
                if (networkAllowsNow()) for (String c : covers) net.kckern.daylight.shellkit.PlaylistArtwork.keep(c);
                if (KeptIndex.overCap(capMb, used) > 0) Log.i(TAG, "keep: over the cap by " + KeptIndex.overCap(capMb, used) / 1_000_000 + " MB (nothing deleted)");
                try { media.keepsReport(report, WAIT_MS); } catch (Exception later) { /* the next refresh */ }
            } catch (Exception unavailable) {
                Log.i(TAG, "kept index not refreshed: " + unavailable.getClass().getSimpleName());
            }
        });
    }

    private static JSONObject reportItem(String cid, String state, int done, int total, long bytes, String reason) throws Exception {
        JSONObject o = new JSONObject().put("contentId", cid).put("state", state).put("done", done).put("total", total).put("bytes", bytes);
        if (reason != null && !reason.isEmpty()) o.put("reason", reason);
        return o;
    }

    private void noteCompletion(String cid, int total, int done, int failed, long bytes) {
        boolean complete = total > 0 && done == total;
        try {
            if (complete && wasComplete.containsKey(cid) && !Boolean.TRUE.equals(wasComplete.get(cid))) {
                long started = prefs.getLong("startedAt." + cid, 0);
                long secs = started > 0 ? Math.max(1, (System.currentTimeMillis() - started) / 1000) : 0;
                JSONObject data = new JSONObject().put("tracks", total).put("bytes", bytes);
                if (secs > 0) data.put("seconds", secs).put("mbPerSecond", Math.round(bytes / 1e5 / secs) / 10.0);
                UiTelemetry.event("Downloads", "download.complete", data);
            }
            if (failed > 0 && !wasComplete.containsKey(cid + "#failed")) {
                wasComplete.put(cid + "#failed", true);
                UiTelemetry.event("Downloads", "download.fail", new JSONObject().put("tracks", total).put("failed", failed));
            }
        } catch (Exception ignored) { }
        if (!complete && !prefs.contains("startedAt." + cid)) prefs.edit().putLong("startedAt." + cid, System.currentTimeMillis()).apply();
        if (complete) prefs.edit().remove("startedAt." + cid).apply();
        wasComplete.put(cid, complete);
    }

    // ── failures ─────────────────────────────────────────────────────────────

    private void failed(String key, Exception e) {
        String reason = e == null ? KeepRules.UNKNOWN : KeepRules.reasonFor(e);
        int status = e == null ? 0 : KeepRules.statusOf(e);
        int attempts = prefs.getInt("attempts." + key, 0) + 1;
        prefs.edit().putString("reason." + key, reason).putInt("status." + key, status)
                .putInt("attempts." + key, attempts).putLong("failedAt." + key, System.currentTimeMillis()).apply();
        Log.w(TAG, "keep: a track failed (" + reason + ", attempt " + attempts + ")");
        // The next try is due later: a job wakes for it even with the app closed.
        if (!KeepRules.permanent(status)) KeepJob.scheduleRetry(app);
    }

    private void clearFailure(String key) {
        prefs.edit().remove("reason." + key).remove("status." + key).remove("attempts." + key).remove("failedAt." + key).apply();
    }

    // ── the download manager, through the service when it may start ──────────

    private static DownloadRequest request(String key, String url) {
        return new DownloadRequest.Builder(key, Uri.parse(url)).setCustomCacheKey(key).build();
    }

    /** Adds through the service (a foreground notification while it works); when Android will not start it now, straight to the manager, and the scheduler carries on. */
    private void add(DownloadRequest r) {
        try { DownloadService.sendAddDownload(app, KeepService.class, r, false); }
        catch (RuntimeException notNow) { main.post(() -> manager.addDownload(r)); }
    }

    private void delete(String key, String why) {
        try { DownloadService.sendRemoveDownload(app, KeepService.class, key, false); }
        catch (RuntimeException notNow) { main.post(() -> manager.removeDownload(key)); }
        if (!"refetch".equals(why)) {
            clearFailure(key);
            try { UiTelemetry.event("Downloads", "download.deleted", new JSONObject().put("reason", why)); } catch (Exception ignored) { }
        }
    }

    /** Covers for showing it offline: the collection's and each track's, only where a keep may fetch. */
    private void keepCovers(JSONObject reply) {
        if (!networkAllowsNow()) return;   // fetched by refresh() on the next allowed network
        Set<String> covers = new HashSet<>();
        if (reply.has("art")) covers.add(reply.optString("art"));
        JSONArray tracks = reply.optJSONArray("tracks");
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null && t.has("artUrl")) covers.add(t.optString("artUrl"));
        }
        for (String c : covers) net.kckern.daylight.shellkit.PlaylistArtwork.keep(c);
    }

    /** Bytes still to fetch for {@code tracks}: a HEAD per missing track (following the redirect to the file); unknown sizes count 0. */
    private long missingBytes(JSONArray tracks) {
        long need = 0;
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t == null) continue;
            try {
                Download d = manager.getDownloadIndex().getDownload(cacheKey(t.optString("id")));
                if (d != null && d.state == Download.STATE_COMPLETED) continue;
            } catch (Exception ignored) { }
            need += size(t.optString("url"));
        }
        return need;
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

    private static void event(String name, int tracks, long bytes) {
        try { UiTelemetry.event("Downloads", name, new JSONObject().put("tracks", tracks).put("bytes", bytes)); }
        catch (Exception ignored) { }
    }
}
