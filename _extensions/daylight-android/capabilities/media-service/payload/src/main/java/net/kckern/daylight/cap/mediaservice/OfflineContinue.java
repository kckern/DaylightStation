package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * Continue listening with no home: the books kept on this phone that this phone has started
 * and not finished, newest listened first, in the shape of home's rows. The place is the
 * last one reported for each part (PendingProgress "positions"); a part heard to its end moves
 * the row on to the next one from its start; a book heard to its last part's end is left out.
 * Only what plays offline, so no row says "Needs a connection". Pure.
 */
final class OfflineContinue {
    /** A part within this many seconds of its end is finished (Offline's rule). */
    private static final long END_SLACK_SEC = 1;

    private OfflineContinue() { }

    /** {@code position}: the last report for a track id ({seconds, observedAt}), or null. */
    static JSONArray rows(List<JSONObject> kept, Function<String, JSONObject> position, int limit) throws JSONException {
        List<JSONObject> rows = new ArrayList<>();
        List<Long> at = new ArrayList<>();
        for (JSONObject k : kept) {
            if (!"book".equals(k.optString("kind"))) continue;
            List<Track> tracks = Offline.tracks(k.optJSONArray("tracks"));
            if (tracks.isEmpty()) continue;
            int last = -1;
            long newest = -1;
            for (int i = 0; i < tracks.size(); i++) {
                JSONObject b = position.apply(tracks.get(i).id);
                if (b == null) continue;
                long when = b.optLong("observedAt", 0);
                if (when > newest) { newest = when; last = i; }
            }
            if (last < 0) continue;
            int part = last;
            long sec = Math.max(0, position.apply(tracks.get(part).id).optLong("seconds", 0));
            long durSec = tracks.get(part).durationMs / 1000;
            if (durSec > 0 && sec >= durSec - END_SLACK_SEC) {
                if (part + 1 >= tracks.size()) continue;   // the last part heard to its end: finished
                part++;
                sec = 0;
                durSec = tracks.get(part).durationMs / 1000;
            }
            long remaining = Math.max(0, durSec - sec);
            for (int i = part + 1; i < tracks.size(); i++) remaining += tracks.get(i).durationMs / 1000;
            String play = tracks.get(part).id;
            JSONObject o = new JSONObject().put("id", MediaId.leaf(play, null)).put("contentId", k.optString("contentId"))
                    .put("playContentId", play).put("title", k.optString("title"))
                    .put("subtitle", tracks.get(0).artist).put("playhead", sec).put("duration", durSec)
                    .put("remainingSec", remaining).put("legacy", false).put("offline", true);
            if (tracks.size() > 1) o.put("partTitle", tracks.get(part).title).put("partIndex", part + 1).put("partCount", tracks.size());
            String art = k.optString("art", "");
            if (!art.isEmpty()) o.put("art", art);
            // Newest listened first (insertion sort by time).
            int at0 = 0;
            while (at0 < at.size() && at.get(at0) >= newest) at0++;
            rows.add(at0, o);
            at.add(at0, newest);
        }
        JSONArray out = new JSONArray();
        for (int i = 0; i < rows.size() && i < limit; i++) out.put(rows.get(i));
        return out;
    }
}
