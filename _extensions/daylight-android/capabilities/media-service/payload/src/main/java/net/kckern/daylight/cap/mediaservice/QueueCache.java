package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.function.LongSupplier;

/**
 * The last answer home gave for a music list's queue, played at once on the next tap while a
 * fresh answer is fetched for the time after (stale while revalidate). A long playlist's
 * queue takes home 1.6 s to build (967 tracks, measured 2026-11-26), and the first sound
 * waited on it every time. ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md.
 *
 * <p>Only music is cached: an answer with any item 20 min or longer, or with a saved place,
 * is a book, a talk or a course, whose place must come from home each time. A shuffled
 * answer is cached under its own key; each play uses the order fetched after the last one,
 * so two plays never repeat an order. Everything else is passed straight to home.
 */
final class QueueCache implements MediaApi {
    /** An answer older than this is not played without asking home first. */
    static final long MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000;
    static final int MAX_LISTS = 30;
    /** An item this long or longer (ms) makes the list a book, talk or course. */
    static final long LONG_ITEM_MS = 20L * 60 * 1000;

    private final MediaApi home;
    private final File dir;
    private final Executor refresher;
    private final LongSupplier clock;
    private final Set<String> refreshing = ConcurrentHashMap.newKeySet();
    /** What the last queue() did: "hit", "miss" or "pass" (for the play log line and tests). */
    volatile String last = "";

    QueueCache(MediaApi home, File dir, Executor refresher, LongSupplier clock) {
        this.home = home;
        this.dir = dir;
        this.refresher = refresher;
        this.clock = clock;
        if (dir != null) dir.mkdirs();
    }

    @Override public JSONObject queue(String contentId) throws Exception { return queue(contentId, false); }

    @Override public JSONObject queue(String contentId, boolean shuffle) throws Exception {
        String key = contentId + (shuffle ? "|shuffle" : "");
        File file = fileFor(key);
        JSONObject cached = read(file);
        if (cached != null && clock.getAsLong() - file.lastModified() < MAX_AGE_MS) {
            last = "hit";
            refreshLater(key, contentId, shuffle, file);
            return cached;
        }
        JSONObject fresh = home.queue(contentId, shuffle);
        last = store(file, fresh) ? "miss" : "pass";
        return fresh;
    }

    private void refreshLater(String key, String contentId, boolean shuffle, File file) {
        if (!refreshing.add(key)) return;
        try {
            refresher.execute(() -> {
                try { if (!store(file, home.queue(contentId, shuffle))) file.delete(); }   // now a book: forget it
                catch (Exception notNow) { /* the cached answer stays; next tap tries again */ }
                finally { refreshing.remove(key); }
            });
        } catch (RuntimeException stopping) {
            refreshing.remove(key);
        }
    }

    /** True when the answer is music and was kept. */
    private boolean store(File file, JSONObject answer) {
        if (file == null || !musicOnly(answer)) return false;
        try {
            File tmp = new File(file.getPath() + ".tmp");
            Files.write(tmp.toPath(), answer.toString().getBytes(StandardCharsets.UTF_8));
            if (!tmp.renameTo(file)) { tmp.delete(); return false; }
            file.setLastModified(clock.getAsLong());
            trim();
            return true;
        } catch (Exception full) {
            return false;
        }
    }

    /** Every item shorter than LONG_ITEM_MS and none with a saved place. */
    static boolean musicOnly(JSONObject answer) {
        JSONArray items = answer == null ? null : answer.optJSONArray("items");
        if (items == null || items.length() == 0) return false;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) return false;
            if (Json.seconds(item, "duration") >= LONG_ITEM_MS) return false;   // Json.seconds answers ms
            if (Json.seconds(item, "resume_position") > 0 || Json.seconds(item, "resumePosition") > 0) return false;
        }
        return true;
    }

    private void trim() {
        File[] all = dir.listFiles((d, name) -> name.endsWith(".json"));
        if (all == null || all.length <= MAX_LISTS) return;
        Arrays.sort(all, Comparator.comparingLong(File::lastModified));
        for (int i = 0; i < all.length - MAX_LISTS; i++) all[i].delete();
    }

    private File fileFor(String key) {
        if (dir == null) return null;
        try {
            byte[] h = MessageDigest.getInstance("SHA-1").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < 10; i++) s.append(String.format("%02x", h[i]));
            return new File(dir, s + ".json");
        } catch (Exception none) {
            return null;
        }
    }

    private static JSONObject read(File file) {
        if (file == null || !file.isFile()) return null;
        try { return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)); }
        catch (Exception unreadable) { file.delete(); return null; }
    }

    // ── everything else goes to home unchanged ─────────────────────────────
    @Override public JSONObject rootList() throws Exception { return home.rootList(); }
    @Override public JSONObject list(String contentId, int take, int skip) throws Exception { return home.list(contentId, take, skip); }
    @Override public JSONObject recent(int limit) throws Exception { return home.recent(limit); }
    @Override public JSONObject audioSources() throws Exception { return home.audioSources(); }
    @Override public JSONObject audioLists(String source, int cursor) throws Exception { return home.audioLists(source, cursor); }
    @Override public JSONObject play(String contentId, boolean resume) throws Exception { return home.play(contentId, resume); }
    @Override public JSONObject search(String text, int take) throws Exception { return home.search(text, take); }
    @Override public JSONObject log(JSONObject body) throws Exception { return home.log(body); }
    @Override public JSONObject levels(String contentId, int samples) throws Exception { return home.levels(contentId, samples); }
    @Override public JSONObject lyrics(String contentId) throws Exception { return home.lyrics(contentId); }
    @Override public JSONObject chapters(String contentId) throws Exception { return home.chapters(contentId); }
    @Override public JSONObject info(String contentId) throws Exception { return home.info(contentId); }
    @Override public JSONObject libraries() throws Exception { return home.libraries(); }
    @Override public void markWatched(String contentId, boolean watched) throws Exception { home.markWatched(contentId, watched); }
}
