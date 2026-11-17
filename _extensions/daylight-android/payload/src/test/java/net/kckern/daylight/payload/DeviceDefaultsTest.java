package net.kckern.daylight.payload;

import static org.junit.Assert.*;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;
import net.kckern.daylight.generated.DeviceConfig;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class DeviceDefaultsTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /**
     * Registers this device's capabilities and applies its defaults, as the payload does
     * on start. Fails on a default for an undeclared setting, a default of the wrong type,
     * a default for a secret, a route two capabilities both register, a WebSocket message
     * type two capabilities both claim, and an entry class that cannot be constructed.
     */
    @Test public void thisDevicesCapabilitiesRegisterAndItsDefaultsApply() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
            core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        }
        core.prepare(new JSONObject(DeviceConfig.DEFAULTS_JSON));

        JSONObject status = TestCore.get(core, "/capabilities");
        assertEquals(DeviceConfig.CAPABILITY_ENTRIES.length, status.getJSONArray("capabilities").length());
        JSONArray settings = TestCore.get(core, "/settings").getJSONArray("settings");
        for (int i = 0; i < settings.length(); i++) {
            String value = String.valueOf(settings.getJSONObject(i).get("value"));
            assertFalse("unresolved placeholder in " + settings.getJSONObject(i).getString("key"), value.matches(".*\\{[a-z_]+\\}.*"));
        }
    }

    /** Every default in the device file names a setting, so each is listed with the compiled value in effect. */
    @Test public void everyCompiledDefaultIsTheValueInEffect() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
            core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        }
        JSONObject defaults = new JSONObject(DeviceConfig.DEFAULTS_JSON);
        core.prepare(defaults);
        for (java.util.Iterator<String> it = defaults.keys(); it.hasNext(); ) {
            String key = it.next();
            // The key only: a default can be a resolved private value, and a failure
            // message that printed both sides would put it in the build log.
            assertTrue("the compiled default is not the value in effect for " + key,
                    String.valueOf(defaults.get(key)).equals(String.valueOf(core.settings().get(key))));
        }
        // Decided for every device: heartbeats on, and a log store to send them to.
        assertEquals(Boolean.TRUE, core.settings().get("heartbeat.enabled"));
        assertFalse("heartbeat.logStoreUrl is empty", ((String) core.settings().get("heartbeat.logStoreUrl")).isEmpty());
    }

    /**
     * A page gets getUserMedia only in a secure context, and the household site is served
     * over https. A start URL is empty (not configured) or https; plain http would load
     * and then leave the page without a microphone or camera.
     */
    @Test public void aConfiguredStartUrlIsHttps() throws Exception {
        JSONObject defaults = new JSONObject(DeviceConfig.DEFAULTS_JSON);
        if (!java.util.Arrays.asList(DeviceConfig.CAPABILITY_ENTRIES)
                .contains("net.kckern.daylight.cap.webviewhost.WebViewHostCapability")) {
            assertFalse("a start URL with no kiosk to show it", defaults.has("webview.startUrl"));
            return;
        }
        assertTrue("a kiosk device says what its start URL is, even when that is empty", defaults.has("webview.startUrl"));
        String start = defaults.getString("webview.startUrl");
        assertTrue("webview.startUrl must be empty or https", start.isEmpty() || start.startsWith("https://"));
    }
}
