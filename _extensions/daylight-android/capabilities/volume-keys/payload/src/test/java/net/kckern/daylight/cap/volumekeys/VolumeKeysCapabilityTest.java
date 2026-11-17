package net.kckern.daylight.cap.volumekeys;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class VolumeKeysCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void declaresThePortalDefaultsAndReportsKeysSeen() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new VolumeKeysCapability().register(core);
        assertEquals(Boolean.TRUE, core.settings().get("keys.consumeVolume"));
        assertEquals(Boolean.FALSE, core.settings().get("keys.screenToggleEnabled"));
        assertEquals(450, core.settings().get("keys.doublePressMs"));
        JSONObject status = core.status().collect(StatusBoard.Surface.STATUS, new JSONObject());
        assertEquals(0, status.getInt("keysSeen"));
        assertEquals("beep guard unavailable", TestCore.post(core, "/accessibility/silence-beep").getString("error"));
    }

    @Test public void aDoublePressWindowOutsideTheRangeIsRefusedAsTheOldConfigRouteDid() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.add(new VolumeKeysCapability());
        core.prepare(new JSONObject());
        KeysConfig config = new KeysConfig(core.settings());
        for (int bad : new int[] { 5, 149, 2001, 99999 }) {
            JSONObject refused = TestCore.call(core, "POST", "/settings", null, "{\"key\":\"keys.doublePressMs\",\"value\":" + bad + "}");
            assertEquals(400, refused.getInt("_status"));
            assertEquals("invalid_setting", refused.getString("error"));
        }
        assertEquals(450, config.doublePressMs());
        core.settings().set("keys.doublePressMs", 2000);
        assertEquals(2000, config.doublePressMs());
    }

    @Test public void theKeyFrameIsTheOnePortalKeysSent() {
        // portal-keys ControlServer.broadcastKey built exactly this text.
        assertEquals("{\"type\":\"key\",\"key\":\"KEYCODE_VOLUME_DOWN\",\"action\":\"down\",\"interactive\":true,\"ts\":1800000000123}",
                VolumeKeys.keyFrame("KEYCODE_VOLUME_DOWN", "down", true, 1_800_000_000_123L));
        assertEquals("{\"type\":\"key\",\"key\":\"KEYCODE_VOLUME_UP\",\"action\":\"up\",\"interactive\":false,\"ts\":5}",
                VolumeKeys.keyFrame("KEYCODE_VOLUME_UP", "up", false, 5L));
    }

    @Test public void theBeepGuardSparesThisAppsOwnAccessibilityService() {
        String ours = "net.kckern.daylight.example/";
        assertTrue(VolumeBeepGuard.beeps("com.vendor.keys/.KeyEventAccessibilityService", ours));
        assertFalse(VolumeBeepGuard.beeps("net.kckern.daylight.example/net.kckern.daylight.cap.accessibility.shell.KeyEventService", ours));
        assertFalse(VolumeBeepGuard.beeps("com.vendor.presence/.PresenceService", ours));
        // Another device's build of this app is a different package and gets no pass.
        assertTrue(VolumeBeepGuard.beeps("net.kckern.daylight.examplex/.KeyEventService", ours));
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        VolumeKeysCapability keys = new VolumeKeysCapability();
        keys.register(core);
        keys.start();
        assertEquals("beep guard unavailable", TestCore.post(core, "/accessibility/silence-beep").getString("error"));
        keys.stop();
        keys.stop();
    }
}
