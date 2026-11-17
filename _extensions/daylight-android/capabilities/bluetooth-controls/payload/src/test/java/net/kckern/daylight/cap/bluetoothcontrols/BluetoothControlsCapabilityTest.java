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
}
