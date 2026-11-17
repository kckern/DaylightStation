package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class DebugToolsCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void registersTheInfoRouteAndItsSetting() throws Exception {
        DebugToolsCapability cap = new DebugToolsCapability();
        assertEquals("debug-tools", cap.name());
        CoreRuntime core = TestCore.create(tmp.newFolder());
        cap.register(core);

        assertEquals(Boolean.FALSE, core.settings().get("debug.execEnabled"));
        JSONObject o = TestCore.get(core, "/debug/info");
        assertEquals(200, o.getInt("_status"));
        assertTrue(o.getBoolean("ok"));
        assertEquals("test", o.getString("device"));
        assertTrue(o.has("sdkInt"));
    }
}
