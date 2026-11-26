package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * The collections kept on this phone ("Keep on this phone"): a book, an album, a playlist,
 * a household list. Each is one JSON file holding its title, cover and resolved tracks
 * (ids, titles, artist, album, art, durations, stream URLs), so an offline play of the
 * collection is answered from here when the backend cannot be reached. The audio itself is
 * in the shell's download cache, keyed by track content id. Plain java.io; thread-safe.
 */
final class KeptCollections {
    private final File dir;

    KeptCollections(File dir) { this.dir = dir; }

    synchronized void save(String contentId, String title, String art, JSONArray tracks, long now) throws Exception {
        if (!ContentId.valid(contentId)) throw new IllegalArgumentException("not a content id");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        JSONObject o = new JSONObject().put("contentId", contentId).put("title", title == null ? "" : title)
                .put("tracks", tracks).put("keptAt", now);
        if (art != null && !art.isEmpty()) o.put("art", art);
        File tmp = new File(dir, fileName(contentId) + ".tmp");
        Files.write(tmp.toPath(), o.toString().getBytes(StandardCharsets.UTF_8));
        File f = new File(dir, fileName(contentId));
        if (!tmp.renameTo(f)) Files.write(f.toPath(), o.toString().getBytes(StandardCharsets.UTF_8));
    }

    synchronized JSONObject get(String contentId) {
        if (!ContentId.valid(contentId)) return null;
        return read(new File(dir, fileName(contentId)));
    }

    /** Newest kept first. */
    synchronized List<JSONObject> list() {
        List<JSONObject> out = new ArrayList<>();
        File[] files = dir.listFiles((d, n) -> n.endsWith(".json"));
        if (files == null) return out;
        for (File f : files) { JSONObject o = read(f); if (o != null) out.add(o); }
        out.sort((a, b) -> Long.compare(b.optLong("keptAt"), a.optLong("keptAt")));
        return out;
    }

    /** Removes the collection; answers the track ids no other kept collection still holds (to delete their audio). */
    synchronized List<String> remove(String contentId) {
        List<String> orphaned = new ArrayList<>();
        JSONObject gone = get(contentId);
        if (gone == null) return orphaned;
        //noinspection ResultOfMethodCallIgnored
        new File(dir, fileName(contentId)).delete();
        java.util.Set<String> still = new java.util.HashSet<>();
        for (JSONObject o : list()) still.addAll(trackIds(o));
        for (String id : trackIds(gone)) if (!still.contains(id)) orphaned.add(id);
        return orphaned;
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

    private static JSONObject read(File f) {
        try { return f.isFile() ? new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)) : null; }
        catch (Exception unreadable) { return null; }
    }

    /** A content id as a safe file name ("plex:123" -> "plex_123.json"). */
    static String fileName(String contentId) {
        return contentId.replaceAll("[^A-Za-z0-9._-]", "_") + ".json";
    }
}
