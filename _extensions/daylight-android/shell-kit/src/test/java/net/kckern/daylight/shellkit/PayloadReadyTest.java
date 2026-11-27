package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import org.junit.Test;

public class PayloadReadyTest {
    /** A fake clock and port: attaches at {@code attachAt}, the loader fails at {@code failAt}. */
    private static final class Fake implements PayloadReady.Signals {
        long now, attachAt = Long.MAX_VALUE, failAt = Long.MAX_VALUE;
        int waits;
        @Override public boolean awaitAttach(long ms) {
            waits++;
            if (now >= attachAt) return true;
            long until = now + ms;
            if (attachAt <= until) { now = attachAt; return true; }
            now = until;
            return false;
        }
        @Override public String failure() { return now >= failAt ? "start() did not return within 20000 ms" : null; }
        @Override public long now() { return now; }
    }

    @Test public void anAttachedPortIsReadyAtOnce() {
        Fake f = new Fake();
        f.attachAt = 0;
        assertEquals(PayloadReady.State.READY, PayloadReady.await(f, 25_000).state);
        assertEquals(0, f.now);
    }

    @Test public void aColdStartIsWaitedForPastTheOldEightSeconds() {
        Fake f = new Fake();
        f.attachAt = 14_000;   // the payload's start takes 14 s: the old 8 s waits dropped the tap
        PayloadReady.Answer a = PayloadReady.await(f, 25_000);
        assertTrue(a.ready());
        assertEquals("ready the moment it attaches", 14_000, f.now);
    }

    @Test public void aLoaderFailureEndsTheWaitWithItsReason() {
        Fake f = new Fake();
        f.failAt = 3_000;
        PayloadReady.Answer a = PayloadReady.await(f, 25_000);
        assertEquals(PayloadReady.State.FAILED, a.state);
        assertTrue(a.reason.contains("did not return"));
        assertTrue("ended near the failure, not at the deadline", f.now < 5_000);
        assertEquals(PayloadReady.FAILED_WORDS, a.words());
    }

    @Test public void aStaleFailureGivesWayToAnAttach() {
        Fake f = new Fake();
        f.failAt = 0;
        f.attachAt = 100;   // a new start attaches just after the old failure was read
        assertTrue(PayloadReady.await(f, 25_000).ready());
    }

    @Test public void noAttachAndNoFailureIsStillStarting() {
        Fake f = new Fake();
        PayloadReady.Answer a = PayloadReady.await(f, 25_000);
        assertEquals(PayloadReady.State.STARTING, a.state);
        assertEquals(25_000, f.now);
        assertEquals("Starting up…", a.words());
    }

    @Test public void theWaitIsAtLeastTheLoadersStartDeadline() {
        assertTrue(net.kckern.daylight.api.PayloadStart.WAIT_MS > net.kckern.daylight.api.PayloadStart.START_DEADLINE_MS);
    }
}
