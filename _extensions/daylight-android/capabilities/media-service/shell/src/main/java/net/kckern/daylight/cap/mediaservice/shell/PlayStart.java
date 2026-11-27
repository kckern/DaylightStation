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
    /** A warm start's budget (PlayBudget); a start made while the payload was still coming up has more. */
    static final long GIVE_UP_MS = PlayBudget.WARM_MS;

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
        final boolean shuffle;
        /** This start's whole budget (PlayBudget.giveUpMs at the tap). */
        final long budgetMs;
        /** What the notice and a failure name ("Morning Mix"); empty when not known. */
        String title = "";
        private boolean cancelled, played;

        Attempt(String playlist, long startedAt) {
            this(playlist, startedAt, false);
        }

        Attempt(String playlist, long startedAt, boolean shuffle) {
            this(playlist, startedAt, shuffle, GIVE_UP_MS);
        }

        Attempt(String playlist, long startedAt, boolean shuffle, long budgetMs) {
            this.playlist = playlist;
            this.startedAt = startedAt;
            this.shuffle = shuffle;
            this.budgetMs = budgetMs;
        }

        /** What is left of the budget at {@code nowMs}. */
        long left(long nowMs) { return PlayBudget.left(startedAt, budgetMs, nowMs); }

        void cancel() { cancelled = true; }

        void recordPlaying(long nowMs) { if (canApply(nowMs)) played = true; }

        boolean played() { return played; }

        boolean canApply(long nowMs) { return !cancelled && nowMs - startedAt < budgetMs; }
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

    /** The notice while starting: "Starting Morning Mix…", or the plain words when the name is not known. */
    static String notice(String title) {
        return title == null || title.trim().isEmpty() ? "Starting playback" : "Starting " + title.trim() + "…";
    }

    /** The one failure line, naming what did not start. */
    static String failure(String title) {
        return title == null || title.trim().isEmpty() ? "Could not start playback. Tap the button again to retry."
                : "Could not start " + title.trim() + ". Tap the button again to retry.";
    }

    /** Why a start failed, when it is known (audit: one line for every cause). */
    enum Why { UNKNOWN, STARTING, OFFLINE, HOME_SLOW, NOT_FOUND, TOO_SLOW }

    /** "Could not start Morning Mix: offline. Tap the button again to retry." */
    static String failure(String title, Why why) {
        String cause;
        switch (why == null ? Why.UNKNOWN : why) {
            case STARTING: cause = "still starting up"; break;
            case OFFLINE: cause = "offline"; break;
            case HOME_SLOW: cause = "home isn't answering"; break;
            case NOT_FOUND: cause = "home does not have it"; break;
            case TOO_SLOW: cause = "it took too long"; break;
            default: return failure(title);
        }
        String what = title == null || title.trim().isEmpty() ? "playback" : title.trim();
        return "Could not start " + what + ": " + cause + ". Tap the button again to retry.";
    }

    /** The cause of a failed action lookup: the payload not up, no network, not found, or home slow. */
    static Why whyOf(Throwable failure, boolean networkValidated) {
        if (failure instanceof net.kckern.daylight.api.PayloadPort.NotReadyException) return Why.STARTING;
        String m = failure == null || failure.getMessage() == null ? "" : failure.getMessage();
        if (m.contains("not_found") || m.contains("unknown")) return Why.NOT_FOUND;
        return networkValidated ? Why.HOME_SLOW : Why.OFFLINE;
    }

    /** The title an action's answer gives ({ok, mediaId, title?}), or "". */
    static String title(String answer) {
        if (answer == null) return "";
        try {
            String t = new JSONObject(answer).optString("title", "").trim();
            return t.length() > 80 ? t.substring(0, 80) : t;
        } catch (Exception notJson) {
            return "";
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
        return next(elapsedMs, GIVE_UP_MS, failed, playedOnce, playingNow, mediaInForeground);
    }

    /** As above, against this start's own budget. */
    static Step next(long elapsedMs, long budgetMs, boolean failed, boolean playedOnce, boolean playingNow, boolean mediaInForeground) {
        if (failed) return Step.FAIL;
        if (!playedOnce) return elapsedMs >= budgetMs ? Step.FAIL : Step.WAIT;
        if (mediaInForeground) return Step.RELEASE;
        return playingNow ? Step.WAIT : Step.RELEASE;
    }
}
