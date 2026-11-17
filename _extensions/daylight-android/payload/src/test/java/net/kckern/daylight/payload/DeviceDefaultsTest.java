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
        if (KIOSKS.contains(DeviceConfig.DEVICE_ID)) {
            // Decided for every kiosk: heartbeats on, and a log store to send them to.
            assertEquals(Boolean.TRUE, core.settings().get("heartbeat.enabled"));
            assertFalse("heartbeat.logStoreUrl is empty", ((String) core.settings().get("heartbeat.logStoreUrl")).isEmpty());
        } else {
            // Somebody's own phone is not a household device to be watched: no heartbeats,
            // and no log store to ship anything to.
            assertEquals(Boolean.FALSE, core.settings().get("heartbeat.enabled"));
            assertEquals("", core.settings().get("heartbeat.logStoreUrl"));
        }
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

    /**
     * The debug tools answer to the device token on the HTTP control API and nowhere else.
     * A socket client can send only the registered message types, so none of them may be
     * a way to run a script, run a command, read the screen or write a setting. Exec
     * starts switched off on every device.
     */
    @Test public void noSocketMessageReachesTheDebugToolsOrTheSettings() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
            core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        }
        core.prepare(new JSONObject(DeviceConfig.DEFAULTS_JSON));
        for (String type : core.socket().types()) {
            String t = type.toLowerCase(java.util.Locale.ROOT);
            for (String forbidden : new String[] { "debug", "eval", "exec", "shell", "setting", "screenshot", "html", "logcat", "unlock" }) {
                assertFalse("socket message type '" + type + "'", t.contains(forbidden));
            }
        }
        if (java.util.Arrays.asList(DeviceConfig.CAPABILITY_ENTRIES)
                .contains("net.kckern.daylight.cap.debugtools.DebugToolsCapability")) {
            assertEquals("debug.execEnabled must start false", Boolean.FALSE, core.settings().get("debug.execEnabled"));
            assertEquals(501, TestCore.call(core, "POST", "/debug/exec", null, "{\"cmd\":\"id\"}").getInt("_status"));
        }
    }

    /** The devices that replace Fully. A new kiosk is added here; every other device is held to the phone's rules. */
    private static final java.util.Set<String> KIOSKS = new java.util.HashSet<>(java.util.Arrays.asList("piano", "portal", "shield"));

    /** Each part of the old helper apps that this app can take over, behind a switch that is applied live. */
    private static final String[] COEXISTENCE_SWITCHES = { "hid.enabled", "midi.enabled", "speaker.enabled", "mic.enabled",
            "volumeKeys.enabled", "presence.enabled", "lease.enabled" };

    /**
     * A kiosk is installed beside the old helpers, so its device file says, for every
     * switch its capabilities declare, whether this app holds that hardware. A switch
     * left to its fallback (on) would claim the hardware at install.
     */
    @Test public void aKioskDeviceFileStatesEveryCoexistenceSwitchItHas() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
            core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        }
        JSONObject defaults = new JSONObject(DeviceConfig.DEFAULTS_JSON);
        core.prepare(defaults);
        if (!KIOSKS.contains(DeviceConfig.DEVICE_ID)) return;
        JSONObject switches = TestCore.get(core, "/status").getJSONObject("switches");
        int declared = 0;
        for (String key : COEXISTENCE_SWITCHES) {
            boolean has;
            try { core.settings().get(key); has = true; } catch (net.kckern.daylight.core.SettingsRegistry.UnknownSettingException e) { has = false; }
            if (!has) continue;
            declared++;
            assertTrue("devices/" + DeviceConfig.DEVICE_ID + ".yml must state " + key, defaults.has(key));
            assertTrue(key + " is reported in /status", switches.has(key));
            assertFalse("not started, so nothing is held", switches.getJSONObject(key).getBoolean("active"));
        }
        assertTrue("every kiosk has at least one helper part", declared > 0);
    }

    /** A port a capability listens on is neither the control port nor the lifeline port. */
    @Test public void noCompiledPortSettingIsTheControlOrLifelinePort() throws Exception {
        JSONObject defaults = new JSONObject(DeviceConfig.DEFAULTS_JSON);
        assertNotEquals(DeviceConfig.CONTROL_PORT, DeviceConfig.LIFELINE_PORT);
        CoreRuntime core = TestCore.create(tmp.newFolder());
        for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
            core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        }
        core.reservePorts(DeviceConfig.CONTROL_PORT, DeviceConfig.LIFELINE_PORT);
        core.prepare(defaults);
        for (java.util.Iterator<String> it = defaults.keys(); it.hasNext(); ) {
            String key = it.next();
            if (!key.endsWith(".port")) continue;
            int port = (Integer) core.settings().get(key);
            assertFalse(key + " is the control or lifeline port", core.portReserved(port));
        }
    }

    /** The control API contract's routes: the core's, and each capability's kiosk table. */
    private static final String[] CORE_ROUTES = { "GET /status", "GET /capabilities", "GET /settings", "POST /settings",
            "DELETE /settings", "GET /payload", "POST /payload", "POST /payload/rollback", "POST /update", "GET /update" };
    private static final String[][] CAPABILITY_ROUTES = {
            { "webviewhost.WebViewHostCapability", "GET /kiosk/status", "POST /kiosk/load", "POST /kiosk/load-start", "POST /kiosk/reload",
                    "POST /kiosk/foreground", "POST /kiosk/renderer/reset", "POST /kiosk/restart", "POST /kiosk/overlay" },
            { "screenpower.ScreenPowerCapability", "POST /screen", "POST /screen/brightness", "POST /device/reboot" },
            { "volume.VolumeCapability", "GET /volume", "POST /volume" },
            { "applauncher.AppLauncherCapability", "POST /launch" },
            { "lockdown.LockdownCapability", "GET /lockdown", "POST /lockdown/lock", "POST /lockdown/unlock" },
            { "debugtools.DebugToolsCapability", "GET /debug/info", "GET /debug/screenshot", "POST /debug/eval", "GET /debug/html",
                    "GET /debug/fps", "POST /debug/exec", "GET /debug/logcat", "POST /speak", "POST /sound" },
            { "micbridge.MicBridgeCapability", "GET /mic/status", "POST /mic/restart" },
    };

    /**
     * A kiosk device serves every route of the contract's kiosk tables: the backend and the
     * page are built against that list, and a device missing one would fail at its cutover.
     */
    @Test public void thisDeviceServesEveryContractRouteOfTheCapabilitiesItLists() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        java.util.List<String> entries = java.util.Arrays.asList(DeviceConfig.CAPABILITY_ENTRIES);
        for (String entry : entries) core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        core.prepare(new JSONObject(DeviceConfig.DEFAULTS_JSON));
        java.util.List<String> routes = core.router().routes();
        for (String route : CORE_ROUTES) assertTrue("missing " + route, routes.contains(route));
        for (String[] row : CAPABILITY_ROUTES) {
            if (!entries.contains("net.kckern.daylight.cap." + row[0])) continue;
            for (int i = 1; i < row.length; i++) assertTrue("missing " + row[i], routes.contains(row[i]));
        }
        boolean kiosk = KIOSKS.contains(DeviceConfig.DEVICE_ID);
        if (entries.contains("net.kckern.daylight.cap.webviewhost.WebViewHostCapability") && kiosk) {
            // A kiosk replaces Fully only with all six kiosk capabilities.
            for (String needed : new String[] { "lockdown.LockdownCapability", "screenpower.ScreenPowerCapability",
                    "volume.VolumeCapability", "applauncher.AppLauncherCapability", "debugtools.DebugToolsCapability" }) {
                assertTrue("a kiosk device must list " + needed, entries.contains("net.kckern.daylight.cap." + needed));
            }
        }
        if (!kiosk) {
            // Any other device (the phone) is somebody's own: it must never hold the screen
            // or be offered as the home app, which is what listing lockdown does, and its
            // control API must not listen on whatever network it joins.
            assertFalse("only a kiosk may list lockdown", entries.contains("net.kckern.daylight.cap.lockdown.LockdownCapability"));
            // Every app on a phone can reach its loopback address and read its APK, so a
            // device that is not a kiosk has no control API at all, and none of the
            // capabilities that exist to be driven over one.
            assertEquals("a device that is not a kiosk has no control API", "none", DeviceConfig.CONTROL_BIND);
            assertFalse(net.kckern.daylight.api.ControlBind.listens(DeviceConfig.CONTROL_BIND));
            for (String remoteOnly : new String[] { "debugtools.DebugToolsCapability", "applauncher.AppLauncherCapability" }) {
                assertFalse("a device that is not a kiosk must not list " + remoteOnly, entries.contains("net.kckern.daylight.cap." + remoteOnly));
            }
        } else {
            assertEquals("a kiosk is operated over the LAN", "lan", DeviceConfig.CONTROL_BIND);
        }
    }

    /**
     * Bookmarks, actions and the lists that place actions on surfaces are settings lines
     * that refer to each other by id. A capability leaves out what it cannot use and
     * says so at run time; for a device file that is a mistake, and it fails here.
     */
    @Test public void theCompiledBookmarksActionsAndSurfaceListsHaveNoProblems() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        java.util.List<String> entries = java.util.Arrays.asList(DeviceConfig.CAPABILITY_ENTRIES);
        for (String entry : entries) core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
        core.prepare(new JSONObject(DeviceConfig.DEFAULTS_JSON));
        String[][] lists = { { "bookmarks.BookmarksCapability", "/bookmarks" }, { "onetap.OneTapActionsCapability", "/actions" },
                { "widgets.WidgetsCapability", "/widgets" } };
        for (String[] row : lists) {
            if (!entries.contains("net.kckern.daylight.cap." + row[0])) continue;
            JSONObject answer = TestCore.get(core, row[1]);
            assertEquals(row[1], 200, answer.getInt("_status"));
            assertEquals(row[1] + " problems: " + answer.getJSONArray("problems"), 0, answer.getJSONArray("problems").length());
        }
        if (entries.contains("net.kckern.daylight.cap.onetap.OneTapActionsCapability")) {
            // An action that opens a bookmark names one that exists.
            org.json.JSONArray actions = TestCore.get(core, "/actions").getJSONArray("actions");
            for (int i = 0; i < actions.length(); i++) {
                JSONObject a = actions.getJSONObject(i);
                if (!"bookmark".equals(a.getString("kind"))) continue;
                boolean found = false;
                org.json.JSONArray bookmarks = TestCore.get(core, "/bookmarks").getJSONArray("bookmarks");
                for (int j = 0; j < bookmarks.length(); j++) found |= bookmarks.getJSONObject(j).getString("id").equals(a.getString("target"));
                assertTrue("action " + a.getString("id") + " names a bookmark that is not configured", found);
            }
        }
    }
}
