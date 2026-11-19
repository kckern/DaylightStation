package net.kckern.daylight.cap.bluetoothcontrols;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * The audio-bridge ControlServerTest, restated against the router: its own NanoHTTPD
 * server is not ported. The gamepad API answers 200 for state, 202 for an accepted
 * action, 400 for an invalid request and 409 for a refused one.
 */
public class GamepadHttpStatusTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private GamepadControllerTest.FakePort port;

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        BluetoothControlsCapability cap = new BluetoothControlsCapability();
        cap.register(core);
        port = new GamepadControllerTest.FakePort();
        cap.useForTest(new BluetoothController(port, () -> 0L), true);
    }

    @Test public void stateIs200AnAcceptedActionIs202() throws Exception {
        assertEquals(200, TestCore.get(core, "/bluetooth").getInt("_status"));
        assertEquals(202, TestCore.call(core, "POST", "/bluetooth/scan/stop", null, "{}").getInt("_status"));
        assertEquals("stop", port.action);
    }

    @Test public void aGetOnAnActionIs405AndNeverReachesThePort() throws Exception {
        assertEquals(405, TestCore.get(core, "/bluetooth/unpair").getInt("_status"));
        assertNull(port.action);
    }

    @Test public void anInvalidRequestIs400AndNeverReachesThePort() throws Exception {
        assertEquals(400, TestCore.call(core, "POST", "/bluetooth/unpair", null, "{\"address\":\"nope\"}").getInt("_status"));
        assertEquals(400, TestCore.call(core, "POST", "/bluetooth/scan", null, new String(new char[8193]).replace('\0', ' ')).getInt("_status"));
        assertNull(port.action);
    }

    @Test public void aRefusedActionIs409() throws Exception {
        port.accepted = false;
        assertEquals(409, TestCore.call(core, "POST", "/bluetooth/scan/stop", null, "{}").getInt("_status"));
    }

    @Test public void thePowerActionDoesNotExistForGamepads() throws Exception {
        JSONObject r = TestCore.call(core, "POST", "/bluetooth/power", null, "{\"enabled\":false}");
        assertEquals(400, r.getInt("_status"));
        assertEquals("invalid_request", r.getString("code"));
        assertNull(port.action);
    }

    @Test public void roleModeKeepsAnswering200WithTheResultInTheBody() throws Exception {
        CoreRuntime rolesCore = TestCore.create(tmp.newFolder());
        BluetoothControlsCapability cap = new BluetoothControlsCapability();
        cap.register(rolesCore);
        // A port with the default (roles) policy that refuses everything.
        GamepadControllerTest.FakePort rolesPort = new GamepadControllerTest.FakePort() {
            @Override public BluetoothController.Policy policy() { return BluetoothController.Policy.ROLES; }
        };
        rolesPort.accepted = false;
        cap.useForTest(new BluetoothController(rolesPort, () -> 0L), false);
        JSONObject refused = TestCore.call(rolesCore, "POST", "/bluetooth/scan/stop", null, "{}");
        assertEquals(200, refused.getInt("_status"));
        assertEquals("action_rejected", refused.getString("code"));
        assertEquals(200, TestCore.call(rolesCore, "POST", "/bluetooth/unpair", null, "{\"address\":\"nope\"}").getInt("_status"));
    }

    @Test public void distinguishesJoystickAndGamepadFromKeyboardAndRemote() {
        assertTrue(GamepadBluetoothPort.isGamepadClass(0x2508));
        assertTrue(GamepadBluetoothPort.isGamepadClass(0x2504));
        assertFalse(GamepadBluetoothPort.isGamepadClass(0x2540));
        assertFalse(GamepadBluetoothPort.isGamepadClass(0x250c));
        assertFalse(GamepadBluetoothPort.isGamepadClass(0));
    }
}
