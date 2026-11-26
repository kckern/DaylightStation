package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * The collections kept on this phone ("Keep on this phone"): a book, an album, a playlist,
 * a household list. Each is one JSON file holding its title, cover and resolved tracks
 * (ids, titles, artist, album, art, durations, stream URLs), so an offline play of the
 * collection is answered from here when the backend cannot be reached. The audio itself is
 * in the shell's download cache, keyed by track content id. Plain java.io; thread-safe.
 *
 * <p>Nothing kept is ever lost by accident. A removal is recorded as a <b>tombstone</b>
 * (the collection, when, and the tracks no other kept collection holds): the shell deletes
 * audio only for tracks a tombstone names, so a list that reads empty or short for any other
 * reason (a corrupt file, a half-written directory, an older payload) deletes nothing. A
 * file that cannot be read is moved to {@code _bad/} and named in {@link #quarantined()},
 * never treated as removed.
 */
final class KeptCollections {
    static final int MAX_TOMBSTONES = 200;
    private static final String TOMBSTONES = "removed.tomb";
    private final File dir;

    KeptCollections(File dir) { this.dir = dir; }

    synchronized void save(String contentId, String title, String art, JSONArray tracks, long now) throws Exception {
        save(contentId, title, art, tracks, now, "");
    }

    synchronized void save(String contentId, String title, String art, JSONArray tracks, long now, String kind) throws Exception {
        if (!ContentId.valid(contentId)) throw new IllegalArgumentException("not a content id");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        write(new File(dir, fileName(contentId)), record(contentId, title, art, tracks, now, kind).toString());
        clearQuarantine(contentId);
        // Kept again: its old removal no longer deletes anything.
        JSONObject tombs = tombstones();
        if (tombs.remove(contentId) != null) writeTombstones(tombs);
    }

    /**
     * A re-sync's fresh tracks for a collection that is still kept: written only if it is kept
     * and was not removed meanwhile (a web Remove racing a re-sync wins). Its keptAt stays.
     */
    synchronized boolean refreshIfKept(String contentId, String title, String art, JSONArray tracks, long now, String kind) throws Exception {
        JSONObject before = get(contentId);
        if (before == null || tombstoned(contentId)) return false;
        JSONObject o = record(contentId, title, art, tracks, before.optLong("keptAt", now), kind);
        o.put("refreshedAt", now);
        write(new File(dir, fileName(contentId)), o.toString());
        return true;
    }

    private static JSONObject record(String contentId, String title, String art, JSONArray tracks, long keptAt, String kind) throws Exception {
        JSONObject o = new JSONObject().put("contentId", contentId).put("title", title == null ? "" : title)
                .put("tracks", tracks).put("keptAt", keptAt);
        if (art != null && !art.isEmpty()) o.put("art", art);
        if (kind != null && !kind.isEmpty()) o.put("kind", kind);
        return o;
    }

    /** A collection written again: its unreadable copy (quarantined) is no longer needed. */
    private void clearQuarantine(String contentId) {
        File bad = new File(new File(dir, "_bad"), fileName(contentId));
        //noinspection ResultOfMethodCallIgnored
        bad.delete();
    }

    synchronized JSONObject get(String contentId) {
        if (!ContentId.valid(contentId)) return null;
        return read(new File(dir, fileName(contentId)));
    }

    /** Newest kept first. A file that cannot be read is quarantined, not dropped silently. */
    synchronized List<JSONObject> list() {
        List<JSONObject> out = new ArrayList<>();
        File[] files = dir.listFiles((d, n) -> n.endsWith(".json"));
        if (files == null) return out;
        for (File f : files) {
            JSONObject o = read(f);
            if (o != null && ContentId.valid(o.optString("contentId"))) out.add(o);
            else quarantine(f);
        }
        out.sort((a, b) -> Long.compare(b.optLong("keptAt"), a.optLong("keptAt")));
        return out;
    }

    /** The names of kept files that could not be read (moved to _bad/). While any exist, nothing is deleted. */
    synchronized List<String> quarantined() {
        List<String> names = new ArrayList<>();
        File[] bad = new File(dir, "_bad").listFiles();
        if (bad != null) for (File f : bad) names.add(f.getName());
        java.util.Collections.sort(names);
        return names;
    }

    /**
     * Removes the collection and records its tombstone; answers the track ids no other kept
     * collection still holds (whose audio may now be deleted).
     */
    synchronized List<String> remove(String contentId, long now) {
        List<String> orphaned = new ArrayList<>();
        JSONObject gone = get(contentId);
        if (gone == null) return orphaned;
        //noinspection ResultOfMethodCallIgnored
        new File(dir, fileName(contentId)).delete();
        Set<String> still = new HashSet<>();
        for (JSONObject o : list()) still.addAll(trackIds(o));
        for (String id : trackIds(gone)) if (!still.contains(id)) orphaned.add(id);
        try {
            JSONObject tombs = tombstones();
            tombs.put(contentId, new JSONObject().put("at", now).put("tracks", new JSONArray(orphaned)));
            while (tombs.length() > MAX_TOMBSTONES) tombs.remove(oldest(tombs));
            writeTombstones(tombs);
        } catch (Exception unwritten) { /* the audio then stays: never deleted without a record */ }
        return orphaned;
    }

    /**
     * The track ids an explicit removal released and no kept collection holds now: the only
     * audio the shell may delete.
     */
    synchronized Set<String> deletable() {
        Set<String> held = new HashSet<>();
        for (JSONObject o : list()) held.addAll(trackIds(o));
        Set<String> out = new HashSet<>();
        JSONObject tombs = tombstones();
        for (Iterator<String> k = tombs.keys(); k.hasNext(); ) {
            JSONObject t = tombs.optJSONObject(k.next());
            JSONArray tracks = t == null ? null : t.optJSONArray("tracks");
            for (int i = 0; tracks != null && i < tracks.length(); i++) {
                String id = tracks.optString(i);
                if (!id.isEmpty() && !held.contains(id)) out.add(id);
            }
        }
        return out;
    }

    /**
     * A re-sync's answer no longer lists these tracks of a kept collection (taken off a
     * playlist): recorded like a removal, so their audio may go; the collection stays kept.
     */
    synchronized void release(String contentId, List<String> tracks, long now) {
        if (tracks == null || tracks.isEmpty()) return;
        try {
            JSONObject tombs = tombstones();
            String key = "resync:" + contentId;
            JSONObject prev = tombs.optJSONObject(key);
            JSONArray all = prev == null ? new JSONArray() : prev.optJSONArray("tracks");
            if (all == null) all = new JSONArray();
            for (String t : tracks) all.put(t);
            tombs.put(key, new JSONObject().put("at", now).put("tracks", all));
            while (tombs.length() > MAX_TOMBSTONES) tombs.remove(oldest(tombs));
            writeTombstones(tombs);
        } catch (Exception unwritten) { /* the audio stays */ }
    }

    /** Whether {@code contentId} was removed on purpose (and not kept again since). */
    synchronized boolean tombstoned(String contentId) {
        return tombstones().has(contentId);
    }

    /**
     * Puts back collections the shell still remembers when this list has lost them (a new
     * payload, a cleared state directory). One removed on purpose is not put back. Answers
     * how many were restored.
     */
    synchronized int restore(JSONArray items) {
        int n = 0;
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject k = items.optJSONObject(i);
            if (k == null) continue;
            String cid = k.optString("contentId");
            if (!ContentId.valid(cid) || tombstoned(cid) || get(cid) != null) continue;
            JSONArray tracks = k.optJSONArray("tracks");
            if (tracks == null || tracks.length() == 0) continue;
            try {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                JSONObject o = record(cid, k.optString("title"), k.optString("art", ""), tracks, k.optLong("keptAt"), k.optString("kind", ""));
                write(new File(dir, fileName(cid)), o.toString());
                clearQuarantine(cid);
                n++;
            } catch (Exception skipped) { /* the next restore tries again */ }
        }
        return n;
    }

    /** The kept collection a play of {@code contentId} (a collection or one of its tracks) can be answered from offline. */
    synchronized JSONObject holding(String contentId) {
        JSONObject direct = get(contentId);
        if (direct != null) return direct;
        for (JSONObject o : list()) if (trackIds(o).contains(contentId)) return o;
        return null;
    }

    static List<String> trackIds(JSONObject collection) {
        List<String> ids = new ArrayList<>();
        JSONArray tracks = collection == null ? null : collection.optJSONArray("tracks");
        for (int i = 0; tracks != null && i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null && !t.optString("id").isEmpty()) ids.add(t.optString("id"));
        }
        return ids;
    }

    private void quarantine(File f) {
        File bad = new File(dir, "_bad");
        //noinspection ResultOfMethodCallIgnored
        bad.mkdirs();
        File to = new File(bad, f.getName());
        if (!f.renameTo(to)) {
            // Could not move it: leave it; it is still not a removal.
        }
    }

    private JSONObject tombstones() {
        JSONObject t = read(new File(dir, TOMBSTONES));
        return t == null ? new JSONObject() : t;
    }

    private void writeTombstones(JSONObject tombs) {
        try {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            write(new File(dir, TOMBSTONES), tombs.toString());
        } catch (Exception unwritten) { /* see remove() */ }
    }

    private static String oldest(JSONObject tombs) {
        String oldest = null;
        long at = Long.MAX_VALUE;
        for (Iterator<String> k = tombs.keys(); k.hasNext(); ) {
            String key = k.next();
            JSONObject t = tombs.optJSONObject(key);
            long when = t == null ? 0 : t.optLong("at");
            if (when < at) { at = when; oldest = key; }
        }
        return oldest;
    }

    /** Written beside, then renamed: a crash leaves the old file or the new one, never half of one. */
    private static void write(File f, String text) throws Exception {
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        Files.write(tmp.toPath(), text.getBytes(StandardCharsets.UTF_8));
        if (!tmp.renameTo(f)) Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private static JSONObject read(File f) {
        try { return f.isFile() ? new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)) : null; }
        catch (Exception unreadable) { return null; }
    }

    /** A content id as a safe file name ("plex:123" -> "plex_123.json"). */
    static String fileName(String contentId) {
        return contentId.replaceAll("[^A-Za-z0-9._-]", "_") + ".json";
    }
}
