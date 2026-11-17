package net.kckern.daylight.cap.leasegate;

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

public class LeaseGateCapabilityTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void startsBlockedAndReportsItsLease() throws Exception {
        Router router = new Router(new Auth(TOKEN));
        SettingsRegistry settings = new SettingsRegistry(new File(tmp.newFolder(), "o.json"));
        CoreContext core = new CoreContext() {
            @Override public ShellServices shell() { return null; }
            @Override public Router router() { return router; }
            @Override public SettingsRegistry settings() { return settings; }
            @Override public String deviceId() { return "test"; }
        };
        LeaseGateCapability cap = new LeaseGateCapability();
        assertEquals("lease-gate", cap.name());
        cap.register(core);

        assertEquals("", settings.get("lease.endpoint"));
        Router.Response r = router.dispatch("GET", "/lease", TOKEN, Collections.emptyMap(), null);
        JSONObject o = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
        assertEquals(200, r.status);
        assertTrue("no lease has been granted, so the gate is closed", o.getBoolean("blocked"));
        assertFalse(o.getBoolean("configured"));
        assertEquals(-1, o.getLong("epoch"));
    }
}
