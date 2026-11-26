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
        }
        long at = lastSeconds(positions, tracks.get(start).id);
        long durationMs = tracks.get(start).durationMs;
        long startMs = at * 1000;
        if (durationMs > 0 && startMs >= durationMs - 1000) startMs = 0;
        return new Resolver.Resolved(tracks, start, Math.max(0, startMs), true);
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
        for (JSONObject b : positions.waiting()) {
            if (contentId.equals(b.optString("assetId"))) return Math.max(0, b.optLong("seconds", 0));
        }
        return 0;
    }
}
