package net.kckern.daylight.cap.mediaservice;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Decides when playback progress is reported, following the web player: at most
 * every 10 s while playing and only past 10 s; once more when the item is left, unless
 * it was a skim; a natural end at the end. The backend refuses a report with fewer than
 * 10 seconds unless it is at 90 percent or more, and this never sends such a report.
 * Pure: time comes in with each event.
 */
final class ProgressReporter {
    static final long INTERVAL_MS = 10_000;
    static final long MIN_SECONDS = 10;

    static final class Report {
        final String contentId;
        final String title;
        final String listId;
        final long seconds;
        final double percent;
        final boolean naturalEnd;
        /** When this position was heard on the phone (epoch ms); 0 when not known. */
        long observedAt;
        /** The playback speed (home counts listened time at it); 1 is not sent. */
        double rate = 1.0;
        /** This player's run, so home pairs consecutive reports of one session; "" is not sent. */
        String sessionId = "";

        Report(String contentId, String title, String listId, long seconds, double percent, boolean naturalEnd) {
            this.contentId = contentId;
            this.title = title;
            this.listId = listId;
            this.seconds = seconds;
            this.percent = percent;
            this.naturalEnd = naturalEnd;
        }

        /**
         * The POST /api/v1/play/log body, with the web player's fields and no others.
         * type is the content's source, which the backend uses to pick its adapter;
         * assetId is the whole content id. The backend uses naturalEnd to distinguish
         * an actual finish from progress judged against a household completion rule.
         */
        JSONObject toBody() throws JSONException {
            JSONObject body = new JSONObject()
                    .put("type", ContentId.source(contentId))
                    .put("assetId", contentId)
                    .put("seconds", seconds)
                    .put("percent", percent)
                    .put("title", title)
                    .put("listId", listId == null || listId.isEmpty() ? JSONObject.NULL : listId);
            if (naturalEnd) body.put("naturalEnd", true);
            // When it was heard, not when it arrives: a report sent late (kept while offline)
            // must not move the place back past a newer one from another player.
            if (observedAt > 0) body.put("observedAt", observedAt);
            if (rate > 0 && Math.abs(rate - 1.0) > 0.001) body.put("rate", Math.round(rate * 100) / 100.0);
            if (!sessionId.isEmpty()) body.put("sessionId", sessionId);
            return body;
        }
    }

    private String id;
    private String title = "";
    private String listId = "";
    private long positionMs;
    private long durationMs;
    private long lastSentAtMs;
    private long lastSentSeconds = -1;
    private boolean ended;

    /** A transition starts a new queue entry, even if it has the same content id. */
    synchronized List<Report> onEvent(String eventId, String eventTitle, String eventListId,
                                      long eventPositionMs, long eventDurationMs, String state, long nowMs) {
        List<Report> out = new ArrayList<>();
        boolean playing = "playing".equals(state);
        boolean ending = "ended".equals(state);
        boolean transition = "transition".equals(state);
        if (!ContentId.valid(eventId)
                || !(playing || ending || transition || "paused".equals(state) || "stopped".equals(state))) return out;
        if (transition || !eventId.equals(id)) {
            Report left = leaving();
            if (left != null) out.add(left);
            id = eventId;
            lastSentAtMs = nowMs - INTERVAL_MS;     // the first report waits only for the ten-second mark
            lastSentSeconds = -1;
            ended = false;
        }
        title = eventTitle == null ? "" : eventTitle;
        listId = eventListId == null ? "" : eventListId;
        positionMs = Math.max(eventPositionMs, 0);
        durationMs = Math.max(eventDurationMs, 0);

        if (ending) {
            if (!ended && durationMs > 0) out.add(new Report(id, title, listId, durationMs / 1000, 100.0, true));
            ended = true;
        } else if (playing) {
            // An observation at the end can follow completion. A replay starts earlier.
            if (ended && durationMs > 0 && positionMs >= durationMs) return out;
            ended = false;
            long seconds = positionMs / 1000;
            // A wall clock can be set back; a report is then due at once and not in an hour.
            boolean due = nowMs - lastSentAtMs >= INTERVAL_MS || nowMs < lastSentAtMs;
            if (due && seconds > MIN_SECONDS && percent() > 0) {
                out.add(new Report(id, title, listId, seconds, percent(), false));
                lastSentAtMs = nowMs;
                lastSentSeconds = seconds;
            }
        } else if (!transition) {
            Report left = leaving();
            if (left != null) out.add(left);
        }
        return out;
    }

    /** The save made when an item is paused, stopped or replaced. */
    private Report leaving() {
        if (id == null || ended) return null;
        long seconds = positionMs / 1000;
        double percent = percent();
        if (percent <= 0) return null;
        if (seconds < MIN_SECONDS && percent < 90) return null;
        if (seconds == lastSentSeconds) return null;
        lastSentSeconds = seconds;
        return new Report(id, title, listId, seconds, percent, false);
    }

    /** One decimal place, 0 when the duration is unknown. */
    private double percent() {
        if (durationMs <= 0) return 0;
        return Math.min(100.0, Math.round(positionMs * 1000.0 / durationMs) / 10.0);
    }
}
