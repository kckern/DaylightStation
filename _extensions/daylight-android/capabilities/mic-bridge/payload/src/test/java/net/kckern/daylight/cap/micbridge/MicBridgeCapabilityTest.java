package net.kckern.daylight.cap.micbridge;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class MicBridgeCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void statusHasTheContractFieldsBeforeTheStreamExists() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new MicBridgeCapability().register(core);
        assertEquals(8765, core.settings().get("mic.port"));
        JSONObject s = TestCore.get(core, "/mic/status");
        assertTrue(s.getBoolean("ok"));
        assertFalse(s.getBoolean("running"));
        assertFalse(s.getBoolean("streaming"));
        assertEquals(0, s.getInt("clients"));
        assertFalse(s.getBoolean("heldByOther"));
        assertTrue(s.isNull("lastError"));
    }

    @Test public void restartBeforeStartIsNotASuccess() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new MicBridgeCapability().register(core);
        JSONObject r = TestCore.post(core, "/mic/restart");
        assertFalse("ok only after capture is confirmed running", r.getBoolean("ok"));
        assertFalse(r.getBoolean("running"));
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MicBridgeCapability mic = new MicBridgeCapability();
        mic.register(core);
        mic.start();
        assertFalse(TestCore.get(core, "/mic/status").getBoolean("running"));
        JSONObject status = core.status().collect(StatusBoard.Surface.STATUS, new JSONObject());
        assertFalse(status.getJSONObject("mic").getBoolean("running"));
        mic.stop();
        mic.stop();
    }
}
