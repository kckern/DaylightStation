package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.lockdown.ExitGesture.Pin;

import org.junit.Test;

public class ExitGestureTest {
    private static boolean taps(ExitGesture g, int n, long start, long gap, float x, float y) {
        boolean done = false;
        for (int i = 0; i < n; i++) done = g.tap(x, y, 1280, 800, start + i * gap);
        return done;
    }

    @Test public void sevenQuickTapsInTheTopLeftCornerCompleteTheGesture() {
        assertTrue(taps(new ExitGesture(), 7, 0, 200, 40, 40));
    }

    @Test public void sixTapsAreNotEnough() {
        assertFalse(taps(new ExitGesture(), 6, 0, 200, 40, 40));
    }

    @Test public void aSlowTapStartsTheCountAgain() {
        ExitGesture g = new ExitGesture();
        taps(g, 6, 0, 200, 40, 40);
        assertFalse(g.tap(40, 40, 1280, 800, 6 * 200 + ExitGesture.GAP_MS + 1));
    }

    @Test public void aTapOutsideTheCornerResetsTheCount() {
        ExitGesture g = new ExitGesture();
        taps(g, 6, 0, 200, 40, 40);
        assertFalse(g.tap(640, 400, 1280, 800, 1_300));
        assertFalse(g.tap(40, 40, 1280, 800, 1_400));
    }

    @Test public void theGestureCanBeRepeated() {
        ExitGesture g = new ExitGesture();
        assertTrue(taps(g, 7, 0, 200, 40, 40));
        assertFalse(taps(g, 6, 2_000, 200, 40, 40));
        assertTrue(g.tap(40, 40, 1280, 800, 3_200));
    }

    @Test public void theRightPinUnlocksAndAWrongOneDoesNot() {
        ExitGesture g = new ExitGesture();
        assertEquals(Pin.WRONG, g.attempt("1111", "2468", 0));
        assertEquals(Pin.WRONG, g.attempt(null, "2468", 0));
        assertEquals(Pin.WRONG, g.attempt("24680", "2468", 0));
        assertEquals(Pin.OK, g.attempt("2468", "2468", 0));
    }

    @Test public void anEmptyPinDisablesTheGesture() {
        assertEquals(Pin.DISABLED, new ExitGesture().attempt("", "", 0));
        assertEquals(Pin.DISABLED, new ExitGesture().attempt("1234", null, 0));
    }

    @Test public void fiveWrongPinsLockThePromptForFiveMinutes() {
        ExitGesture g = new ExitGesture();
        for (int i = 0; i < ExitGesture.MAX_WRONG; i++) assertEquals(Pin.WRONG, g.attempt("0000", "2468", i));
        assertEquals("even the right PIN is refused during the lockout", Pin.LOCKED_OUT, g.attempt("2468", "2468", 10));
        assertEquals(Pin.LOCKED_OUT, g.attempt("2468", "2468", ExitGesture.LOCKOUT_MS + 3));
        assertEquals(Pin.OK, g.attempt("2468", "2468", ExitGesture.LOCKOUT_MS + 4));
    }

    @Test public void aPinThatOnlySharesAPrefixIsWrong() {
        ExitGesture g = new ExitGesture();
        assertEquals(Pin.WRONG, g.attempt("246", "2468", 0));
        assertEquals(Pin.WRONG, g.attempt("", "2468", 0));
    }

    @Test public void aCorrectPinClearsTheWrongCount() {
        ExitGesture g = new ExitGesture();
        for (int i = 0; i < ExitGesture.MAX_WRONG - 1; i++) assertEquals(Pin.WRONG, g.attempt("0000", "2468", i));
        assertEquals(Pin.OK, g.attempt("2468", "2468", 10));
        for (int i = 0; i < ExitGesture.MAX_WRONG - 1; i++) assertEquals(Pin.WRONG, g.attempt("0000", "2468", 20 + i));
        assertEquals("four more wrong ones are not a lockout", Pin.OK, g.attempt("2468", "2468", 30));
    }
}
