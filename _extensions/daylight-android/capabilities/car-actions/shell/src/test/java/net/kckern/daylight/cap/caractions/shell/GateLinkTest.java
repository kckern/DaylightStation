package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class GateLinkTest {
    private int binds;
    private int unbinds;
    private boolean bindRefused;
    private GateLink<String> link;

    private final GateLink.Binding binding = new GateLink.Binding() {
        @Override public boolean bind() {
            binds++;
            if (bindRefused) return false;
            // The connection arrives at once, as Android posts it on another thread.
            new Thread(() -> link.connected("real-" + binds)).start();
            return true;
        }
        @Override public void unbind() { unbinds++; }
    };

    @Test public void theFirstLetThroughCallBindsAndLaterCallsReuseIt() {
        link = new GateLink<>(binding);
        assertEquals("real-1", link.await(5000));
        assertEquals("real-1", link.await(5000));
        assertEquals(1, binds);
    }

    /** Android can hand the same gate binder back after an unbind: a released link binds again on the next call. */
    @Test public void aReleasedLinkBindsAgainOnTheNextCall() {
        link = new GateLink<>(binding);
        assertEquals("real-1", link.await(5000));
        link.release();
        assertEquals(1, unbinds);
        assertFalse(link.bound());
        assertEquals("real-2", link.await(5000));
        assertEquals(2, binds);
        link.release();
        link.release();
        assertEquals("a second release unbinds nothing more", 2, unbinds);
    }

    @Test public void aWaiterWokenByAReleaseGetsNothingAndTheLinkStaysUsable() throws Exception {
        GateLink.Binding slow = new GateLink.Binding() {
            @Override public boolean bind() { binds++; return true; }
            @Override public void unbind() { unbinds++; }
        };
        link = new GateLink<>(slow);
        final String[] got = { "unset" };
        Thread waiter = new Thread(() -> got[0] = link.await(10_000));
        waiter.start();
        while (binds == 0) Thread.sleep(5);
        link.release();
        waiter.join(5000);
        assertNull(got[0]);
        link.connected("late");
        assertEquals("the late connection of the released binding is not used", 1, unbinds);
        assertFalse(link.bound());
    }

    @Test public void aRefusedBindOrALostServiceAnswersNothingAndTriesAgainLater() {
        link = new GateLink<>(binding);
        bindRefused = true;
        assertNull(link.await(100));
        bindRefused = false;
        assertEquals("real-2", link.await(5000));
        link.disconnected();
        assertNull("a lost service is not used", link.awaitNoBind());
    }
}
