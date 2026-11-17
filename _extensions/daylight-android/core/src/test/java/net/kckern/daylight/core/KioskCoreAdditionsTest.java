package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** What phase 3 added to the core for the kiosk capabilities. */
public class KioskCoreAdditionsTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    interface Greeter { String hello(); }

    private static final class Named implements Capability {
        private final String name;
        Named(String name) { this.name = name; }
        @Override public String name() { return name; }
        @Override public void register(CoreContext core) { }
        @Override public void start() { }
        @Override public void stop() { }
    }

    @Test public void requireNamesTheMissingCapabilityAsUnsupported() {
        ServiceRegistry r = new ServiceRegistry();
        try {
            r.require(Greeter.class, "greeter");
            fail("expected UnsupportedException");
        } catch (UnsupportedException e) {
            assertEquals("capability 'greeter' is not in this build", e.getMessage());
        }
        r.provide(Greeter.class, () -> "hi");
        assertEquals("hi", r.require(Greeter.class, "greeter").hello());
    }

    @Test public void theCoreNamesItsCapabilitiesItsPayloadVersionAndOffersTheEventBus() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.add(new Named("one"));
        core.add(new Named("two"));
        assertEquals(java.util.Arrays.asList("one", "two"), core.capabilityNames());
        assertEquals("p-test", core.payloadVersion());
        assertNotNull(core.events());
        assertSame(core.events(), core.events());
    }

    @Test public void statusCarriesAppVersionWhichIsNullOnlyWithoutAnAndroidContext() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject());
        JSONObject s = TestCore.get(core, "/status");
        assertTrue("appVersion is always present", s.has("appVersion"));
        assertTrue(s.isNull("appVersion"));
    }

    private static Router.Request request(String body, Map<String, String> query) {
        return new Router.Request("POST", "/x", query, body, null);
    }

    @Test public void aBodyIsAJsonObjectAndAnEmptyOneIsAnEmptyObject() {
        assertEquals(0, Json.body(request(null, Collections.emptyMap())).length());
        assertEquals(0, Json.body(request("  ", Collections.emptyMap())).length());
        assertEquals("b", Json.body(request("{\"a\":\"b\"}", Collections.emptyMap())).optString("a"));
        for (String bad : new String[] { "not json", "[1,2]", "7" }) {
            try { Json.body(request(bad, Collections.emptyMap())); fail("expected a bad request for " + bad); }
            catch (IllegalArgumentException expected) { assertEquals("body must be a JSON object", expected.getMessage()); }
        }
    }

    @Test public void anIntegerQueryIsClampedAndANonNumberIsABadRequest() {
        Map<String, String> q = new HashMap<>();
        assertEquals(1000, Json.intQuery(request(null, q), "ms", 1000, 100, 10_000));
        q.put("ms", "50");
        assertEquals(100, Json.intQuery(request(null, q), "ms", 1000, 100, 10_000));
        q.put("ms", "99999");
        assertEquals(10_000, Json.intQuery(request(null, q), "ms", 1000, 100, 10_000));
        q.put("ms", "soon");
        try { Json.intQuery(request(null, q), "ms", 1000, 100, 10_000); fail("expected a bad request"); }
        catch (IllegalArgumentException expected) { assertEquals("query 'ms' must be an integer", expected.getMessage()); }
    }

    @Test public void theFakeShellRecordsARestartRequest() throws Exception {
        FakeShell shell = new FakeShell(tmp.newFolder());
        assertEquals("accepted: restarting test.jar", shell.requestPayloadRestart());
        assertEquals(1, shell.restarts.size());
    }
}
