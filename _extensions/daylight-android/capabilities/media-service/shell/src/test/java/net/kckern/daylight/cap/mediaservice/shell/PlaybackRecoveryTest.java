package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;

import org.junit.After;
import org.junit.Test;

public class PlaybackRecoveryTest {
    private final PlaybackRecovery r = new PlaybackRecovery();

    @After public void clear() { r.release(); }

    @Test public void lostConnectionHoldsTheItemAndSaysSo() {
        assertEquals(PlaybackRecovery.Action.HOLD,
                r.onError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, -1, false, true, true));
        assertEquals("Lost connection to home · will resume", PlaybackRecovery.statusNow());
        assertEquals(PlaybackRecovery.Action.HOLD,
                r.onError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, -1, false, true, true));
        assertEquals(0, r.skips());
    }

    @Test public void aHomeThatAnswers5xxIsHeldNotSkipped() {
        assertEquals(PlaybackRecovery.Action.HOLD,
                r.onError(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 502, false, true, true));
        assertEquals(PlaybackRecovery.Action.HOLD,
                r.onError(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 503, false, true, true));
        assertTrue(PlaybackRecovery.isNetwork(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 401));
    }

    @Test public void anItemHomeDoesNotHaveIsSkipped() {
        assertEquals(PlaybackRecovery.Action.SKIP,
                r.onError(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 404, false, true, true));
        assertEquals(PlaybackRecovery.Action.SKIP,
                r.onError(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, 410, false, true, true));
        assertEquals("This item won't play", PlaybackRecovery.statusNow());
    }

    @Test public void aBadFileIsSkippedAtMostThreeInARowThenStops() {
        int code = PlaybackException.ERROR_CODE_DECODING_FAILED;
        assertEquals(PlaybackRecovery.Action.SKIP, r.onError(code, -1, false, true, true));
        assertEquals(PlaybackRecovery.Action.SKIP, r.onError(PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED, -1, false, true, true));
        assertEquals(PlaybackRecovery.Action.SKIP, r.onError(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, -1, false, true, true));
        assertEquals(PlaybackRecovery.Action.STOP, r.onError(code, -1, false, true, true));
        assertEquals("This item won't play · 3 in a row didn't, so playback stopped", PlaybackRecovery.statusNow());
    }

    @Test public void oneItemThatPlaysResetsTheSkipCount() {
        int code = PlaybackException.ERROR_CODE_DECODING_FAILED;
        for (int i = 0; i < PlaybackRecovery.MAX_SKIPS; i++) r.onError(code, -1, false, true, true);
        r.played();
        assertEquals("", PlaybackRecovery.statusNow());
        assertEquals(PlaybackRecovery.Action.SKIP, r.onError(code, -1, false, true, true));
    }

    @Test public void theLastItemOrAPausedItemIsNeverSkippedPast() {
        int code = PlaybackException.ERROR_CODE_DECODING_FAILED;
        assertEquals(PlaybackRecovery.Action.STOP, r.onError(code, -1, false, true, false));
        assertEquals(PlaybackRecovery.Action.STOP, r.onError(code, -1, false, false, true));
        assertEquals("This item won't play", PlaybackRecovery.statusNow());
    }

    @Test public void aKeptFileIsNeverANetworkError() {
        assertEquals(PlaybackRecovery.Action.SKIP,
                r.onError(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, -1, true, true, true));
        assertNotEquals(PlaybackRecovery.LOST, PlaybackRecovery.statusNow());
    }

    @Test public void retriesBackOffThenStayAtThirtySeconds() {
        assertEquals(2_000, r.nextRetryMs());
        assertEquals(5_000, r.nextRetryMs());
        assertEquals(10_000, r.nextRetryMs());
        assertEquals(30_000, r.nextRetryMs());
        assertEquals(30_000, r.nextRetryMs());
        assertEquals(30_000, r.nextRetryMs());
        r.played();
        assertEquals(2_000, r.nextRetryMs());
    }

    @Test public void movingToAnotherItemRestartsTheRetriesAndClearsTheLostLine() {
        r.onError(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, -1, false, true, true);
        r.nextRetryMs();
        r.nextRetryMs();
        r.moved();
        assertEquals(2_000, r.nextRetryMs());
        assertEquals("", PlaybackRecovery.statusNow());
    }

    @Test public void anErrorDoesNotEndTheSleepTimerAStopDoes() {
        assertFalse(PlaybackRecovery.endsSleepTimer(Player.STATE_IDLE, true));
        assertTrue(PlaybackRecovery.endsSleepTimer(Player.STATE_IDLE, false));
        assertTrue(PlaybackRecovery.endsSleepTimer(Player.STATE_ENDED, false));
        assertFalse(PlaybackRecovery.endsSleepTimer(Player.STATE_BUFFERING, false));
        assertFalse(PlaybackRecovery.endsSleepTimer(Player.STATE_READY, false));
    }
}
