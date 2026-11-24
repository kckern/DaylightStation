package net.kckern.daylight.cap.widgets.shell;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.PlaylistEntry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Every playlist the household's audio list sources offer, read through the media payload
 * (`playlistSources`, then `playlists` page by page). Blocking: call it off the main thread.
 * The answer is kept for a few minutes, so reopening a picker does not read every page again.
 */
final class PlaylistCatalog {
    private static final long KEEP_MS = 5 * 60 * 1000L;
    private static final int MAX_PAGES = 20;
    private static final Object LOADING = new Object();
    private static volatile List<PlaylistEntry> kept;
    private static volatile long keptAt;

    private PlaylistCatalog() {}

    /** What the last successful load found (even if old), or nothing. Never blocks. */
    static List<PlaylistEntry> cached() {
        List<PlaylistEntry> now = kept;
        return now == null ? new ArrayList<>() : now;
    }

    static List<PlaylistEntry> load() throws Exception {
        synchronized (LOADING) { return loadLocked(); }
    }

    private static List<PlaylistEntry> loadLocked() throws Exception {
        long now = System.currentTimeMillis();
        List<PlaylistEntry> fresh = kept;
        if (fresh != null && now - keptAt < KEEP_MS) return fresh;
        PayloadPort media = PayloadPort.named("media");
        JSONObject sources = new JSONObject(media.call(new JSONObject().put("op", "playlistSources").toString(), 12000));
        JSONArray sourceItems = sources.optJSONArray("items");
        if (!sources.optBoolean("ok") || sourceItems == null) throw new IllegalStateException("no list sources");
        List<PlaylistEntry> all = new ArrayList<>();
        for (int s = 0; s < sourceItems.length(); s++) {
            JSONObject source = sourceItems.optJSONObject(s);
            if (source == null || source.optString("id").isEmpty()) continue;
            int cursor = 0;
            for (int page = 0; page < MAX_PAGES; page++) {
                JSONObject answer = new JSONObject(media.call(new JSONObject().put("op", "playlists")
                        .put("source", source.optString("id")).put("cursor", String.valueOf(cursor)).toString(), 12000));
                JSONArray items = answer.optJSONArray("items");
                if (!answer.optBoolean("ok") || items == null) break;
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    all.add(new PlaylistEntry(item.optString("contentId"), item.optString("title"), item.optString("thumbnail"),
                            source.optString("title")));
                }
                int next = answer.optInt("nextCursor", -1);
                if (next <= cursor) break;
                cursor = next;
            }
        }
        keptAt = now;
        kept = all;
        return all;
    }
}
