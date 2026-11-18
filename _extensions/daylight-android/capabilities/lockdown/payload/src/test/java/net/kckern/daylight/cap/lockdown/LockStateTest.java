package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

public class LockStateTest {
    private static final long HOUR = 3_600_000L;

    @Test public void aNewStateIsLocked() { assertTrue(new LockState().locked()); }

    @Test public void anythingUnreadableReadsAsLocked() {
        for (String bad : new String[] { null, "", "garbage", "[]", "{}", "{\"locked\":\"false\"}",
                "{\"locked\":false}", "{\"locked\":false,\"unlockedAtMs\":0}" }) {
            assertTrue("expected locked for " + bad, LockState.parse(bad).locked());
        }
    }

    @Test public void anUnlockWithADurationRelocksWhenItEnds() {
        LockState s = new LockState();
        long relockAt = s.unlock(1_000, 60_000L, HOUR);
        assertEquals(61_000, relockAt);
        assertFalse(s.locked());
        assertFalse(s.tick(60_999));
        assertTrue("this tick relocked", s.tick(61_000));
        assertTrue(s.locked());
        assertFalse("already locked", s.tick(62_000));
    }

    @Test public void anUnlockWithNoDurationGetsTheCeiling() {
        LockState s = new LockState();
        assertEquals(1_000 + HOUR, s.unlock(1_000, null, HOUR));
    }

    @Test public void aRequestedDurationIsCutToTheCeiling() {
        assertEquals(1_000 + HOUR, new LockState().unlock(1_000, 10 * HOUR, HOUR));
    }

    @Test public void aCeilingOfZeroMeansNoAutomaticRelock() {
        LockState s = new LockState();
        assertEquals(0, s.unlock(1_000, null, 0));
        assertFalse(s.tick(1_000 + 100 * HOUR));
        assertEquals(1_000 + 5_000, new LockState().unlock(1_000, 5_000L, 0));
    }

    @Test public void aClockThatWentBackwardsRelocks() {
        LockState s = new LockState();
        s.unlock(1_000_000, 60_000L, HOUR);
        assertTrue(s.tick(500_000));
        assertTrue(s.locked());
    }

    @Test public void lockClearsTheWindow() {
        LockState s = new LockState();
        s.unlock(1_000, 60_000L, HOUR);
        s.lock();
        assertTrue(s.locked());
        assertEquals(0, s.relockAtMs());
    }

    @Test public void stateSurvivesARoundTrip() {
        LockState s = new LockState();
        s.unlock(1_000, 60_000L, HOUR);
        LockState back = LockState.parse(s.toJson());
        assertFalse(back.locked());
        assertEquals(61_000, back.relockAtMs());
        assertTrue(back.tick(61_000));
    }

    @Test(expected = IllegalArgumentException.class)
    public void aNonPositiveDurationIsRejected() { new LockState().unlock(1_000, 0L, HOUR); }

    // ── an unlock always has an end ───────────────────────────────────────────

    @Test public void anUnlockWithNoEndIsLockedWhenACeilingApplies() {
        LockState s = new LockState();
        s.unlock(1_000, null, 0);                       // no end
        assertTrue("this call locked", s.enforceCeiling(2_000, HOUR));
        assertTrue(s.locked());
    }

    @Test public void aStoredUnlockThatEndsBeyondTheCeilingIsLocked() {
        LockState s = LockState.parse("{\"locked\":false,\"unlockedAtMs\":1000,\"relockAtMs\":" + (1_000 + 5 * HOUR) + "}");
        assertFalse(s.locked());
        assertTrue(s.enforceCeiling(2_000, HOUR));
        assertTrue(s.locked());
    }

    @Test public void anUnlockInsideTheCeilingIsLeftAlone() {
        LockState s = new LockState();
        s.unlock(1_000, 60_000L, HOUR);
        assertFalse(s.enforceCeiling(2_000, HOUR));
        assertFalse(s.locked());
        assertFalse("nothing to do when locked", new LockState().enforceCeiling(2_000, HOUR));
    }
}
