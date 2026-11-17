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
}
