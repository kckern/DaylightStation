package net.kckern.daylight.cap.bluetoothcontrols;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.PairingDialogExemption;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BluetoothControlsCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void registersEveryActionAndAnswersUnavailableBeforeStart() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new BluetoothControlsCapability().register(core);

        assertEquals("roles", core.settings().get("bluetooth.mode"));
        assertEquals(Boolean.FALSE, core.settings().get("bluetooth.systemPairingDialog"));
        for (String action : new String[] { "scan", "scan/stop", "pair", "unpair", "connect", "disconnect", "pairing", "power" }) {
            assertTrue(action, core.router().routes().contains("POST /bluetooth/" + action));
        }
        JSONObject state = TestCore.get(core, "/bluetooth");
        assertEquals(200, state.getInt("_status"));
        assertEquals("unavailable", state.getString("code"));
        assertEquals("unavailable", TestCore.call(core, "POST", "/bluetooth/scan", null, "{}").getString("code"));
        assertEquals(405, TestCore.get(core, "/bluetooth/scan").getInt("_status"));
        assertFalse("no pairing is in flight", core.services().find(PairingDialogExemption.class).allowed());
    }

    @Test public void startWithoutAnAndroidContextLeavesTheControlsUnavailableAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        BluetoothControlsCapability cap = new BluetoothControlsCapability();
        cap.register(core);
        cap.start();
        assertEquals("unavailable", TestCore.get(core, "/bluetooth").getString("code"));
        cap.stop();
        cap.stop();
    }

    @Test public void aModeOutsideTheTwoIsRefusedWhenSet() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.add(new BluetoothControlsCapability());
        core.prepare(new JSONObject());
        JSONObject refused = TestCore.call(core, "POST", "/settings", null, "{\"key\":\"bluetooth.mode\",\"value\":\"gamepads\"}");
        assertEquals(400, refused.getInt("_status"));
        assertEquals("invalid_setting", refused.getString("error"));
        assertEquals("roles", core.settings().get("bluetooth.mode"));
        assertEquals(200, TestCore.call(core, "POST", "/settings", null, "{\"key\":\"bluetooth.mode\",\"value\":\"gamepad\"}").getInt("_status"));
    }

    @Test public void anUnusableModeLeavesThePayloadUpAndIsReportedInStatus() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        BluetoothControlsCapability cap = new BluetoothControlsCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        cap.startIn("gamepads", null);    // must not throw: a throw here takes the control port down
        JSONObject bt = TestCore.get(core, "/status").getJSONObject("bluetooth");
        assertFalse(bt.getBoolean("available"));
        assertTrue(bt.getString("error"), bt.getString("error").contains("gamepads"));
        JSONObject state = TestCore.get(core, "/bluetooth");
        assertEquals("unavailable", state.getString("code"));
        cap.stop();
        assertTrue(TestCore.get(core, "/status").getJSONObject("bluetooth").isNull("error"));
    }
}
