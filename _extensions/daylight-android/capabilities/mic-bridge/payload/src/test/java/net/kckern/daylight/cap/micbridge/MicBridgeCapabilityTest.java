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

    // ── a started stream, with no window manager ────────────────────────────

    private static final class NoOverlay implements MicBridgeCapability.Overlay {
        final java.util.concurrent.atomic.AtomicInteger rebuilds = new java.util.concurrent.atomic.AtomicInteger();
        @Override public void ensure(android.content.Context c) { }
        @Override public void rebuild(android.content.Context c) throws InterruptedException {
            rebuilds.incrementAndGet();
            Thread.sleep(50);      // the settle wait, during which a second restart can arrive
        }
    }

    private static int freePort() throws Exception {
        try (java.net.ServerSocket s = new java.net.ServerSocket(0)) { return s.getLocalPort(); }
    }

    private static boolean portIsFree(int port) {
        try (java.net.ServerSocket s = new java.net.ServerSocket(port, 1, java.net.InetAddress.getLoopbackAddress())) {
            return true;
        } catch (java.io.IOException taken) {
            return false;
        }
    }

    private MicBridgeCapability started(CoreRuntime core, int port, NoOverlay overlay) throws Exception {
        MicBridgeCapability mic = new MicBridgeCapability();
        core.add(mic);
        core.prepare(new JSONObject());
        core.settings().set("mic.port", port);
        mic.useOverlayForTest(overlay);
        mic.startStream(null);
        return mic;
    }

    @Test public void twoOverlappingRestartsLeaveOneListeningServerThatStopReleases() throws Exception {
        final CoreRuntime core = TestCore.create(tmp.newFolder());
        final int port = freePort();
        NoOverlay overlay = new NoOverlay();
        MicBridgeCapability mic = started(core, port, overlay);
        assertTrue(TestCore.get(core, "/mic/status").getBoolean("running"));

        final java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        final JSONObject[] answers = new JSONObject[2];
        Thread[] callers = new Thread[2];
        for (int i = 0; i < 2; i++) {
            final int n = i;
            callers[i] = new Thread(() -> {
                try { go.await(); answers[n] = TestCore.post(core, "/mic/restart"); } catch (Exception ignored) { }
            });
            callers[i].start();
        }
        go.countDown();
        for (Thread t : callers) t.join(10_000);

        assertEquals(2, overlay.rebuilds.get());
        for (JSONObject a : answers) {
            assertNotNull(a);
            assertTrue("each restart ends with a listening stream: " + a, a.getBoolean("ok"));
        }
        JSONObject after = TestCore.get(core, "/mic/status");
        assertTrue("the server the capability holds is the one listening", after.getBoolean("running"));
        assertTrue(after.isNull("lastError"));
        assertFalse(portIsFree(port));

        mic.stop();
        long deadline = System.currentTimeMillis() + 3000;
        while (!portIsFree(port) && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertTrue("no orphaned server keeps the port after stop", portIsFree(port));
        mic.stop();
    }

    @Test public void aCaptureDenialSurvivesARestartUnderAStableCode() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MicBridgeCapability mic = started(core, freePort(), new NoOverlay());
        try {
            mic.captureForTest().failed(CaptureState.CAPTURE_DENIED, "AudioRecord failed to initialize");
            JSONObject before = TestCore.get(core, "/mic/status");
            assertEquals("capture_denied", before.getString("lastError"));
            assertEquals("AudioRecord failed to initialize", before.getString("lastErrorDetail"));
            assertTrue(before.getBoolean("heldByOther"));

            JSONObject restarted = TestCore.post(core, "/mic/restart");
            assertTrue("the socket is listening again", restarted.getBoolean("running"));
            assertEquals("a restart does not show that capture works", "capture_denied", restarted.getString("lastError"));
            assertTrue(restarted.getBoolean("heldByOther"));

            mic.captureForTest().recording();
            JSONObject cured = TestCore.get(core, "/mic/status");
            assertTrue(cured.isNull("lastError"));
            assertFalse(cured.getBoolean("heldByOther"));
        } finally {
            mic.stop();
        }
    }

    @Test public void aPortThatIsTakenIsReportedAsBindFailed() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        try (java.net.ServerSocket taken = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            MicBridgeCapability mic = started(core, taken.getLocalPort(), new NoOverlay());
            JSONObject s = TestCore.get(core, "/mic/status");
            assertFalse(s.getBoolean("running"));
            assertEquals("bind_failed", s.getString("lastError"));
            assertFalse(s.getBoolean("heldByOther"));
            mic.stop();
        }
    }
}
