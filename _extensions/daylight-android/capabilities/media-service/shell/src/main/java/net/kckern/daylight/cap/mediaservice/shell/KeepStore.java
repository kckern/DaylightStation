package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * "Keep on this phone": whole collections (a book, an album, a playlist) downloaded with
 * Media3's download stack into one cache in the app's own storage (files/media-cache), and
 * the player reading through that cache first, so a kept track plays with no network.
 *
 * <p>Every track is keyed by its content id ({@link #cacheKey}), not its URL, so a play
 * resolved later (with another session in the URL, or offline from the payload's kept
 * list) finds it. Downloads wait for Wi-Fi unless media.downloadOnCellular, and for
 * storage that is not low. A new collection that would take the cache past
 * media.downloadCapMb is refused before anything is fetched. The state of every kept
 * collection is written to shell-kit's {@link KeptIndex} for the phone home to show.
 * The playback cache is read-only: only downloads write to it.
 */
final class KeepStore {
    private static final String TAG = "Daylight-Media";
    private static final long WAIT_MS = 15_000;
    private static KeepStore instance;

    final DownloadManager manager;
    private final Context app;
    private final SimpleCache cache;
    private final PayloadMedia media = new PayloadMedia();
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-keep");
        t.setDaemon(true);
        return t;
    });
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Boolean> wasComplete = new HashMap<>();
    private volatile long capMb = 4096;

    static synchronized KeepStore get(Context context) {
        if (instance == null) instance = new KeepStore(context.getApplicationContext());
        return instance;
    }

    static String cacheKey(String contentId) { return "track:" + contentId; }

    private KeepStore(Context app) {
        this.app = app;
        net.kckern.daylight.shellkit.PlaylistArtwork.useKept(new File(app.getFilesDir(), "kept-art"));
        StandaloneDatabaseProvider db = new StandaloneDatabaseProvider(app);
        cache = new SimpleCache(new File(app.getFilesDir(), "media-cache"), new NoOpCacheEvictor(), db);
        manager = new DownloadManager(app, db, cache, http(), Executors.newFixedThreadPool(2));
        manager.setMaxParallelDownloads(2);
        manager.setRequirements(requirements(false));
        manager.addListener(new DownloadManager.Listener() {
            @Override public void onDownloadChanged(DownloadManager m, Download d, Exception e) { refresh(); }
            @Override public void onDownloadRemoved(DownloadManager m, Download d) { refresh(); }
            @Override public void onRequirementsStateChanged(DownloadManager m, Requirements r, int notMet) { refresh(); }
        });
        io.execute(() -> { applyRules(); reconcile(); });
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
            boolean cellular = rules.optBoolean("onCellular", false);
            capMb = rules.optLong("capMb", 4096);
            main.post(() -> manager.setRequirements(requirements(cellular)));
        } catch (Exception keepDefaults) { /* Wi-Fi only */ }
    }

    /**
     * Keeps the collection {@code mediaId} belongs to. {@code done} hears a line to show
     * ("Keeping A book: 12 tracks", or why not), on the main thread.
     */
    void keep(String mediaId, Consumer<String> done) {
        io.execute(() -> {
            String line;
            try {
                JSONObject reply = new JSONObject(media.keep(mediaId, 30_000));
                if (!reply.optBoolean("ok", false)) throw new IllegalStateException(reply.optString("error", "refused"));
                JSONArray tracks = reply.optJSONArray("tracks");
                int n = tracks == null ? 0 : tracks.length();
                long need = 0;
                for (int i = 0; i < n; i++) {
                    JSONObject t = tracks.getJSONObject(i);
                    Download d = manager.getDownloadIndex().getDownload(cacheKey(t.optString("id")));
                    if (d != null && d.state == Download.STATE_COMPLETED) continue;
                    need += size(t.optString("url"));
                }
                long used = cache.getCacheSpace();
                long cap = reply.optLong("capMb", 4096);
                capMb = cap;
                if (!KeptIndex.fits(cap, used, need)) {
                    media.unkeep(reply.optString("contentId"), WAIT_MS);
                    line = "Not enough room: " + KeptIndex.size(need) + " more would pass the " + cap + " MB set for downloads";
                    event("download.refused", reply, n, need);
                } else {
                    boolean cellular = reply.optBoolean("onCellular", false);
                    main.post(() -> manager.setRequirements(requirements(cellular)));
                    for (int i = 0; i < n; i++) {
                        JSONObject t = tracks.getJSONObject(i);
                        String key = cacheKey(t.optString("id"));
                        DownloadRequest request = new DownloadRequest.Builder(key, Uri.parse(t.optString("url")))
                                .setCustomCacheKey(key).build();
                        DownloadService.sendAddDownload(app, KeepService.class, request, false);
                    }
                    // The covers, for showing it offline: the collection's and each track's.
                    Set<String> covers = new HashSet<>();
                    if (reply.has("art")) covers.add(reply.optString("art"));
                    for (int i = 0; i < n; i++) if (tracks.getJSONObject(i).has("artUrl")) covers.add(tracks.getJSONObject(i).optString("artUrl"));
                    for (String c : covers) net.kckern.daylight.shellkit.PlaylistArtwork.keep(c);
                    line = "Keeping " + reply.optString("title", "this") + " on this phone: " + n + (n == 1 ? " track" : " tracks")
                            + (need > 0 ? ", " + KeptIndex.size(need) : "") + (cellular ? "" : " (on Wi-Fi)");
                    event("download.start", reply, n, need);
                    Log.i(TAG, "keep " + n + " tracks, " + need / 1_000_000 + " MB");
                }
            } catch (Exception failed) {
                Log.w(TAG, "keep failed: " + failed.getClass().getSimpleName());
                line = "Could not keep this on the phone";
            }
            refresh();
            String said = line;
            main.post(() -> done.accept(said));
        });
    }

    /** Forgets the kept collection {@code contentId} and deletes the audio no other kept collection uses. */
    void remove(String contentId, Consumer<String> done) {
        io.execute(() -> {
            String line;
            try {
                JSONObject reply = new JSONObject(media.unkeep(contentId, WAIT_MS));
                JSONArray orphaned = reply.optJSONArray("orphaned");
                for (int i = 0; orphaned != null && i < orphaned.length(); i++) {
                    DownloadService.sendRemoveDownload(app, KeepService.class, cacheKey(orphaned.getString(i)), false);
                }
                line = "Removed from this phone";
                UiTelemetry.event("Downloads", "download.remove", new JSONObject().put("tracks", orphaned == null ? 0 : orphaned.length()));
            } catch (Exception failed) {
                line = "Could not remove it";
            }
            refresh();
            String said = line;
            main.post(() -> done.accept(said));
        });
    }

    /** Whether {@code contentId} (a track or a collection) is kept, whole or in part. */
    boolean isKept(String contentId) {
        for (JSONObject k : KeptIndex.read(app.getFilesDir())) {
            if (contentId.equals(k.optString("contentId"))) return true;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) return true;
        }
        return false;
    }

    /** The kept collection holding {@code contentId}, or null. */
    JSONObject keptHolding(String contentId) {
        for (JSONObject k : KeptIndex.read(app.getFilesDir())) {
            if (contentId.equals(k.optString("contentId"))) return k;
            JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) return k;
        }
        return null;
    }

    /** Rewrites the kept index from the payload's kept list and the download states. Off the main thread. */
    void refresh() {
        io.execute(() -> {
            try {
                JSONArray items = keptItems();
                if (items == null) return;      // no answer is not "nothing kept": the index stays
                JSONArray index = new JSONArray();
                Set<String> covers = new HashSet<>();
                boolean waiting = manager.getNotMetRequirements() != 0;
                for (int i = 0; items != null && i < items.length(); i++) {
                    JSONObject k = items.getJSONObject(i);
                    JSONArray tracks = k.optJSONArray("tracks");
                    JSONArray ids = new JSONArray();
                    int done = 0, failed = 0;
                    long bytes = 0;
                    for (int j = 0; tracks != null && j < tracks.length(); j++) {
                        String id = tracks.getJSONObject(j).optString("id");
                        if (tracks.getJSONObject(j).has("artUrl")) covers.add(tracks.getJSONObject(j).optString("artUrl"));
                        ids.put(id);
                        Download d = manager.getDownloadIndex().getDownload(cacheKey(id));
                        if (d == null) continue;
                        if (d.state == Download.STATE_COMPLETED) { done++; bytes += d.getBytesDownloaded(); }
                        else if (d.state == Download.STATE_FAILED) failed++;
                    }
                    String cid = k.optString("contentId");
                    int total = ids.length();
                    JSONObject e = new JSONObject().put("contentId", cid).put("title", k.optString("title"))
                            .put("trackIds", ids).put("done", done).put("total", total).put("failed", failed)
                            .put("bytes", bytes).put("waiting", waiting && done < total);
                    if (k.has("art")) { e.put("art", k.optString("art")); covers.add(k.optString("art")); }
                    index.put(e);
                    boolean complete = total > 0 && done == total;
                    if (complete && !Boolean.TRUE.equals(wasComplete.get(cid)) && wasComplete.containsKey(cid)) {
                        UiTelemetry.event("Downloads", "download.complete", new JSONObject().put("tracks", total).put("bytes", bytes));
                    }
                    if (failed > 0 && !wasComplete.containsKey(cid + "#failed")) {
                        wasComplete.put(cid + "#failed", true);
                        UiTelemetry.event("Downloads", "download.fail", new JSONObject().put("tracks", total).put("failed", failed));
                    }
                    wasComplete.put(cid, complete);
                }
                KeptIndex.write(app.getFilesDir(), index, capMb);
                net.kckern.daylight.shellkit.PlaylistArtwork.keepOnly(covers);
                // A cover not saved yet (kept while the art host was unreachable) is fetched now.
                if (manager.getNotMetRequirements() == 0) {
                    for (String c : covers) net.kckern.daylight.shellkit.PlaylistArtwork.keep(c);
                }
            } catch (Exception unavailable) {
                Log.i(TAG, "kept index not refreshed: " + unavailable.getClass().getSimpleName());
            }
        });
    }

    /** Audio of a collection no longer kept (forgotten from another screen) is deleted. */
    private void reconcile() {
        try {
            // Only a real answer deletes audio. A payload that cannot say what is kept (an
            // older one after a rollback, one still starting) must never empty the phone.
            JSONArray items = keptItems();
            if (items == null) { refresh(); return; }
            Map<String, String> wanted = new HashMap<>();   // cache key -> stream URL
            for (int i = 0; i < items.length(); i++) {
                JSONArray tracks = items.getJSONObject(i).optJSONArray("tracks");
                for (int j = 0; tracks != null && j < tracks.length(); j++) {
                    JSONObject t = tracks.getJSONObject(j);
                    wanted.put(cacheKey(t.optString("id")), t.optString("url"));
                }
            }
            Set<String> present = new HashSet<>();
            try (DownloadCursor c = manager.getDownloadIndex().getDownloads()) {
                while (c.moveToNext()) {
                    String id = c.getDownload().request.id;
                    present.add(id);
                    if (!wanted.containsKey(id)) DownloadService.sendRemoveDownload(app, KeepService.class, id, false);
                }
            }
            // A kept track with no download (its audio lost): fetched again on the next allowed network.
            int restored = 0;
            for (Map.Entry<String, String> w : wanted.entrySet()) {
                if (present.contains(w.getKey()) || w.getValue().isEmpty()) continue;
                DownloadService.sendAddDownload(app, KeepService.class,
                        new DownloadRequest.Builder(w.getKey(), Uri.parse(w.getValue())).setCustomCacheKey(w.getKey()).build(), false);
                restored++;
            }
            if (restored > 0) Log.i(TAG, "keep: fetching " + restored + " kept tracks again");
        } catch (Exception later) { /* the next start reconciles */ }
        refresh();
    }


    /** The payload's kept collections, or null when it gave no real answer. */
    private JSONArray keptItems() {
        try {
            JSONObject reply = new JSONObject(media.kept(WAIT_MS));
            return reply.optBoolean("ok", false) ? reply.optJSONArray("items") : null;
        } catch (Exception noAnswer) {
            return null;
        }
    }

    /** A track's size from its stream (a HEAD that follows the redirect to the file); 0 when unknown. */
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

    private static void event(String name, JSONObject reply, int tracks, long bytes) {
        try { UiTelemetry.event("Downloads", name, new JSONObject().put("tracks", tracks).put("bytes", bytes)); }
        catch (Exception ignored) { }
    }
}
