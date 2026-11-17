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
        // Held on the address this device binds. On a loopback device a socket held on
        // every interface would not be the one in the way.
        java.net.InetAddress where = "loopback".equals(net.kckern.daylight.generated.DeviceConfig.CONTROL_BIND)
                ? java.net.InetAddress.getByName("127.0.0.1") : null;
        try (ServerSocket held = new ServerSocket(0, 50, where)) {
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

    @Test public void aPayloadStoppedBeforeStartReturnsDoesNotComeUp() throws Exception {
        Main main = new Main();
        int port = freePort();
        main.stop();                       // the loader's stopper, ahead of a start() it gave up on
        try {
            main.start(new FakeShell(tmp.newFolder()), port, 1);
            fail("a stopped payload reported a clean start");
        } catch (IllegalStateException expected) { }
        long deadline = System.currentTimeMillis() + 2000;
        while (heartbeatRunning() && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertFalse("the core was left running", heartbeatRunning());
        try (ServerSocket free = new ServerSocket(port)) { assertTrue(free.isBound()); }
    }

    /** Runs once per device: a device file that says loopback must not listen on the network. */
    @Test public void theControlApiListensWhereTheDeviceFileSays() throws Exception {
        Main main = new Main();
        main.start(new FakeShell(tmp.newFolder()), freePort(), 3);
        try {
            java.net.InetAddress bound = main.boundAddress();
            String bind = net.kckern.daylight.generated.DeviceConfig.CONTROL_BIND;
            assertTrue("unexpected control.bind " + bind, "loopback".equals(bind) || "lan".equals(bind));
            assertEquals(bind + " bound " + bound, "loopback".equals(bind), bound.isLoopbackAddress());
            assertEquals(bind + " bound " + bound, "lan".equals(bind), bound.isAnyLocalAddress());
        } finally {
            main.stop();
        }
    }
}
