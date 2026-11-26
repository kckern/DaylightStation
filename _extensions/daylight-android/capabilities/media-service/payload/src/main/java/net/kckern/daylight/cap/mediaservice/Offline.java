package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * A play answered without the backend, from a collection kept on this phone. A collection
 * (c:) plays whole; a track (p:) of a kept collection plays from that track onward, so a
 * book continues with its next chapter. The position is the last one this phone reported
 * for the item (sent or still waiting), so listening offline resumes. Pure.
 */
final class Offline {
    private Offline() { }

    /** Null when nothing kept answers {@code mediaId}. */
    static Resolver.Resolved resolve(String mediaId, KeptCollections kept, PendingProgress positions) {
        if (mediaId == null) return null;
        MediaId id;
        try { id = MediaId.parse(mediaId); } catch (RuntimeException bad) { return null; }
        if (id.contentId == null) return null;
        JSONObject collection = id.kind == MediaId.Kind.CONTAINER ? kept.get(id.contentId) : kept.holding(id.contentId);
        if (collection == null) return null;
        List<Track> tracks = tracks(collection.optJSONArray("tracks"));
        if (tracks.isEmpty()) return null;
        int start = 0;
        if (id.kind == MediaId.Kind.LEAF) {
            for (int i = 0; i < tracks.size(); i++) if (tracks.get(i).id.equals(id.contentId)) start = i;
        } else {
            // A whole collection resumes where it was last heard (a book's chapter 7, not
            // chapter 1: a report from chapter 1 would move the place back).
            start = lastHeard(positions, tracks);
        }
        long at = lastSeconds(positions, tracks.get(start).id);
        long durationMs = tracks.get(start).durationMs;
        long startMs = at * 1000;
        if (durationMs > 0 && startMs >= durationMs - 1000) {
            // That part was finished: the next one, from its start.
            if (id.kind != MediaId.Kind.LEAF && start + 1 < tracks.size()) start++;
            startMs = 0;
        }
        return new Resolver.Resolved(tracks, start, Math.max(0, startMs), true);
    }

    /** The index of the track heard most recently (newest observedAt), or 0 when none was. */
    static int lastHeard(PendingProgress positions, List<Track> tracks) {
        int best = 0;
        long newest = -1;
        for (int i = 0; i < tracks.size(); i++) {
            JSONObject b = positions.get(tracks.get(i).id);
            if (b == null) continue;
            long at = b.optLong("observedAt", 0);
            if (at > newest) { newest = at; best = i; }
        }
        return best;
    }

    static List<Track> tracks(JSONArray a) {
        List<Track> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject t = a.optJSONObject(i);
            if (t == null || !ContentId.valid(t.optString("id")) || t.optString("url").isEmpty()) continue;
            out.add(new Track(t.optString("id"), t.optString("url"), t.optString("title", "Untitled"),
                    t.optString("artist", ""), t.optString("album", ""), t.has("artUrl") ? t.optString("artUrl") : null,
                    t.optString("listId", ""), t.optLong("durationMs", 0)));
        }
        return out;
    }

    private static long lastSeconds(PendingProgress positions, String contentId) {
        JSONObject b = positions.get(contentId);
        return b == null ? 0 : Math.max(0, b.optLong("seconds", 0));
    }
}
