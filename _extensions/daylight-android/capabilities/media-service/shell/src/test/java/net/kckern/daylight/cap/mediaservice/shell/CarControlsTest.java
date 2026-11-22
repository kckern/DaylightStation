package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import androidx.media3.common.Player;

import org.junit.Test;

public class CarControlsTest {
    // Player.Commands is backed by SparseBooleanArray, a no-op stub on the JVM, so the
    // command set itself is checked on a device; the classification is checked here.
    @Test public void onlyTrackSkipsAreWithheldSoACarPutsTheSeekButtonsBesidePlay() {
        for (int skip : new int[] { Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM }) {
            assertTrue(CarControls.isTrackSkip(skip));
        }
        for (int kept : new int[] { Player.COMMAND_PLAY_PAUSE, Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD,
                Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_METADATA }) {
            assertFalse(CarControls.isTrackSkip(kept));
        }
    }

    @Test public void backAndForwardAreTheFirstTwoActionsThenNextAndStop() {
        assertEquals(CarControls.BACK_ACTION, CarControls.ACTIONS.get(0));
        assertEquals(CarControls.FORWARD_ACTION, CarControls.ACTIONS.get(1));
        assertEquals(CarControls.NEXT_ACTION, CarControls.ACTIONS.get(2));
        assertEquals(CarControls.STOP_ACTION, CarControls.ACTIONS.get(3));
        assertEquals(10_000, CarControls.SEEK_STEP_MS);
    }

    @Test public void longFormIsAListItemOrTwentyMinutes() {
        assertTrue(CarControls.longForm("talks", 72_000));          // a 72s prologue from Talks
        assertTrue(CarControls.longForm("scripture", 231_000));     // a 4-minute chapter
        assertTrue(CarControls.longForm("", 4_402_000));            // a lecture played on its own
        assertFalse(CarControls.longForm("", 324_000));             // an album track
        assertFalse(CarControls.longForm(null, 0));                 // unknown length, no list
        assertTrue(CarControls.longForm(null, CarControls.LONG_FORM_MS));
    }
}
