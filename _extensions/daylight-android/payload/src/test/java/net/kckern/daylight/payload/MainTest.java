package net.kckern.daylight.payload;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import net.kckern.daylight.core.testing.FakeShell;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.lang.reflect.Modifier;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URL;

public class MainTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static boolean heartbeatRunning() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.isAlive() && "Daylight-ws-heartbeat".equals(t.getName())) return true;
        }
        return false;
    }

    private static int freePort() throws Exception {
        try (ServerSocket s = new ServerSocket(0)) { return s.getLocalPort(); }
    }

    @Test public void startsAndServesTheControlApi() throws Exception {
        Main main = new Main();
        int port = freePort();
        main.start(new FakeShell(tmp.newFolder()), port, 3);
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/status").openConnection();
            c.setRequestProperty("X-Daylight-Token", FakeShell.TOKEN);
            assertEquals(200, c.getResponseCode());
        } finally {
            main.stop();
        }
    }

    @Test public void aControlPortThatCannotBeBoundFailsThePayloadAndStopsWhatStarted() throws Exception {
        Main main = new Main();
        try (ServerSocket held = new ServerSocket(0)) {
            try {
                main.start(new FakeShell(tmp.newFolder()), held.getLocalPort(), 2);
                fail("a payload with a dead control port must not report a clean start");
            } catch (IllegalStateException expected) {
                assertTrue(expected.getMessage(), expected.getMessage().contains("control port"));
            }
        }
        // The core's socket heartbeat is the visible sign that the core was stopped.
        long deadline = System.currentTimeMillis() + 2000;
        while (heartbeatRunning() && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertFalse("the core was left running", heartbeatRunning());
        main.onShellComponent("accessibility", null);   // no core: must be a no-op, not a throw
    }

    @Test public void theCoreFieldIsSafelyPublishedToOtherThreads() throws Exception {
        assertTrue(Modifier.isVolatile(Main.class.getDeclaredField("core").getModifiers()));
    }
}
