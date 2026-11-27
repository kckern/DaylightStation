package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Where this phone last heard each part, from its own progress reports (audit H7): home's
 * Continue answer can lag the report just sent (Back from Now playing shows the old time and
 * bar), so a Continue row whose part this phone reported in the last half hour takes the
 * phone's place, and a book whose last part this phone heard to its end is left out. A row
 * home has moved past (another part) is left as home says. Pure but for its own lock.
 */
final class HeardHere {
    static final long FRESH_MS = 30 * 60_000L;
    private final Map<String, long[]> parts = new LinkedHashMap<String, long[]>(16, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, long[]> e) { return size() > 64; }
    };

    /** A report sent for {@code contentId}: {seconds, ended (1/0), at}. */
    synchronized void heard(String contentId, long seconds, boolean ended, long now) {
        if (contentId == null || contentId.isEmpty()) return;
        parts.put(contentId, new long[] { seconds, ended ? 1 : 0, now });
    }

    /** Home's Continue rows with this phone's fresher places put in. */
    synchronized JSONArray patch(JSONArray rows, long now) throws org.json.JSONException {
        JSONArray out = new JSONArray();
        for (int i = 0; rows != null && i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            long[] h = parts.get(row.optString("playContentId"));
            if (h == null || now - h[2] > FRESH_MS || now < h[2]) { out.put(row); continue; }
            int index = row.optInt("partIndex", 0), count = row.optInt("partCount", 0);
            boolean lastPart = count <= 1 || index >= count;
            if (h[1] == 1 && lastPart) continue;       // heard to its end here: finished
            JSONObject p = new JSONObject(row.toString());
            long was = row.optLong("playhead", 0), dur = row.optLong("duration", 0);
            long at = dur > 0 ? Math.min(h[0], dur) : h[0];
            p.put("playhead", at);
            if (row.has("remainingSec")) p.put("remainingSec", Math.max(0, row.optLong("remainingSec") - (at - was)));
            out.put(p);
        }
        return out;
    }
}
