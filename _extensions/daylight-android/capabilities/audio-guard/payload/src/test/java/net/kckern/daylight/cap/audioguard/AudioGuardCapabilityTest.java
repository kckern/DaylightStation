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
}
