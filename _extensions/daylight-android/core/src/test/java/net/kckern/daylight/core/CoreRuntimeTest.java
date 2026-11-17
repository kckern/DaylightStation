package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.SettingsRegistry.Type;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class CoreRuntimeTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private FakeShell shell;
    private final List<String> events = new ArrayList<>();

    private final class Sample implements Capability {
        private final boolean failOnStart;
        Sample(boolean failOnStart) { this.failOnStart = failOnStart; }
        @Override public String name() { return "sample"; }
        @Override public void register(CoreContext core) {
            core.settings().declare("sample.level", Type.INTEGER, 1);
            core.router().route("GET", "/sample", req -> Router.Response.json(200, new JSONObject().put("hello", true)));
            events.add("register");
        }
        @Override public void start() { if (failOnStart) throw new IllegalStateException("no hardware"); events.add("start"); }
        @Override public void stop() { events.add("stop"); }
    }

    @Before public void setUp() throws Exception { shell = new FakeShell(tmp.newFolder()); }

    private CoreRuntime runtime(Capability c, String defaults) throws Exception {
        CoreRuntime core = new CoreRuntime(shell, "test", "p-test", new java.io.File(shell.dir, "state"));
        core.add(c);
        core.start(new JSONObject(defaults));
        return core;
    }

    private static JSONObject call(CoreRuntime core, String method, String path, Map<String, String> query, String body) throws Exception {
        Router.Response r = core.router().dispatch(method, path, FakeShell.TOKEN, query, body);
        JSONObject o = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
        o.put("_status", r.status);
        return o;
    }

    @Test public void registersThenAppliesDefaultsThenStarts() throws Exception {
        CoreRuntime core = runtime(new Sample(false), "{\"sample.level\":4}");
        assertEquals(java.util.Arrays.asList("register", "start"), events);
        assertEquals(4, core.settings().get("sample.level"));
    }

    @Test public void statusNamesTheDevicePayloadShellAndCapabilities() throws Exception {
        JSONObject s = call(runtime(new Sample(false), "{}"), "GET", "/status", Collections.emptyMap(), null);
        assertEquals(200, s.getInt("_status"));
        assertEquals("test", s.getString("device"));
        assertEquals("p-test", s.getString("payloadVersion"));
        assertEquals(7, s.getInt("shellVersionCode"));
        assertEquals("sample", s.getJSONArray("capabilities").getString(0));
    }

    @Test public void capabilitiesRouteListsRoutes() throws Exception {
        JSONObject c = call(runtime(new Sample(false), "{}"), "GET", "/capabilities", Collections.emptyMap(), null);
        JSONArray routes = c.getJSONArray("routes");
        boolean found = false;
        for (int i = 0; i < routes.length(); i++) if ("GET /sample".equals(routes.getString(i))) found = true;
        assertTrue(found);
    }

    @Test public void settingsCanBeListedSetAndReset() throws Exception {
        CoreRuntime core = runtime(new Sample(false), "{}");
        JSONObject set = call(core, "POST", "/settings", Collections.emptyMap(), "{\"key\":\"sample.level\",\"value\":9}");
        assertEquals(200, set.getInt("_status"));
        assertEquals(9, set.getInt("value"));
        assertEquals(9, core.settings().get("sample.level"));

        JSONObject list = call(core, "GET", "/settings", Collections.emptyMap(), null);
        assertEquals("sample.level", list.getJSONArray("settings").getJSONObject(0).getString("key"));

        JSONObject reset = call(core, "DELETE", "/settings", Collections.singletonMap("key", "sample.level"), null);
        assertEquals(200, reset.getInt("_status"));
        assertEquals(1, core.settings().get("sample.level"));
    }

    @Test public void anUnknownSettingKeyIsAnError() throws Exception {
        JSONObject r = call(runtime(new Sample(false), "{}"), "POST", "/settings", Collections.emptyMap(),
                "{\"key\":\"setCpuWakelock\",\"value\":true}");
        assertEquals(404, r.getInt("_status"));
        assertEquals("unknown_setting", r.getString("error"));
    }

    @Test public void aBodyWithoutAKeyIsABadRequest() throws Exception {
        JSONObject r = call(runtime(new Sample(false), "{}"), "POST", "/settings", Collections.emptyMap(), "{}");
        assertEquals(400, r.getInt("_status"));
    }

    @Test public void aCapabilityThatCannotStartFailsTheWholePayload() throws Exception {
        try {
            runtime(new Sample(true), "{}");
            fail("expected start to throw so the shell rolls back");
        } catch (IllegalStateException e) {
            assertTrue(e.getMessage().contains("sample"));
        }
    }

    @Test public void aDefaultForAnUndeclaredSettingFailsTheWholePayload() throws Exception {
        try {
            runtime(new Sample(false), "{\"sample.typo\":1}");
            fail("expected start to throw");
        } catch (SettingsRegistry.UnknownSettingException expected) { }
    }

    @Test public void stopStopsCapabilitiesInReverseOrder() throws Exception {
        CoreRuntime core = runtime(new Sample(false), "{}");
        core.stop();
        assertEquals("stop", events.get(events.size() - 1));
    }

    @Test public void aLinkageErrorOnStartStopsTheStartedCapabilitiesAndFailsThePayload() throws Exception {
        Capability broken = new Capability() {
            @Override public String name() { return "broken"; }
            @Override public void register(CoreContext core) { }
            @Override public void start() { throw new NoClassDefFoundError("gone/Missing"); }
            @Override public void stop() { events.add("broken-stop"); }
        };
        CoreRuntime core = new CoreRuntime(shell, "test", "p-test", new java.io.File(shell.dir, "state"));
        core.add(new Sample(false));
        core.add(broken);
        try {
            core.start(new JSONObject("{}"));
            fail("expected start to throw so the shell rolls back");
        } catch (IllegalStateException e) {
            assertTrue(e.getMessage().contains("capability 'broken' cannot start"));
        }
        assertEquals(java.util.Arrays.asList("register", "start", "stop"), events);
    }

    @Test public void statusStillAnswersWhenTheShellPayloadStatusIsNotJson() throws Exception {
        shell.payloadStatus = "not json";
        JSONObject s = call(runtime(new Sample(false), "{}"), "GET", "/status", Collections.emptyMap(), null);
        assertEquals(200, s.getInt("_status"));
        assertTrue(s.has("payload"));
        assertTrue(s.isNull("payload"));
    }

    @Test public void aSettingsKeyThatIsNotAStringIsABadRequest() throws Exception {
        JSONObject r = call(runtime(new Sample(false), "{}"), "POST", "/settings", Collections.emptyMap(),
                "{\"key\":5,\"value\":9}");
        assertEquals(400, r.getInt("_status"));
        assertEquals("bad_request", r.getString("error"));
    }
}
