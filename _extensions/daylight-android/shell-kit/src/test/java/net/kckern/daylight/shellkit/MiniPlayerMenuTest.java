package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import java.util.Arrays;

import org.junit.Test;

/** The mini player's long-press sheet (R5): which rows for which state; destructive last. */
public class MiniPlayerMenuTest {
    @Test public void thisPhoneOffersOpenPlayOnAndStopAndClearLast() {
        assertEquals(Arrays.asList("open", "play_on", "stop_clear"), MiniPlayerMenu.rows(true, "local"));
    }

    @Test public void aScreenOffersStopOnTheScreen() {
        assertEquals(Arrays.asList("open", "play_on", "stop_screen"), MiniPlayerMenu.rows(true, "office-tv"));
    }

    @Test public void anItemTheBarCannotActOnOffersNoStop() {
        assertEquals(Arrays.asList("open", "play_on"), MiniPlayerMenu.rows(false, "local"));
    }

    @Test public void stopLabelsSayWhatHappens() {
        assertEquals("Stop and clear", MiniPlayerMenu.label("stop_clear", "This phone"));
        assertEquals("Stop on Office TV", MiniPlayerMenu.label("stop_screen", "Office TV"));
        assertEquals("Stop on a screen", MiniPlayerMenu.label("stop_screen", ""));
    }

    @Test public void onlyThisPhonesStopHasAnUndo() {
        assertTrue(MiniPlayerMenu.undoable("stop_clear"));
        assertFalse(MiniPlayerMenu.undoable("stop_screen"));
    }
}
