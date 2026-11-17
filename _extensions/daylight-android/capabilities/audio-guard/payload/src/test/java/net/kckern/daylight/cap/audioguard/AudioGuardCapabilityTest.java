package net.kckern.daylight.cap.audioguard;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.BluetoothRole;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class AudioGuardCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private CoreRuntime registered() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new AudioGuardCapability().register(core);
        return core;
    }

    @Test public void declaresTheSpeakerSettingsAndOffersTheAudioRole() throws Exception {
        CoreRuntime core = registered();
        assertEquals("", core.settings().get("speaker.mac"));
        assertEquals(Boolean.TRUE, core.settings().get("speaker.enabled"));
        BluetoothRole role = core.services().find(BluetoothRole.class);
        assertEquals("audio", role.profile());
        assertFalse("no connector before start", role.present());
    }

    @Test public void routesAnswerNotReadyBeforeStart() throws Exception {
        CoreRuntime core = registered();
        assertEquals("no_a2dp", TestCore.get(core, "/speaker").getString("error"));
        assertEquals("no_a2dp", TestCore.post(core, "/speaker/reconnect").getString("error"));
        assertEquals("not_ready", TestCore.post(core, "/audio-guard/volume-check").getString("error"));
        assertEquals("not_ready", TestCore.post(core, "/audio-guard/override").getString("error"));
        assertEquals(405, TestCore.get(core, "/speaker/reconnect").getInt("_status"));
    }

    @Test public void theStatusFrameSaysTheSpeakerIsNotOkUntilAGuardExists() throws Exception {
        CoreRuntime core = registered();
        JSONObject frame = core.status().collect(StatusBoard.Surface.FRAME, new JSONObject());
        assertFalse(frame.getBoolean("speakerOk"));
        assertEquals("no_guard", frame.getString("speakerReason"));
    }

    @Test public void aStartWithNoAndroidContextLeavesTheHostAbsentAndStopsTwice() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        AudioGuardCapability capability = new AudioGuardCapability();
        core.add(capability);
        core.start(new JSONObject("{}"));
        assertEquals("no_a2dp", TestCore.get(core, "/speaker").getString("error"));
        assertTrue(TestCore.get(core, "/status").isNull("speaker"));
        capability.stop();
        capability.stop();
    }

    private static Thread cycleThread() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.isAlive() && "PianoBridge-bt-cycle".equals(t.getName())) return t;
        }
        return null;
    }

    @Test(timeout = 15000) public void stopEndsABluetoothCycleInFlightAndBluetoothIsAskedBackOn() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        AudioGuardCapability capability = new AudioGuardCapability();
        capability.register(core);
        final java.util.concurrent.atomic.AtomicBoolean on = new java.util.concurrent.atomic.AtomicBoolean(true);
        final java.util.concurrent.atomic.AtomicInteger enables = new java.util.concurrent.atomic.AtomicInteger();
        capability.useCyclerForTest(new AdapterCycler(new AdapterCycler.Ops() {
            @Override public boolean isEnabled() { return on.get(); }
            @Override public boolean enable() { enables.incrementAndGet(); on.set(true); return true; }
            @Override public boolean disable() { on.set(false); return true; }
        }, new AdapterCycler.Clock() {
            @Override public long now() { return System.currentTimeMillis(); }
            @Override public void sleep(long ms) throws InterruptedException { Thread.sleep(ms); }
        }));

        java.util.Map<String, String> query = new java.util.HashMap<>();
        query.put("settleMs", "30000");                 // the cycle would sit with Bluetooth off for 30 s
        assertTrue(TestCore.call(core, "POST", "/speaker/bt-cycle", query, null).getBoolean("ok"));
        long deadline = System.currentTimeMillis() + 3000;
        while (on.get() && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertFalse("the cycle switched Bluetooth off", on.get());

        capability.stop();
        assertNull("the cycle's thread ended with the capability", cycleThread());
        assertTrue("Bluetooth was not left off", on.get());
        assertEquals(1, enables.get());
        capability.stop();
        assertEquals("no_bluetooth", TestCore.post(core, "/speaker/bt-cycle").getString("error"));
    }
}
