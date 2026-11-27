package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DismissGestureTest {
    // A 3x screen (density 3), slop 24 px, a 2400 px tall Now playing.
    private final DismissGesture g = new DismissGesture(3f, 24f);
    private static final float H = 2400f;

    @Test public void aClearDownwardDragIsADismiss() {
        assertEquals(DismissGesture.Move.DISMISS, g.decide(5, 60));
        assertEquals(DismissGesture.Move.DISMISS, g.decide(-30, 60));
    }

    @Test public void withinTheSlopNothingIsDecided() {
        assertEquals(DismissGesture.Move.UNDECIDED, g.decide(10, 20));
        assertEquals(DismissGesture.Move.UNDECIDED, g.decide(0, 0));
    }

    @Test public void sidewaysIsTheCoversSkipNotADismiss() {
        assertEquals(DismissGesture.Move.NOT_MINE, g.decide(80, 10));
        assertEquals(DismissGesture.Move.NOT_MINE, g.decide(-80, 30));
        // Diagonal, down not clearly ahead of sideways: left to the screen.
        assertEquals(DismissGesture.Move.NOT_MINE, g.decide(50, 60));
    }

    @Test public void upwardIsNeverADismiss() {
        assertEquals(DismissGesture.Move.NOT_MINE, g.decide(0, -60));
    }

    @Test public void aClearDownwardDragPastAQuarterDismisses() {
        assertTrue(DismissGesture.dismisses(0, 600, 2400, 0f, DismissGesture.Area.COVER, true));
    }

    @Test public void aShortDragSpringsBack() {
        assertFalse(DismissGesture.dismisses(0, 300, 2400, 0f, DismissGesture.Area.COVER, true));
    }

    @Test public void aFastFlingDismissesEvenIfShort() {
        assertTrue(DismissGesture.dismisses(0, 200, 2400, 2500f, DismissGesture.Area.COVER, true));
    }

    @Test public void sidewaysIsASkipNotADismiss() {
        assertFalse(DismissGesture.dismisses(500, 200, 2400, 0f, DismissGesture.Area.COVER, true));
    }

    @Test public void theSeekBarNeverDismisses() {
        assertFalse(DismissGesture.dismisses(0, 900, 2400, 3000f, DismissGesture.Area.SEEK_BAR, true));
    }

    @Test public void aListDismissesOnlyAtItsTop() {
        assertFalse(DismissGesture.dismisses(0, 900, 2400, 3000f, DismissGesture.Area.LIST, false));
        assertTrue(DismissGesture.dismisses(0, 900, 2400, 0f, DismissGesture.Area.LIST, true));
    }

    @Test public void letGoPastAQuarterClosesAndShortSpringsBack() {
        assertTrue(g.closes(0, H * 0.25f, (int) H, 0));
        assertFalse(g.closes(0, H * 0.2f, (int) H, 100));
        assertFalse(g.closes(0, -50, (int) H, 5000));
    }

    @Test public void aFlickClosesButATwitchNever() {
        // 48 dp = 144 px at density 3.
        assertTrue(g.closes(0, 200, (int) H, 2500));
        assertFalse("too slow for a flick", g.closes(0, 200, (int) H, 1000));
        assertFalse("a flick shorter than 48 dp is a twitch", g.closes(0, 100, (int) H, 9000));
    }

    @Test public void onTheCoverAnyStartMayDismiss() {
        assertTrue(DismissGesture.mayStart(false, false, false, false));
        assertTrue(DismissGesture.mayStart(false, true, false, false));
    }

    @Test public void onAListStageOnlyWithTheListAtItsTop() {
        assertTrue(DismissGesture.mayStart(true, true, false, false));
        assertFalse("scrolling back up a list never closes the player", DismissGesture.mayStart(true, false, false, false));
    }

    @Test public void theSeekBarAndDragHandlesKeepTheirOwnDrag() {
        assertFalse(DismissGesture.mayStart(false, true, true, false));
        assertFalse(DismissGesture.mayStart(true, true, true, false));
    }

    @Test public void anyOtherScrolledListUnderTheFingerKeepsTheDrag() {
        assertFalse(DismissGesture.mayStart(false, true, false, true));
    }

    @Test public void theSheetNeverRisesAboveWhereItOpened() {
        assertEquals(0f, DismissGesture.offset(-40), 0f);
        assertEquals(120f, DismissGesture.offset(120), 0f);
    }
}
