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
        save(contentId, title, art, tracks, now, kind, null);
    }

    /**
     * Saved as a keep. {@code autoScope} non-null: kept automatically while listening
     * (spec §3.10), holding only these track ids (a lecture window, or a book's current part
     * on mobile data; empty for the whole collection). Null: a manual keep, which a later
     * automatic one never turns back (MediaServiceCapability checks first).
     */
    synchronized void save(String contentId, String title, String art, JSONArray tracks, long now, String kind,
                           List<String> autoScope) throws Exception {
        if (!ContentId.valid(contentId)) throw new IllegalArgumentException("not a content id");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        JSONObject o = record(contentId, title, art, tracks, now, kind);
        if (autoScope != null) markAuto(o, autoScope);
        else {
            // A manual keep of a group's unit: it is kept on its own too, so leaving the
            // group (or the group's removal) never takes its audio (spec §3.11).
            JSONObject before = tombstoned(contentId) ? null : get(contentId);
            String group = before == null ? "" : before.optString("group", "");
            if (!group.isEmpty()) o.put("group", group).put("alone", true);
        }
        write(new File(dir, fileName(contentId)), o.toString());
        unexcludeEverywhere(contentId);
        clearQuarantine(contentId);
        // Kept again: its old removal no longer deletes anything.
        JSONObject tombs = tombstones();
        if (tombs.remove(contentId) != null) writeTombstones(tombs);
    }

    /**
     * Kept as a unit of a group (an artist's album, an author's book; spec §3.11): its own
     * collection, carrying the group's id. Kept by hand before (not automatically), it stays
     * kept on its own as well ({@code alone}); kept automatically before, it is now a manual
     * keep (never removed by the automatic rules).
     */
    synchronized void saveUnit(String contentId, String title, String art, JSONArray tracks, long now, String kind,
                               String groupId) throws Exception {
        if (!ContentId.valid(contentId) || !ContentId.valid(groupId)) throw new IllegalArgumentException("not a content id");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        JSONObject before = tombstoned(contentId) ? null : get(contentId);
        JSONObject o = record(contentId, title, art, tracks, before == null ? now : before.optLong("keptAt", now), kind);
        o.put("group", groupId);
        boolean alone = before != null && !auto(before)
                && (before.optString("group", "").isEmpty() || before.optBoolean("alone", false));
        if (alone) o.put("alone", true);
        write(new File(dir, fileName(contentId)), o.toString());
        clearQuarantine(contentId);
        JSONObject tombs = tombstones();
        if (tombs.remove(contentId) != null) writeTombstones(tombs);
        JSONObject g = group(groupId);
        if (g != null) {
            unexclude(g, contentId);
            putGroup(g);
        }
    }

    /** The group a kept collection is a unit of, or "". */
    static String groupOf(JSONObject collection) { return collection == null ? "" : collection.optString("group", ""); }

    /**
     * A unit leaves its group (its Remove under the group, unchecked in Choose…, finished and
     * removed): the group leaves it out from now on. Kept on its own as well, it stays (no
     * audio freed); otherwise it is removed. Answers the track ids whose audio may go.
     */
    synchronized List<String> leaveGroup(String contentId, long now) {
        JSONObject k = get(contentId);
        if (k == null) return new ArrayList<>();
        String gid = groupOf(k);
        JSONObject g = gid.isEmpty() ? null : group(gid);
        if (g != null) { exclude(g, contentId); putGroup(g); }
        if (k.optBoolean("alone", false)) {
            k.remove("group");
            k.remove("alone");
            try { write(new File(dir, fileName(contentId)), k.toString()); } catch (Exception unwritten) { /* still kept */ }
            return new ArrayList<>();
        }
        return remove(contentId, now);
    }

    // ── groups (spec §3.11): {id, title, art, kind, follow, removeFinished, keptAt, excluded} ──

    private static final String GROUPS = "groups.keep";

    synchronized List<JSONObject> groups() {
        List<JSONObject> out = new ArrayList<>();
        JSONObject all = read(new File(dir, GROUPS));
        if (all == null) return out;
        for (Iterator<String> k = all.keys(); k.hasNext(); ) {
            JSONObject g = all.optJSONObject(k.next());
            if (g != null && ContentId.valid(g.optString("id"))) out.add(g);
        }
        out.sort((a, b) -> Long.compare(b.optLong("keptAt"), a.optLong("keptAt")));
        return out;
    }

    synchronized JSONObject group(String groupId) {
        JSONObject all = read(new File(dir, GROUPS));
        JSONObject g = all == null ? null : all.optJSONObject(groupId);
        return g == null ? null : g;
    }

    /** Saves (or replaces) one group's record; its keptAt stays from the first save. */
    synchronized void putGroup(JSONObject g) {
        try {
            String id = g.optString("id");
            if (!ContentId.valid(id)) return;
            JSONObject all = read(new File(dir, GROUPS));
            if (all == null) all = new JSONObject();
            JSONObject before = all.optJSONObject(id);
            if (before != null && before.has("keptAt")) g.put("keptAt", before.optLong("keptAt"));
            all.put(id, g);
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            write(new File(dir, GROUPS), all.toString());
        } catch (Exception unwritten) { /* the next save */ }
    }

    /**
     * The group goes: every unit leaves it (a unit kept on its own as well stays), then its
     * record. Answers the track ids whose audio may go.
     */
    synchronized List<String> removeGroup(String groupId, long now) {
        List<String> orphaned = new ArrayList<>();
        for (JSONObject k : list()) {
            if (!groupId.equals(groupOf(k))) continue;
            for (String t : leaveGroup(k.optString("contentId"), now)) if (!orphaned.contains(t)) orphaned.add(t);
        }
        try {
            JSONObject all = read(new File(dir, GROUPS));
            if (all != null && all.remove(groupId) != null) write(new File(dir, GROUPS), all.toString());
        } catch (Exception unwritten) { /* the record stays; it holds nothing */ }
        return orphaned;
    }

    /** The units a group holds now. */
    synchronized List<String> unitsOf(String groupId) {
        List<String> out = new ArrayList<>();
        for (JSONObject k : list()) if (groupId.equals(groupOf(k))) out.add(k.optString("contentId"));
        return out;
    }

    static Set<String> excluded(JSONObject g) {
        Set<String> out = new HashSet<>();
        JSONArray a = g == null ? null : g.optJSONArray("excluded");
        for (int i = 0; a != null && i < a.length(); i++) if (!a.optString(i).isEmpty()) out.add(a.optString(i));
        return out;
    }

    private static void exclude(JSONObject g, String contentId) {
        try {
            Set<String> ex = excluded(g);
            if (ex.add(contentId)) g.put("excluded", new JSONArray(new java.util.TreeSet<>(ex)));
        } catch (Exception never) { /* unchanged */ }
    }

    private static void unexclude(JSONObject g, String contentId) {
        try {
            Set<String> ex = excluded(g);
            if (ex.remove(contentId)) g.put("excluded", new JSONArray(new java.util.TreeSet<>(ex)));
        } catch (Exception never) { /* unchanged */ }
    }

    /** Kept again by hand: no group leaves it out any more. */
    private void unexcludeEverywhere(String contentId) {
        for (JSONObject g : groups()) {
            if (!excluded(g).contains(contentId)) continue;
            unexclude(g, contentId);
            putGroup(g);
        }
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
        // A re-sync keeps how it was kept: automatically, and to which parts.
        if (auto(before)) markAuto(o, only(before));
        keepMembership(before, o);
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

    /** A re-sync or restore keeps which group a unit is in, and whether it is kept on its own too. */
    private static void keepMembership(JSONObject from, JSONObject to) throws Exception {
        if (from == null || groupOf(from).isEmpty()) return;
        to.put("group", groupOf(from));
        if (from.optBoolean("alone", false)) to.put("alone", true);
    }

    /** Whether a kept record was kept automatically (spec §3.10). */
    static boolean auto(JSONObject collection) { return collection != null && collection.optBoolean("auto", false); }

    /** The track ids an automatic keep is limited to; empty for all of the collection. */
    static List<String> only(JSONObject collection) {
        List<String> ids = new ArrayList<>();
        JSONArray a = collection == null ? null : collection.optJSONArray("only");
        for (int i = 0; a != null && i < a.length(); i++) if (!a.optString(i).isEmpty()) ids.add(a.optString(i));
        return ids;
    }

    private static void markAuto(JSONObject o, List<String> scope) throws Exception {
        o.put("auto", true);
        if (scope != null && !scope.isEmpty()) o.put("only", new JSONArray(scope));
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
        // A group's unit removed (from the web, Remove all, the group's Remove): the group's
        // re-sync does not bring it back (spec §3.11).
        JSONObject g = groupOf(gone).isEmpty() ? null : group(groupOf(gone));
        if (g != null) { exclude(g, contentId); putGroup(g); }
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
                if (auto(k)) markAuto(o, only(k));
                keepMembership(k, o);
                write(new File(dir, fileName(cid)), o.toString());
                clearQuarantine(cid);
                n++;
            } catch (Exception skipped) { /* the next restore tries again */ }
        }
        return n;
    }

    /** Puts back group records the shell remembers and this list lost (none replaced). */
    synchronized int restoreGroups(JSONArray groups) {
        int n = 0;
        for (int i = 0; groups != null && i < groups.length(); i++) {
            JSONObject g = groups.optJSONObject(i);
            if (g == null || !ContentId.valid(g.optString("id")) || group(g.optString("id")) != null) continue;
            putGroup(g);
            n++;
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
