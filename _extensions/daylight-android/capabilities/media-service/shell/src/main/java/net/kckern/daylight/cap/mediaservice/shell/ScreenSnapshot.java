package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * One answer to "what is this screen doing", as the payload's screen-session op gave
 * it (the backend's SessionSnapshot, __docs/reference/media/media-app-technical.md
 * §9.2). Plain values only, so the player can be built from it on any thread and a
 * JVM test can read a captured live snapshot.
 *
 * The screen owns the session: nothing here is kept between answers. A queue entry is
 * known by its queueItemId, so the same content twice is two entries and a jump or a
 * remove names the one that was tapped.
 */
final class ScreenSnapshot {
    /** Where the answer stands, from the backend's status. */
    enum Reach { PLAYING_OR_PAUSED, IDLE, OFF, NOT_ON, UNREACHABLE }

    static final class Entry {
        final String queueItemId;
        final String contentId;
        final String title;
        final String thumbnail;
        final long durationMs;

        Entry(String queueItemId, String contentId, String title, String thumbnail, long durationMs) {
            this.queueItemId = queueItemId;
            this.contentId = contentId;
            this.title = title;
            this.thumbnail = thumbnail;
            this.durationMs = durationMs;
        }
    }

    final Reach reach;
    /** The screen's own state word: playing, paused, buffering, loading, stalled, ready, ended, error, idle. */
    final String state;
    final List<Entry> entries;
    /** Index into entries of what is on screen; -1 when nothing is. */
    final int current;
    final long positionMs;
    final boolean shuffle;
    final String repeat;
    final int volume;
    /** The newest note the screen shows ("Paused by Phone"), or empty. */
    final String note;
    /** When the screen last reported, for an OFF screen; else empty. */
    final String lastSeenAt;

    private ScreenSnapshot(Reach reach, String state, List<Entry> entries, int current, long positionMs,
            boolean shuffle, String repeat, int volume, String note, String lastSeenAt) {
        this.reach = reach;
        this.state = state;
        this.entries = Collections.unmodifiableList(entries);
        this.current = current;
        this.positionMs = positionMs;
        this.shuffle = shuffle;
        this.repeat = repeat;
        this.volume = volume;
        this.note = note;
        this.lastSeenAt = lastSeenAt;
    }

    static ScreenSnapshot unreachable() {
        return new ScreenSnapshot(Reach.UNREACHABLE, "idle", new ArrayList<>(), -1, 0, false, "off", -1, "", "");
    }

    /** @param reply the payload's screen-session answer: {ok, status, snapshot?, lastSeenAt?} */
    static ScreenSnapshot parse(JSONObject reply) {
        if (reply == null || !reply.optBoolean("ok", false)) return unreachable();
        int status = reply.optInt("status", 0);
        JSONObject snap = reply.optJSONObject("snapshot");
        Reach reach;
        if (status == 200) reach = Reach.PLAYING_OR_PAUSED;
        else if (status == 204) reach = Reach.IDLE;
        else if (status == 503) reach = Reach.OFF;
        else if (status == 404) reach = Reach.NOT_ON;
        else return unreachable();
        if (snap == null) {
            return new ScreenSnapshot(reach, "idle", new ArrayList<>(), -1, 0, false, "off", -1, "",
                    reply.optString("lastSeenAt", ""));
        }

        JSONObject currentItem = snap.optJSONObject("currentItem");
        JSONObject queue = snap.optJSONObject("queue");
        JSONArray items = queue == null ? null : queue.optJSONArray("items");
        int currentIndex = queue == null ? -1 : queue.optInt("currentIndex", -1);
        List<Entry> entries = new ArrayList<>();
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("queueItemId", "");
            if (id.isEmpty()) continue;
            boolean playing = i == currentIndex && currentItem != null;
            // The current item's own fields are the screen's best word on it (its title comes
            // from the play route); a queue entry may still carry a placeholder title.
            JSONObject best = playing ? currentItem : item;
            entries.add(new Entry(id, item.optString("contentId", best.optString("contentId", "")),
                    title(best, item), best.optString("thumbnail", item.optString("thumbnail", "")),
                    seconds(best.opt("duration"), seconds(item.opt("duration"), -1))));
            if (playing) currentIndex = entries.size() - 1;
        }
        if (currentIndex >= entries.size()) currentIndex = -1;
        // A screen may play an item that is not in its queue (a brief, a direct load).
        if (currentIndex < 0 && currentItem != null) {
            String id = currentItem.optString("queueItemId", "");
            entries.add(0, new Entry(id.isEmpty() ? "current:" + currentItem.optString("contentId", "") : id,
                    currentItem.optString("contentId", ""), title(currentItem, null),
                    currentItem.optString("thumbnail", ""), seconds(currentItem.opt("duration"), -1)));
            currentIndex = 0;
        }

        JSONObject config = snap.optJSONObject("config");
        int volume = config == null ? -1 : config.optInt("volume", -1);
        return new ScreenSnapshot(reach, snap.optString("state", "idle"), entries, currentIndex,
                Math.max(0, Math.round(snap.optDouble("position", 0) * 1000)),
                config != null && config.optBoolean("shuffle", false),
                config == null ? "off" : config.optString("repeat", "off"),
                volume > 100 ? 100 : volume, newestNote(snap.optJSONObject("controls")),
                reply.optString("lastSeenAt", ""));
    }

    boolean online() { return reach == Reach.PLAYING_OR_PAUSED || reach == Reach.IDLE; }

    Entry currentEntry() { return current >= 0 && current < entries.size() ? entries.get(current) : null; }

    /** The line the player shows under the transport when it is not plain playback. */
    String statusLine(String screenName) {
        switch (reach) {
            case OFF: return screenName + " is off";
            case NOT_ON: return screenName + " is not on";
            case UNREACHABLE: return "Can't reach home";
            case IDLE: return "Nothing playing on " + screenName;
            // A note says why playback stopped ("Paused by Phone"); while the screen plays it is history.
            default: return "playing".equals(state) ? "" : note;
        }
    }

    private static String title(JSONObject best, JSONObject fallback) {
        String t = best.optString("title", "");
        if (t.isEmpty() && fallback != null) t = fallback.optString("title", "");
        return t.isEmpty() ? best.optString("contentId", "") : t;
    }

    private static long seconds(Object value, long otherwise) {
        if (!(value instanceof Number)) return otherwise;
        double s = ((Number) value).doubleValue();
        return s > 0 && !Double.isInfinite(s) ? Math.round(s * 1000) : otherwise;
    }

    private static String newestNote(JSONObject controls) {
        JSONArray notes = controls == null ? null : controls.optJSONArray("notes");
        String newest = "";
        String at = "";
        for (int i = 0; notes != null && i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n == null) continue;
            String when = n.optString("at", "");
            if (newest.isEmpty() || when.compareTo(at) > 0) { newest = n.optString("label", ""); at = when; }
        }
        return newest;
    }
}
