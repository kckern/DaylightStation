package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.api.PayloadStart;

/**
 * The one time budget for a start to play, shared by every surface that starts playback
 * on this phone (Now playing's Starting state, a widget or tile, a media link) and by a
 * start on a screen. Before, each had its own timer (8 s, 15 s, 30 s, 45 s), so a fast
 * start waited on none of them and a slow one was called a failure by one surface while
 * another still showed it starting. Pure.
 *
 * <p>The parts: the payload attaching (only when it was not up at the tap: the loader's
 * own deadline, {@link PayloadStart#WAIT_MS}); resolving the id (LibraryCallback: 8 s,
 * a 2 s pause, 8 s again); and the first audio buffering. A refusal or a player error
 * ends a start before its budget; the budget only bounds a start nobody answered.
 */
final class PlayBudget {
    /** LibraryCallback's resolve: PLAY_WAIT_MS, RETRY_MS, PLAY_WAIT_MS. */
    static final long RESOLVE_MS = 18_000;
    /** The first audio, once the queue is set. */
    static final long SOUND_MS = 6_000;
    /** A start with the payload already up. */
    static final long WARM_MS = RESOLVE_MS + SOUND_MS;
    /** A start on a screen: the screen command's wait and the Starting give-up are this one number. */
    static final long SCREEN_MS = 30_000;

    private PlayBudget() { }

    /** How long a start on this phone may take before it is a failure. */
    static long giveUpMs(boolean payloadReady) {
        return WARM_MS + (payloadReady ? 0 : PayloadStart.WAIT_MS);
    }

    /** What is left of a budget started at {@code startedAt} (at least 0). */
    static long left(long startedAt, long budgetMs, long now) {
        return Math.max(0, startedAt + budgetMs - now);
    }
}
