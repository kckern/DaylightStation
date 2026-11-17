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

    @Test public void aKeyPressReachesThePageOnTheControlSocketAsAKeyboardMessage() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        final List<String> seen = new CopyOnWriteArrayList<>();
        core.socket().opened(new SocketHub.Client() {
            @Override public void send(String text) { seen.add(text); }
            @Override public void ping() { }
            @Override public void close() { }
        });
        HidEventStream stream = new HidEventStream(core.socket());
        stream.publish(new HidKeyEvent(4, "down", "a", "KeyA", 0, false, false, false, false, false));
        stream.publish(new HidKeyEvent(4, "up", "a", "KeyA", 0, false, false, false, false, false));
        long deadline = System.currentTimeMillis() + 2000;
        while (seen.size() < 3 && System.currentTimeMillis() < deadline) Thread.sleep(10);
        stream.stop();
        assertEquals("ready, then down and up", 3, seen.size());
        JSONObject down = new JSONObject(seen.get(1));
        assertEquals("keyboard", down.getString("type"));
        assertEquals("down", down.getString("action"));
        assertEquals("KeyA", down.getString("code"));
        assertEquals("up", new JSONObject(seen.get(2)).getString("action"));
        assertEquals(2, stream.events());
        // A report that arrives after stop() is sent once and must not throw.
        stream.publish(new HidKeyEvent(5, "down", "b", "KeyB", 0, false, false, false, false, false));
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
}
