package net.kckern.daylight.cap.presence;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PresenceCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void theTokenIsASecretAndAHeartbeatOutsideTheRangeIsRefused() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.add(new PresenceCapability());
        core.prepare(new JSONObject());
        core.settings().set("presence.token", "tok-1234567890");
        JSONObject listed = TestCore.get(core, "/settings");
        assertFalse("the token never leaves the device", listed.toString().contains("tok-1234567890"));

        PresenceConfig config = new PresenceConfig(core.settings());
        assertEquals("tok-1234567890", config.gateToken());
        for (int bad : new int[] { 10, 4999, 600001, 99999999 }) {
            JSONObject refused = TestCore.call(core, "POST", "/settings", null, "{\"key\":\"presence.heartbeatMs\",\"value\":" + bad + "}");
            assertEquals(400, refused.getInt("_status"));
            assertEquals("invalid_setting", refused.getString("error"));
        }
        assertEquals(60000, config.gateHeartbeatMs());
        core.settings().set("presence.heartbeatMs", 5000);
        assertEquals(5000, config.gateHeartbeatMs());
        assertEquals("not started", TestCore.get(core, "/presence").getString("error"));
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        PresenceCapability presence = new PresenceCapability();
        presence.register(core);
        presence.start();
        assertEquals("not started", TestCore.get(core, "/presence").getString("error"));
        presence.stop();
        presence.stop();
    }

    @Test public void theReportCarriesTheAppVersionItWasGivenAndTheHeartbeatInEffect() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new PresenceCapability().register(core);
        core.settings().set("presence.heartbeatMs", 5000);
        PresenceReporter reporter = new PresenceReporter(null, new PresenceConfig(core.settings()), core.log(), "0.2-test");
        // No Bluetooth adapter in a JVM test: the report says so and lists no devices.
        JSONObject payload = new JSONObject(reporter.buildPayload());
        assertEquals("0.2-test", payload.getString("version"));
        assertEquals(5000, payload.getInt("heartbeatMs"));
        assertFalse(payload.getBoolean("btEnabled"));
        assertEquals(0, payload.getJSONArray("devices").length());
        assertEquals(1, payload.getInt("seq"));
    }

    @Test public void anEmptyEndpointIsNotConfiguredAndTheRouteSaysSo() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new PresenceCapability().register(core);
        assertEquals("", new PresenceConfig(core.settings()).gateEndpoint());
        PresenceReporter reporter = new PresenceReporter(null, new PresenceConfig(core.settings()), core.log(), "0.2-test");
        JSONObject before = new JSONObject(reporter.toJson());
        assertEquals("never-sent", before.getString("lastResult"));
        assertEquals("", before.getString("endpoint"));
        assertTrue(before.isNull("last"));
    }

    // ── the send path, against a local server ───────────────────────────────

    @Test(timeout = 20000) public void aReportCarriesTheTokenInItsHeaderAndNowhereElse() throws Exception {
        final String token = "tok-0123456789abcdef-presence";
        final java.util.concurrent.CountDownLatch received = new java.util.concurrent.CountDownLatch(1);
        final String[] seen = new String[3];
        fi.iki.elonen.NanoHTTPD server = new fi.iki.elonen.NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession session) {
                try {
                    java.util.Map<String, String> files = new java.util.HashMap<>();
                    session.parseBody(files);
                    seen[0] = session.getHeaders().get("x-presence-token");
                    seen[1] = files.get("postData");
                    seen[2] = session.getMethod().name() + " " + session.getUri();
                } catch (Exception e) {
                    seen[1] = "unreadable: " + e;
                }
                received.countDown();
                return newFixedLengthResponse(Response.Status.OK, "application/json", "{}");
            }
        };
        server.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, true);
        try {
            CoreRuntime core = TestCore.create(tmp.newFolder());
            core.add(new PresenceCapability());
            core.prepare(new JSONObject());
            core.settings().set("presence.endpoint", "http://127.0.0.1:" + server.getListeningPort() + "/presence/report");
            core.settings().set("presence.token", token);
            PresenceReporter reporter = new PresenceReporter(null, new PresenceConfig(core.settings()), core.log(), "0.2-test");

            reporter.report();
            assertTrue("the report reached the endpoint", received.await(10, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("POST /presence/report", seen[2]);
            assertEquals("the token travels in the header", token, seen[0]);
            JSONObject body = new JSONObject(seen[1]);
            assertEquals("0.2-test", body.getString("version"));
            assertFalse("and not in the body", seen[1].contains(token));

            long deadline = System.currentTimeMillis() + 5000;
            while (!reporter.toJson().contains("http 200") && System.currentTimeMillis() < deadline) Thread.sleep(20);
            String state = reporter.toJson();
            assertTrue(state, state.contains("\"lastResult\":\"http 200\""));
            assertFalse("not in what GET /presence shows", state.contains(token));
            assertFalse("not in the event log", core.log().toJsonArray().contains(token));
            assertFalse("not in the diagnostic log", net.kckern.daylight.core.Diag.recent().toString().contains(token));
            assertFalse("not in GET /settings", TestCore.get(core, "/settings").toString().contains(token));
        } finally {
            server.stop();
        }
    }

    @Test(timeout = 20000) public void aReportWithNoTokenSendsNoTokenHeaderAndAFailedOneSaysWhy() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.add(new PresenceCapability());
        core.prepare(new JSONObject());
        java.net.ServerSocket closed = new java.net.ServerSocket(0);
        int port = closed.getLocalPort();
        closed.close();                                    // nothing listens here
        core.settings().set("presence.endpoint", "http://127.0.0.1:" + port + "/presence/report");
        PresenceReporter reporter = new PresenceReporter(null, new PresenceConfig(core.settings()), core.log(), "0.2-test");
        reporter.report();
        long deadline = System.currentTimeMillis() + 10000;
        while (reporter.toJson().contains("never-sent") && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertTrue(reporter.toJson(), reporter.toJson().contains("\"lastResult\":\"error "));
    }

    // ── a real start, over a fake Android context ───────────────────────────

    /**
     * The JVM has no Bluetooth adapter, so a real start stops where a device without
     * Bluetooth would: it says so and takes nothing. With an adapter the reporter
     * registers a receiver and profile proxies; that part is on the on-device list.
     */
    @Test public void aRealStartWithNoBluetoothAdapterTakesNothingAndStopLeavesNothing() throws Exception {
        java.io.File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        CoreRuntime core = TestCore.createWithContext(dir, ctx);
        try {
            PresenceCapability presence = new PresenceCapability();
            core.add(presence);
            core.prepare(new JSONObject());
            presence.start();
            assertTrue("the reporter exists", TestCore.get(core, "/presence").getBoolean("ok"));
            assertTrue(core.log().toJsonArray().contains("presence-no-bluetooth-adapter"));
            assertTrue(ctx.receivers.isEmpty());
            presence.stop();
            assertEquals("not started", TestCore.get(core, "/presence").getString("error"));
            assertTrue(ctx.receivers.isEmpty());
            presence.stop();
        } finally {
            TestCore.releaseMainThread();
        }
    }

    // ── presence.enabled: installed beside portal-keys, which reports presence ─

    @Test public void withTheSwitchOffNoReporterRunsUntilItIsTurnedOn() throws Exception {
        java.io.File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        CoreRuntime core = TestCore.createWithContext(dir, ctx);
        try {
            PresenceCapability presence = new PresenceCapability();
            core.add(presence);
            core.prepare(new JSONObject("{\"presence.enabled\":false}"));
            presence.start();
            assertEquals("not started", TestCore.get(core, "/presence").getString("error"));
            assertFalse(TestCore.get(core, "/status").getJSONObject("switches").getJSONObject("presence.enabled").getBoolean("active"));

            core.settings().set("presence.enabled", true);
            assertTrue(TestCore.get(core, "/presence").getBoolean("ok"));
            core.settings().set("presence.enabled", false);
            assertEquals("not started", TestCore.get(core, "/presence").getString("error"));
            presence.stop();
        } finally {
            TestCore.releaseMainThread();
        }
    }
}
