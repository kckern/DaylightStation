package net.kckern.daylight.cap.screenpower;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.spi.DeviceAdminAccess;
import net.kckern.daylight.core.spi.ScreenControl;
import net.kckern.daylight.core.spi.ScreenPower;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;

public class ScreenPowerCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private ScreenPowerCapability cap;

    /** What lockdown provides, with the answers a test wants. */
    private static final class FakeAdmin implements DeviceAdminAccess {
        boolean active, owner;
        int locks, reboots;
        @Override public boolean adminActive() { return active; }
        @Override public boolean isOwner() { return owner; }
        @Override public void lockNow() { locks++; }
        @Override public void reboot() {
            if (!owner) throw new UnsupportedException("device owner required");
            reboots++;
        }
    }

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new ScreenPowerCapability();
        assertEquals("screen-power", cap.name());
        cap.useSdkForTest(30);
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() {
        cap.stop();
        TestCore.releaseMainThread();
    }

    private JSONObject post(String path, String body) throws Exception {
        return TestCore.call(core, "POST", path, null, body);
    }

    @Test public void declaresItsSettingsRoutesAndService() {
        assertEquals(Boolean.TRUE, core.settings().get("power.keepScreenOn"));
        assertEquals(Boolean.TRUE, core.settings().get("power.wifiLock"));
        assertEquals(Boolean.TRUE, core.settings().get("power.preventSleepWhileScreenOff"));
        assertEquals(3000, core.settings().get("power.screenVerifyMs"));
        assertEquals(8000, core.settings().get("power.wakeCooldownMs"));
        assertEquals("", core.settings().get("power.noWakeStart"));
        assertEquals("", core.settings().get("power.noWakeEnd"));
        assertEquals(0, core.settings().get("power.wakeSuppressUntilSec"));
        for (String route : new String[] { "POST /screen", "POST /screen/brightness", "POST /device/reboot" }) {
            assertTrue("missing " + route, core.router().routes().contains(route));
        }
        assertNotNull(core.services().find(ScreenControl.class));
        assertNotNull("volume-keys asks for the two-method form", core.services().find(ScreenPower.class));
    }

    @Test public void screenNeedsABooleanOn() throws Exception {
        assertEquals(400, post("/screen", "{}").getInt("_status"));
        assertEquals(400, post("/screen", "{\"on\":\"yes\"}").getInt("_status"));
    }

    @Test public void screenOffWithNoWayToDoItIsUnsupportedWithTheReason() throws Exception {
        JSONObject r = post("/screen", "{\"on\":false}");
        assertEquals(501, r.getInt("_status"));
        assertEquals("unsupported", r.getString("error"));
        assertEquals("device admin or a bound accessibility service required", r.getString("reason"));
        assertFalse(core.services().find(ScreenControl.class).canTurnOff());
        assertFalse(core.services().find(ScreenPower.class).screenOff());
    }

    @Test public void anActiveDeviceAdminIsWhatTurnsTheScreenOff() throws Exception {
        FakeAdmin admin = new FakeAdmin();
        admin.active = true;
        core.services().provide(DeviceAdminAccess.class, admin);
        core.settings().set("power.screenVerifyMs", 0);
        assertTrue(core.services().find(ScreenControl.class).canTurnOff());
        JSONObject r = post("/screen", "{\"on\":false}");
        assertEquals(200, r.getInt("_status"));
        assertEquals("the admin was asked to lock", 1, admin.locks);
        // No display exists here, so its state reads off: ok is what the display says, not what was asked.
        assertTrue(r.getBoolean("ok"));
        assertFalse(r.getBoolean("screenOn"));
    }

    @Test public void screenOnThatTheDisplayDoesNotConfirmIsNotOk() throws Exception {
        core.settings().set("power.screenVerifyMs", 0);
        JSONObject r = post("/screen", "{\"on\":true}");
        assertEquals(200, r.getInt("_status"));
        assertFalse("ok only when the display's own state says so", r.getBoolean("ok"));
        assertEquals("screen_state_unchanged", r.getString("error"));
        assertFalse(r.getBoolean("screenOn"));
    }

    @Test public void brightnessMustBe0To255() throws Exception {
        assertEquals(400, post("/screen/brightness", "{\"level\":256}").getInt("_status"));
        assertEquals(400, post("/screen/brightness", "{\"level\":-1}").getInt("_status"));
        assertEquals(400, post("/screen/brightness", "{\"level\":\"bright\"}").getInt("_status"));
        assertEquals(400, post("/screen/brightness", "{}").getInt("_status"));
    }

    @Test public void rebootWithoutDeviceOwnerIsUnsupportedWithTheContractReason() throws Exception {
        JSONObject r = post("/device/reboot", null);
        assertEquals(501, r.getInt("_status"));
        assertEquals("unsupported", r.getString("error"));
        assertEquals("device owner required", r.getString("reason"));
        // An admin that is not the owner changes nothing.
        FakeAdmin admin = new FakeAdmin();
        admin.active = true;
        core.services().provide(DeviceAdminAccess.class, admin);
        assertEquals(501, post("/device/reboot", null).getInt("_status"));
        assertEquals(0, admin.reboots);
    }

    @Test public void theVerifyAndCooldownSettingsHaveRanges() throws Exception {
        for (String bad : new String[] { "{\"key\":\"power.screenVerifyMs\",\"value\":-1}",
                "{\"key\":\"power.screenVerifyMs\",\"value\":60001}", "{\"key\":\"power.wakeCooldownMs\",\"value\":-5}",
                "{\"key\":\"power.wakeSuppressUntilSec\",\"value\":-1}" }) {
            assertEquals(bad, 400, post("/settings", bad).getInt("_status"));
        }
    }

    // ── a real start, over a fake Android context ─────────────────────────────

    @Test public void aRealStartTakesWhatItNeedsAndStopGivesItBack() throws Exception {
        cap.stop();
        File dir = tmp.newFolder();
        FakeContext ctx = new FakeContext(dir);
        core = TestCore.createWithContext(dir, ctx);
        cap = new ScreenPowerCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        assertEquals(0, ctx.receivers.size());

        cap.start();
        assertEquals("hears the screen turn on and off", 1, ctx.receivers.size());
        // Brightness needs the WRITE_SETTINGS grant, which nothing here has.
        JSONObject r = post("/screen/brightness", "{\"level\":120}");
        assertEquals(501, r.getInt("_status"));
        assertEquals("WRITE_SETTINGS is not granted", r.getString("reason"));
        assertEquals(0, FakeContext.liveThreads("daylight-screen"));
        // A played note wakes a dark display: midi-bridge puts notes on the bus, and this listens.
        core.notes().noteOn(60, 100, System.currentTimeMillis());
        assertEquals("the wake worker exists once a note asked for it", 1, FakeContext.liveThreads("daylight-screen"));

        cap.stop();
        assertEquals(0, ctx.receivers.size());
        long deadline = System.currentTimeMillis() + 3000;
        while (FakeContext.liveThreads("daylight-screen") > 0 && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals(0, FakeContext.liveThreads("daylight-screen"));
        cap.stop();
        assertEquals("unregistered once, not twice", 0, ctx.receivers.size());
        core.services().find(ScreenControl.class).poke();        // after stop: does nothing, throws nothing
        core.notes().noteOn(60, 100, System.currentTimeMillis());
        assertEquals(0, FakeContext.liveThreads("daylight-screen"));
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        cap.start();
        assertFalse(core.services().find(ScreenControl.class).isOn());
        core.services().find(ScreenControl.class).poke();
        assertEquals(501, post("/screen/brightness", "{\"level\":10}").getInt("_status"));
        cap.stop();
        cap.stop();
    }

    // ── the Shield: no device admin, a bound accessibility service ────────────

    @Test public void withoutAnAdminABoundAccessibilityServiceIsTheWayOff() throws Exception {
        core.accessibility().bind(new android.accessibilityservice.AccessibilityService() {
            @Override public void onAccessibilityEvent(android.view.accessibility.AccessibilityEvent event) { }
            @Override public void onInterrupt() { }
        });
        core.settings().set("power.screenVerifyMs", 0);
        assertEquals(ScreenOffPath.Kind.ACCESSIBILITY, cap.offPath().kind);
        assertTrue(core.services().find(ScreenControl.class).canTurnOff());
        JSONObject r = post("/screen", "{\"on\":false}");
        assertEquals("supported here: the answer is what the display reads, not a 501", 200, r.getInt("_status"));
        assertFalse(r.getBoolean("screenOn"));
        // The same device with no device owner still cannot reboot.
        assertEquals("device owner required", post("/device/reboot", null).getString("reason"));
    }

    @Test public void belowAndroid9OnlyADeviceAdminCanTurnTheScreenOff() throws Exception {
        cap.useSdkForTest(27);
        core.accessibility().bind(new android.accessibilityservice.AccessibilityService() {
            @Override public void onAccessibilityEvent(android.view.accessibility.AccessibilityEvent event) { }
            @Override public void onInterrupt() { }
        });
        JSONObject r = post("/screen", "{\"on\":false}");
        assertEquals(501, r.getInt("_status"));
        assertEquals("device admin required", r.getString("reason"));
    }

    /**
     * The payload loader gives up on a start() that overruns and calls stop() from
     * another thread while start() is still running. A stop that lands in the middle
     * used to find nothing registered yet, and start() then registered its receiver and
     * its display listener, which nothing ever took back.
     */
    @Test(timeout = 20000) public void aStopThatLandsInTheMiddleOfStartLeavesNothingRegistered() throws Exception {
        cap.stop();
        File dir = tmp.newFolder();
        final Thread[] stopper = new Thread[1];
        FakeContext ctx = new FakeContext(dir) {
            @Override public android.content.Intent registerReceiver(android.content.BroadcastReceiver receiver, android.content.IntentFilter filter) {
                // stop() arrives exactly here, before the receiver is registered.
                stopper[0] = new Thread(() -> cap.stop(), "late-stop");
                stopper[0].start();
                try { stopper[0].join(300); } catch (InterruptedException ignored) { }
                return super.registerReceiver(receiver, filter);
            }
        };
        core = TestCore.createWithContext(dir, ctx);
        cap = new ScreenPowerCapability();
        core.add(cap);
        core.prepare(new JSONObject());

        cap.start();
        stopper[0].join(5000);
        assertFalse("the stop finished", stopper[0].isAlive());
        assertEquals("nothing start() took after the stop is left behind: " + ctx.receivers, 0, ctx.receivers.size());
        core.services().find(ScreenControl.class).poke();        // stopped: does nothing
        assertEquals(0, FakeContext.liveThreads("daylight-screen"));
    }

    @Test public void theWakeSuppressDeadlineIsAWholeNumberOfEpochSeconds() throws Exception {
        assertEquals(200, post("/settings", "{\"key\":\"power.wakeSuppressUntilSec\",\"value\":1800000000}").getInt("_status"));
        assertEquals(1_800_000_000, core.settings().get("power.wakeSuppressUntilSec"));
        assertEquals(200, post("/settings", "{\"key\":\"power.wakeSuppressUntilSec\",\"value\":0}").getInt("_status"));
        assertEquals(400, post("/settings", "{\"key\":\"power.wakeSuppressUntilSec\",\"value\":\"soon\"}").getInt("_status"));
    }
}
