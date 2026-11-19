package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

public class InputLockStateTest {
    private static LockdownCommand cmd(String json, long now) { return LockdownCommand.parse(json, now); }

    @Test public void aNewStateIsNotLocked() {
        InputLockState s = new InputLockState();
        assertFalse(s.active(1_000));
        assertEquals(0, s.revision());
    }

    @Test public void aStopLocksUntilItIsReleasedByALaterRevision() {
        InputLockState s = new InputLockState();
        assertTrue(s.apply(cmd("{\"locked\":true,\"revision\":2}", 1_000)));
        assertTrue(s.active(1_000));
        assertTrue("an indefinite stop does not expire", s.active(Long.MAX_VALUE - 1));
        assertEquals(2, s.revision());
        assertFalse("a stale release is refused", s.apply(cmd("{\"locked\":false,\"revision\":2}", 2_000)));
        assertTrue(s.active(2_000));
        assertTrue(s.apply(cmd("{\"locked\":false,\"revision\":3}", 2_000)));
        assertFalse(s.active(2_000));
        assertEquals(3, s.revision());
    }

    @Test public void aStopWithADeadlineEndsThen() {
        InputLockState s = new InputLockState();
        assertTrue(s.apply(cmd("{\"locked\":true,\"lockedUntil\":5000,\"revision\":1}", 1_000)));
        assertTrue(s.active(4_999));
        assertFalse(s.active(5_000));
    }

    @Test public void stateSurvivesARoundTrip() {
        InputLockState s = new InputLockState();
        s.apply(cmd("{\"locked\":true,\"lockedUntil\":5000,\"revision\":7}", 1_000));
        InputLockState back = InputLockState.parse(s.toJson());
        assertTrue(back.active(4_000));
        assertEquals(7, back.revision());
        assertEquals(5_000, back.until());
    }

    @Test public void noStoredStateIsUnlockedAndAnUnreadableOneIsLockedUntilReleased() {
        assertFalse(InputLockState.parse(null).active(1_000));
        for (String bad : new String[] { "", "garbage", "[]", "{\"until\":\"x\"}", "{\"until\":5,\"revision\":-1}" }) {
            InputLockState s = InputLockState.parse(bad);
            assertTrue("expected locked for " + bad, s.active(1_000));
            assertEquals(0, s.revision());
            // Revision 0 means any well-formed release clears it.
            assertTrue(s.apply(cmd("{\"locked\":false}", 1_000)));
            assertFalse(s.active(1_000));
        }
    }
}
