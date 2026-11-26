package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import androidx.media3.common.Player;

import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public class ScreenCommandsTest {
    private static ScreenSnapshot snap(String state) throws Exception {
        return ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":200,\"snapshot\":{\"state\":\"" + state + "\","
                + "\"currentItem\":{\"contentId\":\"plex:2\",\"title\":\"Two\",\"duration\":100},\"position\":10,"
                + "\"queue\":{\"currentIndex\":1,\"items\":[{\"queueItemId\":\"q1\",\"contentId\":\"plex:1\"},"
                + "{\"queueItemId\":\"q2\",\"contentId\":\"plex:2\"},{\"queueItemId\":\"q3\",\"contentId\":\"plex:3\"}]},"
                + "\"config\":{\"volume\":40,\"repeat\":\"all\",\"shuffle\":true}}}"));
    }

    @Test public void playAndPauseAreTransport() {
        JSONObject play = ScreenCommands.playWhenReady("office-tv", true);
        assertEquals("screen-command", play.optString("op"));
        assertEquals("office-tv", play.optString("device"));
        assertEquals("transport", play.optString("command"));
        assertEquals("play", play.optString("action"));
        assertEquals("pause", ScreenCommands.playWhenReady("office-tv", false).optString("action"));
        assertEquals("stop", ScreenCommands.stop("office-tv").optString("action"));
    }

    /** The command that asked says what was meant; Media3's computed index does not. */
    @Test public void seeksMapByTheCommandThatAsked() throws Exception {
        ScreenSnapshot s = snap("playing");
        assertEquals("skipNext", ScreenCommands.seek("d", s, 2, 0, Player.COMMAND_SEEK_TO_NEXT).optString("action"));
        assertEquals("skipNext", ScreenCommands.seek("d", s, 2, 0, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM).optString("action"));
        assertEquals("skipPrev", ScreenCommands.seek("d", s, 1, 0, Player.COMMAND_SEEK_TO_PREVIOUS).optString("action"));
        JSONObject back = ScreenCommands.seek("d", s, 1, 0, Player.COMMAND_SEEK_BACK);
        assertEquals("seekRel", back.optString("action"));
        assertEquals(-10.0, back.optDouble("value"), 0);
        assertEquals(10.0, ScreenCommands.seek("d", s, 1, 0, Player.COMMAND_SEEK_FORWARD).optDouble("value"), 0);
        JSONObject abs = ScreenCommands.seek("d", s, 1, 42_500, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM);
        assertEquals("seekAbs", abs.optString("action"));
        assertEquals(42.5, abs.optDouble("value"), 0);
    }

    @Test public void tappingAnotherEntryJumpsToItById() throws Exception {
        JSONObject jump = ScreenCommands.seek("d", snap("playing"), 2, 0, Player.COMMAND_SEEK_TO_MEDIA_ITEM);
        assertEquals("queue", jump.optString("command"));
        assertEquals("jump", jump.optString("op"));
        assertEquals("q3", jump.optString("queueItemId"));
        // The current entry again is a restart, not a jump.
        assertEquals("seekAbs", ScreenCommands.seek("d", snap("playing"), 1, 0, Player.COMMAND_SEEK_TO_DEFAULT_POSITION).optString("action"));
        assertNull(ScreenCommands.seek("d", snap("playing"), 9, 0, Player.COMMAND_SEEK_TO_MEDIA_ITEM));
    }

    @Test public void removingEverythingIsAClearAndOneEntryIsARemoveById() throws Exception {
        List<JSONObject> all = ScreenCommands.remove("d", snap("playing"), 0, 3);
        assertEquals(1, all.size());
        assertEquals("clear", all.get(0).optString("op"));
        List<JSONObject> one = ScreenCommands.remove("d", snap("playing"), 2, 3);
        assertEquals(1, one.size());
        assertEquals("remove", one.get(0).optString("op"));
        assertEquals("q3", one.get(0).optString("queueItemId"));
        assertTrue(ScreenCommands.remove("d", snap("playing"), 5, 9).isEmpty());
    }

    @Test public void aMoveSendsTheWholeNewOrder() throws Exception {
        JSONObject move = ScreenCommands.move("d", snap("playing"), 2, 3, 0);
        assertEquals("reorder", move.optString("op"));
        assertEquals("[\"q3\",\"q1\",\"q2\"]", move.optJSONArray("items").toString());
    }

    @Test public void settingsMapToTheScreensWords() {
        assertTrue(ScreenCommands.shuffle("d", true).optBoolean("enabled"));
        assertEquals("one", ScreenCommands.repeat("d", Player.REPEAT_MODE_ONE).optString("mode"));
        assertEquals("all", ScreenCommands.repeat("d", Player.REPEAT_MODE_ALL).optString("mode"));
        assertEquals("off", ScreenCommands.repeat("d", Player.REPEAT_MODE_OFF).optString("mode"));
        assertEquals(100, ScreenCommands.volume("d", 140).optInt("level"));
        assertEquals(0, ScreenCommands.volume("d", -5).optInt("level"));
        assertEquals(Player.REPEAT_MODE_ALL, ScreenCommands.repeatMode("all"));
    }

    @Test public void stateWordsBecomeMedia3States() throws Exception {
        assertEquals(Player.STATE_READY, ScreenCommands.playbackState(snap("playing")));
        assertTrue(ScreenCommands.playWhenReady(snap("playing")));
        assertEquals(Player.STATE_READY, ScreenCommands.playbackState(snap("paused")));
        assertFalse(ScreenCommands.playWhenReady(snap("paused")));
        assertEquals(Player.STATE_BUFFERING, ScreenCommands.playbackState(snap("stalled")));
        assertTrue(ScreenCommands.playWhenReady(snap("buffering")));
        assertEquals(Player.STATE_ENDED, ScreenCommands.playbackState(snap("ended")));
        assertEquals(Player.STATE_IDLE, ScreenCommands.playbackState(snap("error")));
        ScreenSnapshot off = ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":503,\"snapshot\":{\"state\":\"playing\","
                + "\"currentItem\":{\"contentId\":\"plex:1\"}}}"));
        assertEquals("an off screen is never shown playing", Player.STATE_IDLE, ScreenCommands.playbackState(off));
        assertFalse(ScreenCommands.playWhenReady(off));
    }

    @Test public void aCommandsLineSaysWhatTheScreenAnswered() throws Exception {
        assertEquals("", ScreenPlayer.commandLine(new JSONObject("{\"ok\":true,\"status\":200,\"accepted\":true}"), "Office"));
        assertEquals("Not confirmed by Office", ScreenPlayer.commandLine(
                new JSONObject("{\"ok\":true,\"status\":502,\"accepted\":false,\"code\":\"DEVICE_REFUSED\"}"), "Office"));
        assertEquals("Office is off", ScreenPlayer.commandLine(
                new JSONObject("{\"ok\":true,\"status\":409,\"accepted\":false,\"code\":\"DEVICE_OFFLINE\"}"), "Office"));
        assertEquals("", ScreenPlayer.commandLine(
                new JSONObject("{\"ok\":true,\"status\":409,\"accepted\":false,\"code\":\"IDEMPOTENCY_CONFLICT\"}"), "Office"));
        assertEquals("Can't reach home", ScreenPlayer.commandLine(null, "Office"));
        assertEquals("Can't reach home", ScreenPlayer.commandLine(new JSONObject("{\"ok\":false,\"error\":\"unreachable\"}"), "Office"));
    }

    @Test public void clockReadsLikeAPlayer() {
        assertEquals("0:07", NowPlayingActivity.clock(7_400));
        assertEquals("12:05", NowPlayingActivity.clock(725_000));
        assertEquals("1:02:03", NowPlayingActivity.clock(3_723_000));
    }

    @Test public void aPickerRowsIconFollowsTheRegistryType() {
        assertEquals(R.drawable.daylight_np_tv, NowPlayingActivity.iconFor("shield-tv", "Living Room TV"));
        assertEquals(R.drawable.daylight_np_tv, NowPlayingActivity.iconFor("linux-pc", "Office Screen"));
        assertEquals(R.drawable.daylight_np_tablet, NowPlayingActivity.iconFor("android-tablet", "Portal"));
        assertEquals(R.drawable.daylight_np_headphones, NowPlayingActivity.iconFor("speaker", "Red musiCozy Headset"));
        assertEquals(R.drawable.daylight_np_speaker, NowPlayingActivity.iconFor("speaker", "10-SYNC Speaker"));
        assertEquals(R.drawable.daylight_np_tv, NowPlayingActivity.iconFor("", null));
    }
}
