package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import net.kckern.daylight.api.ShellServices;
import net.kckern.daylight.core.Auth;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class DebugToolsCapabilityTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void registersTheInfoRouteAndItsSetting() throws Exception {
        Router router = new Router(new Auth(TOKEN));
        SettingsRegistry settings = new SettingsRegistry(new File(tmp.newFolder(), "o.json"));
        CoreContext core = new CoreContext() {
            @Override public ShellServices shell() { return null; }
            @Override public Router router() { return router; }
            @Override public SettingsRegistry settings() { return settings; }
            @Override public String deviceId() { return "test"; }
        };

        DebugToolsCapability cap = new DebugToolsCapability();
        assertEquals("debug-tools", cap.name());
        cap.register(core);

        assertEquals(Boolean.FALSE, settings.get("debug.execEnabled"));
        Router.Response r = router.dispatch("GET", "/debug/info", TOKEN, Collections.emptyMap(), null);
        assertEquals(200, r.status);
        JSONObject o = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
        assertTrue(o.getBoolean("ok"));
        assertEquals("test", o.getString("device"));
        assertTrue(o.has("sdkInt"));
    }
}
