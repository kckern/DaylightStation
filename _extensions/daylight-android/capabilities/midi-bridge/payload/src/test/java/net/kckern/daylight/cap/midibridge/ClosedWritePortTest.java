package net.kckern.daylight.cap.midibridge;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A probe that was never written cannot have been echoed. The old bridge removed the
 * refused probe from its pending set and then read "no longer pending" as an echo, so
 * a closed write port answered echoed:true, and /tone and /reset passed that on.
 */
public class ClosedWritePortTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** A link with no ports: every write is refused. */
    private MidiLink closedLink(CoreRuntime core) {
        return MidiLink.forTest(new MidiConfig(core.settings()), core.notes(), core.socket());
    }

    @Test public void aProbeWithNoWritePortIsNotAnEcho() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        Loopback lb = closedLink(core).getLoopback();
        long t0 = System.currentTimeMillis();
        JSONObject r = lb.probeAndWait();
        assertFalse(r.getBoolean("sent"));
        assertFalse("nothing was written, so nothing came back", r.getBoolean("echoed"));
        assertEquals("write_port_closed", r.getString("reason"));
        assertTrue(r.isNull("rttMs"));
        assertTrue("there is nothing to wait for", System.currentTimeMillis() - t0 < Loopback.WINDOW_MS);
        assertEquals("the refusal is one miss, not two", 1, lb.snapshot().getInt("consecutiveMisses"));
        assertFalse(lb.snapshot().getBoolean("outVerified"));
    }

    @Test public void theLoopbackRouteSaysSoToo() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiBridgeCapability midi = new MidiBridgeCapability();
        midi.register(core);
        midi.useLinkForTest(closedLink(core));
        JSONObject r = TestCore.post(core, "/loopback");
        assertFalse(r.getBoolean("echoed"));
        assertEquals("write_port_closed", r.getString("reason"));
    }

    @Test public void toneDoesNotReportDeliveryWithNoWritePort() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiBridgeCapability midi = new MidiBridgeCapability();
        midi.register(core);
        midi.useLinkForTest(closedLink(core));
        JSONObject r = TestCore.post(core, "/tone");
        assertFalse(r.getBoolean("ok"));
        assertEquals("write_port_closed", r.getString("error"));
        assertFalse(r.getBoolean("sent"));
        assertFalse(r.getBoolean("echoed"));
        assertFalse(r.toString().contains("VERIFIED - "));
    }

    @Test public void aResetIsNotFixedWhileTheWritePortIsClosed() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiLink link = closedLink(core);
        assertFalse(link.verifyEcho());
        JSONObject verdict = link.resetVerdict(false, "L2");
        assertFalse(verdict.getBoolean("fixed"));
        assertEquals("write_port_closed", verdict.getString("reason"));
        assertTrue(verdict.getString("verdict").contains("write port"));
    }
}
