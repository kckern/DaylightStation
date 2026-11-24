package net.kckern.daylight.shellkit;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PlaylistUseTest {
    private static final String ID = "plex:757556";

    @Test public void aPlaylistNothingUsesIsNotInUse() {
        Map<String, Object> prefs = new HashMap<>();
        prefs.put("staged_playlist." + ID, "FM100");
        assertFalse(PlaylistUse.inUse(prefs, ID));
    }

    @Test public void driveADayRuleOrAWidgetEachCountAsUse() {
        Map<String, Object> drive = new HashMap<>();
        drive.put("drive_staple." + ID, true);
        assertTrue(PlaylistUse.inUse(drive, ID));

        Map<String, Object> day = new HashMap<>();
        day.put("driving_radio.0", ID);
        assertTrue(PlaylistUse.inUse(day, ID));

        Map<String, Object> widget = new HashMap<>();
        widget.put("button.43.action", "c:" + ID);
        assertTrue(PlaylistUse.inUse(widget, ID));
    }

    @Test public void switchedOffDriveAndOtherPlaylistsDoNotCount() {
        Map<String, Object> prefs = new HashMap<>();
        prefs.put("drive_staple." + ID, false);
        prefs.put("driving_radio.2", "plex:1");
        prefs.put("button.43.action", "c:plex:2");
        prefs.put("button.43.action.label", "c:" + ID);
        assertFalse(PlaylistUse.inUse(prefs, ID));
    }

    @Test public void describeListsWhereItIsUsed() {
        Map<String, Object> prefs = new HashMap<>();
        prefs.put("drive_staple." + ID, true);
        prefs.put("driving_radio.0", ID);
        prefs.put("driving_radio.2", ID);
        prefs.put("button.43.action", "c:" + ID);
        prefs.put("button.44.action", "c:" + ID);
        String[] weekdays = {"", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};
        assertEquals("Drive · Radio default · Monday · 2 widgets", PlaylistUse.describe(prefs, ID, weekdays));
        assertEquals("", PlaylistUse.describe(new HashMap<>(), ID, weekdays));
    }
}
