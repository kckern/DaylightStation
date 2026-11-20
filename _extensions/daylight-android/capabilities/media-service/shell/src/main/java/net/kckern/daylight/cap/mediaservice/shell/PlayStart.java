package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

/**
 * The play service's decisions, pure: which media id the payload's answer names, and
 * when the service lets go of its foreground state.
 *
 * The service is started by a tap (a widget, a tile) as a foreground service and must
 * stay one until playback is under way, because the process is otherwise background
 * and may be stopped. Media3 then moves the media service itself into the foreground
 * when the player starts. Where Android refuses that second start (DaylightMediaService
 * records it), this service keeps the foreground state for as long as the audio plays.
 */
final class PlayStart {
    /** Waiting for a payload (up to 8 s on a cold start) and for the player to start. */
    static final long GIVE_UP_MS = 15_000;

    enum Step {
        /** Keep the foreground state and look again. */
        WAIT,
        /** Playback is under way and no longer needs this service. */
        RELEASE,
        /** Nothing plays: say so and stop. */
        FAIL
    }

    /** A widget start may be replaced or time out while the payload is resolving it. */
    static final class Attempt {
        final String playlist;
        final long startedAt;
        private boolean cancelled, played;

        Attempt(String playlist, long startedAt) {
            this.playlist = playlist;
            this.startedAt = startedAt;
        }

        void cancel() { cancelled = true; }

        void recordPlaying(long nowMs) { if (canApply(nowMs)) played = true; }

        boolean played() { return played; }

        boolean canApply(long nowMs) { return !cancelled && nowMs - startedAt < GIVE_UP_MS; }
    }

    private PlayStart() { }

    /**
     * The media id in the payload's answer to an "action" request, or null. Only an item
     * id ("p:...") is taken: the answer is the payload's, and even so nothing that is not
     * an item of the tree is handed to the player.
     */
    static String mediaId(String answer) {
        if (answer == null) return null;
        try {
            JSONObject o = new JSONObject(answer);
            if (!o.optBoolean("ok", false)) return null;
            Object id = o.opt("mediaId");
            if (!(id instanceof String)) return null;
            String s = (String) id;
            return s.startsWith("p:") && s.length() > 2 && s.length() <= 900 ? s : null;
        } catch (Exception notJson) {
            return null;
        }
    }

    /**
     * @param elapsedMs          since the service was started
     * @param failed             the payload refused, no payload came, or the player failed
     * @param playedOnce         the player has reported playing at least once
     * @param playingNow         the player is playing now
     * @param mediaInForeground  the media service holds the foreground state
     */
    static Step next(long elapsedMs, boolean failed, boolean playedOnce, boolean playingNow, boolean mediaInForeground) {
        if (failed) return Step.FAIL;
        if (!playedOnce) return elapsedMs >= GIVE_UP_MS ? Step.FAIL : Step.WAIT;
        if (mediaInForeground) return Step.RELEASE;
        return playingNow ? Step.WAIT : Step.RELEASE;
    }
}
