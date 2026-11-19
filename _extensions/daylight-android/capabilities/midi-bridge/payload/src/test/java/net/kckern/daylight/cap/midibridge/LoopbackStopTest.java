package net.kckern.daylight.cap.midibridge;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class LoopbackStopTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static Thread autoResetThread() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.isAlive() && "PianoBridge-AutoReset".equals(t.getName())) return t;
        }
        return null;
    }

    /**
     * With no connector the ladder's first step waits twelve seconds for a connection
     * that cannot come, then probes, then would bounce the radio. A stop must end it.
     */
    @Test(timeout = 15000) public void stoppingTheLinkEndsAForceResetThatIsRunning() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiConfig.declare(core.settings());
        MidiLink link = MidiLink.forTest(new MidiConfig(core.settings()), core.notes(), core.socket());
        link.getLoopback().startAutoReset();
        long deadline = System.currentTimeMillis() + 2000;
        while (autoResetThread() == null && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertNotNull("the reset is running", autoResetThread());
        Thread.sleep(100);

        long t0 = System.currentTimeMillis();
        link.stop();
        long took = System.currentTimeMillis() - t0;
        assertNull("the reset thread ended with the link", autoResetThread());
        assertTrue("stop waited for it only briefly (" + took + " ms)", took < Loopback.STOP_JOIN_MS + 1000);
        link.stop();     // twice is safe
    }

    @Test public void aStoppedLinkRefusesToStartTheLadder() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiConfig.declare(core.settings());
        MidiLink link = MidiLink.forTest(new MidiConfig(core.settings()), core.notes(), core.socket());
        link.stop();
        long t0 = System.currentTimeMillis();
        assertEquals("stopped", link.forceResetLink().getString("error"));
        assertTrue("no step ran", System.currentTimeMillis() - t0 < 1000);
    }
}
