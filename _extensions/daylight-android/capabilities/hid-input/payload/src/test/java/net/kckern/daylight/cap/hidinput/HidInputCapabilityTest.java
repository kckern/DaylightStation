package net.kckern.daylight.cap.hidinput;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.SocketHub;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class HidInputCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void routesAnswerUnavailableBeforeStartAndTheBluetoothRoutesAreNamespaced() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new HidInputCapability().register(core);
        assertEquals("USB HID unavailable", TestCore.get(core, "/usb-hid").getString("error"));
        assertEquals("USB HID unavailable", TestCore.post(core, "/usb-hid/retry").getString("error"));
        assertEquals("Bluetooth unavailable", TestCore.get(core, "/hid/bluetooth").getString("error"));
        assertEquals("Bluetooth unavailable", TestCore.post(core, "/hid/bluetooth/gatt-disconnect").getString("error"));
        assertFalse("/bluetooth belongs to bluetooth-controls", core.router().routes().contains("GET /bluetooth"));
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        HidInputCapability hid = new HidInputCapability();
        hid.register(core);
        hid.start();
        assertEquals("Input probe unavailable", TestCore.get(core, "/input").getString("error"));
        assertEquals("Bluetooth unavailable", TestCore.get(core, "/hid/bluetooth/radio").getString("error"));
        JSONObject status = core.status().collect(StatusBoard.Surface.STATUS, new JSONObject());
        assertTrue(status.isNull("usbHid"));
        assertEquals(0, status.getLong("hidEvents"));
        hid.stop();
        hid.stop();
    }

    @Test public void aKeyPressReachesOnlyTheFocusedPageAndNeverTheControlSocket() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        final List<String> seen = new CopyOnWriteArrayList<>();
        core.socket().opened(new SocketHub.Client() {
            @Override public void send(String text) { seen.add(text); }
            @Override public void ping() { }
            @Override public void close() { }
        });
        List<JSONObject> page = new CopyOnWriteArrayList<>();
        HidEventStream stream = new HidEventStream(() -> page::add);
        stream.publish(new HidKeyEvent(4, "down", "a", "KeyA", 0, false, false, false, false, false));
        stream.publish(new HidKeyEvent(4, "up", "a", "KeyA", 0, false, false, false, false, false));
        stream.stop();
        assertEquals(2, page.size());
        assertEquals("control clients only receive their ready greeting", 1, seen.size());
        JSONObject down = page.get(0);
        assertEquals("keyboard", down.getString("type"));
        assertEquals("down", down.getString("action"));
        assertEquals("KeyA", down.getString("code"));
        assertEquals("up", page.get(1).getString("action"));
        assertEquals(2, stream.events());
        // A late report after stop is discarded.
        stream.publish(new HidKeyEvent(5, "down", "b", "KeyB", 0, false, false, false, false, false));
        assertEquals(2, page.size());
    }

    // ── a real start, over a fake Android context ───────────────────────────

    @Test public void aRealStartRegistersItsReceiversAndStopUnregistersEveryOne() throws Exception {
        java.io.File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        CoreRuntime core = TestCore.createWithContext(dir, ctx);
        try {
            HidInputCapability hid = new HidInputCapability();
            core.add(hid);
            core.prepare(new JSONObject());

            hid.start();
            assertEquals("one receiver for USB attach and permission, one for Bluetooth", 2, ctx.receivers.size());
            // The parts exist now. What they answer with no USB or Bluetooth service behind
            // them is not this test's subject; that they are no longer "unavailable" is.
            assertNotEquals("USB HID unavailable", TestCore.get(core, "/usb-hid").optString("error"));
            assertNotEquals("Bluetooth unavailable", TestCore.get(core, "/hid/bluetooth").optString("error"));
            assertNotEquals("Input probe unavailable", TestCore.get(core, "/input").optString("error"));

            hid.stop();
            assertTrue("every receiver was unregistered: " + ctx.receivers, ctx.receivers.isEmpty());
            assertEquals(2, ctx.registered);
            assertEquals("USB HID unavailable", TestCore.get(core, "/usb-hid").getString("error"));
            assertEquals("Bluetooth unavailable", TestCore.get(core, "/hid/bluetooth").getString("error"));
            assertEquals("Input probe unavailable", TestCore.get(core, "/input").getString("error"));
            hid.stop();
            assertTrue(ctx.receivers.isEmpty());
        } finally {
            TestCore.releaseMainThread();
        }
    }

    // ── hid.enabled: installed beside portal-keys, which holds the keyboard ───

    @Test public void withTheSwitchOffTheUsbKeyboardIsNotClaimedUntilItIsTurnedOn() throws Exception {
        java.io.File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        CoreRuntime core = TestCore.createWithContext(dir, ctx);
        try {
            HidInputCapability hid = new HidInputCapability();
            core.add(hid);
            core.prepare(new JSONObject("{\"hid.enabled\":false}"));    // the Portal's device file

            hid.start();
            assertEquals("only the Bluetooth diagnostics' receiver: no USB attach or permission receiver", 1, ctx.receivers.size());
            assertEquals("USB HID unavailable", TestCore.get(core, "/usb-hid").getString("error"));
            JSONObject row = TestCore.get(core, "/status").getJSONObject("switches").getJSONObject("hid.enabled");
            assertFalse(row.getBoolean("setting"));
            assertFalse(row.getBoolean("active"));

            core.settings().set("hid.enabled", true);                   // the cutover, with no restart
            assertEquals(2, ctx.receivers.size());
            assertNotEquals("USB HID unavailable", TestCore.get(core, "/usb-hid").optString("error"));
            assertTrue(TestCore.get(core, "/status").getJSONObject("switches").getJSONObject("hid.enabled").getBoolean("active"));

            core.settings().set("hid.enabled", false);                  // the rollback
            assertEquals("the USB receiver is given back", 1, ctx.receivers.size());
            assertEquals("USB HID unavailable", TestCore.get(core, "/usb-hid").getString("error"));

            hid.stop();
            assertTrue(ctx.receivers.isEmpty());
        } finally {
            TestCore.releaseMainThread();
        }
    }
}
