package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class PickerGroupsTest {
    @Test public void offScreensGoUnderOffButNeverTheOneInUse() {
        assertEquals(PickerGroups.Group.OFF, PickerGroups.of(ScreenSnapshot.Reach.OFF, false));
        assertEquals(PickerGroups.Group.OFF, PickerGroups.of(ScreenSnapshot.Reach.NOT_ON, false));
        assertEquals(PickerGroups.Group.IDLE, PickerGroups.of(ScreenSnapshot.Reach.OFF, true));
        assertEquals(PickerGroups.Group.PLAYING, PickerGroups.of(ScreenSnapshot.Reach.PLAYING_OR_PAUSED, false));
        assertEquals(PickerGroups.Group.IDLE, PickerGroups.of(ScreenSnapshot.Reach.IDLE, false));
        assertEquals(PickerGroups.Group.IDLE, PickerGroups.of(null, false));   // checking: stays in Available
    }

    @Test public void playingFirstThenIdleInTheOrderTheyAnswer() {
        PickerGroups.Group P = PickerGroups.Group.PLAYING, I = PickerGroups.Group.IDLE;
        assertEquals(0, PickerGroups.insertAt(Collections.emptyList(), P));
        assertEquals(1, PickerGroups.insertAt(Arrays.asList(P, I, I), P));
        assertEquals(3, PickerGroups.insertAt(Arrays.asList(P, I, I), I));
        assertEquals(0, PickerGroups.insertAt(Arrays.asList(I, I), P));
    }

    @Test public void theOffRowCountsThem() {
        assertEquals("Off · 7", PickerGroups.offLabel(7));
        assertEquals("", PickerGroups.offLabel(0));
    }
}
