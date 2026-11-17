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
        assertEquals("unavailable", o.getString("enforcement"));
    }

    @Test public void theCredentialIsASecret() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new LeaseGateCapability().register(core);
        core.settings().set("lease.credential", "0123456789abcdef0123456789abcdef");
        assertFalse(TestCore.get(core, "/settings").toString().contains("0123456789abcdef0123456789abcdef"));
        assertFalse(TestCore.get(core, "/lease").toString().contains("0123456789abcdef0123456789abcdef"));
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        LeaseGateCapability cap = new LeaseGateCapability();
        cap.register(core);
        cap.start();
        assertTrue(TestCore.get(core, "/lease").getBoolean("blocked"));
        cap.stop();
        cap.stop();
    }

    // ── lease.enabled: installed beside supervision-guard, which runs the loop ─

    @Test public void withTheSwitchOffNoLeaseLoopRunsUntilItIsTurnedOn() throws Exception {
        java.io.File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        CoreRuntime core = TestCore.createWithContext(dir, ctx);
        try {
            LeaseGateCapability cap = new LeaseGateCapability();
            core.add(cap);
            core.prepare(new JSONObject("{\"lease.enabled\":false}"));
            cap.start();
            assertEquals("no loop: the answer is the one given before start", "unavailable", TestCore.get(core, "/lease").getString("enforcement"));
            assertFalse(TestCore.get(core, "/status").getJSONObject("switches").getJSONObject("lease.enabled").getBoolean("active"));
            assertEquals(Boolean.FALSE, core.settings().get("lease.enabled"));
            cap.stop();
            cap.stop();
        } finally {
            TestCore.releaseMainThread();
        }
    }
}
