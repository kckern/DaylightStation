package net.kckern.daylight.cap.leasegate;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class LeaseGateCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void startsBlockedAndReportsItsLease() throws Exception {
        LeaseGateCapability cap = new LeaseGateCapability();
        assertEquals("lease-gate", cap.name());
        CoreRuntime core = TestCore.create(tmp.newFolder());
        cap.register(core);

        assertEquals("", core.settings().get("lease.endpoint"));
        JSONObject o = TestCore.get(core, "/lease");
        assertEquals(200, o.getInt("_status"));
        assertTrue("no lease has been granted, so the gate is closed", o.getBoolean("blocked"));
        assertFalse(o.getBoolean("configured"));
        assertEquals(-1, o.getLong("epoch"));
    }
}
