package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.testing.FakeShell;

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
        JSONArray rows = list.getJSONArray("settings");
        boolean found = false;
        for (int i = 0; i < rows.length(); i++) if ("sample.level".equals(rows.getJSONObject(i).getString("key"))) found = true;
        assertTrue(found);

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
        // What it took before it threw must be given back: stop() is called on it as well.
        assertEquals(java.util.Arrays.asList("register", "stop"), events);
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
        // The capability that threw is stopped first (it may hold what it took before
        // it threw), then the ones that had started.
        assertEquals(java.util.Arrays.asList("register", "start", "broken-stop", "stop"), events);
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

    @Test public void settingOrResettingASecretNeverEchoesItsValue() throws Exception {
        Capability withSecret = new Capability() {
            @Override public String name() { return "vault"; }
            @Override public void register(CoreContext core) { core.settings().declareSecret("vault.key"); }
            @Override public void start() { }
            @Override public void stop() { }
        };
        CoreRuntime core = runtime(withSecret, "{}");
        Router.Response set = core.router().dispatch("POST", "/settings", FakeShell.TOKEN, Collections.emptyMap(),
                "{\"key\":\"vault.key\",\"value\":\"hunter2-hunter2\"}");
        String text = new String(set.body, StandardCharsets.UTF_8);
        assertEquals(200, set.status);
        assertFalse("the response must not hold the secret", text.contains("hunter2"));
        assertEquals("(set)", new JSONObject(text).getString("value"));
        assertEquals("hunter2-hunter2", core.settings().get("vault.key"));

        Router.Response reset = core.router().dispatch("DELETE", "/settings", FakeShell.TOKEN,
                Collections.singletonMap("key", "vault.key"), null);
        assertEquals("", new JSONObject(new String(reset.body, StandardCharsets.UTF_8)).getString("value"));
    }

    // ── a start() the loader gave up on ─────────────────────────────────────

    /** Records its start and stop, and can hold start() open until released. */
    private final class Tracked implements Capability {
        final String id;
        final java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        final java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        final boolean blocks;
        Tracked(String id, boolean blocks) { this.id = id; this.blocks = blocks; }
        @Override public String name() { return id; }
        @Override public void register(CoreContext core) { }
        @Override public void start() {
            synchronized (events) { events.add("start " + id); }
            entered.countDown();
            if (!blocks) return;
            boolean waiting = true;
            while (waiting) {
                try { release.await(); waiting = false; } catch (InterruptedException stillStuck) { }
            }
        }
        @Override public void stop() { synchronized (events) { events.add("stop " + id); } }
    }

    @Test public void aStopDuringAStalledStartStopsThatCapabilityAndStartsNoLaterOne() throws Exception {
        final CoreRuntime core = new CoreRuntime(shell, "test", "p-test", new java.io.File(shell.dir, "state"));
        Tracked first = new Tracked("first", false), stalled = new Tracked("stalled", true), later = new Tracked("later", false);
        core.add(first);
        core.add(stalled);
        core.add(later);
        final Throwable[] thrown = { null };
        Thread starter = new Thread(() -> {
            try { core.start(new JSONObject()); } catch (Throwable t) { thrown[0] = t; }
        });
        starter.start();
        assertTrue(stalled.entered.await(5, java.util.concurrent.TimeUnit.SECONDS));

        core.stop();                       // what the loader's stopper does after the deadline
        synchronized (events) { assertEquals(java.util.Arrays.asList("start first", "start stalled", "stop first"), events); }

        stalled.release.countDown();       // the stuck start() finally returns
        starter.join(5000);
        assertFalse(starter.isAlive());
        synchronized (events) {
            assertEquals(java.util.Arrays.asList("start first", "start stalled", "stop first", "stop stalled"), events);
        }
        assertTrue(String.valueOf(thrown[0]), thrown[0] instanceof IllegalStateException);
        assertTrue(thrown[0].getMessage(), thrown[0].getMessage().contains("stopped"));
        core.stop();                       // twice is safe and stops nothing again
        synchronized (events) { assertEquals(4, events.size()); }
    }

    @Test public void aRuntimeStoppedBeforeItStartsStartsNothing() throws Exception {
        CoreRuntime core = new CoreRuntime(shell, "test", "p-test", new java.io.File(shell.dir, "state"));
        Tracked only = new Tracked("only", false);
        core.add(only);
        core.stop();
        try {
            core.start(new JSONObject());
            fail("a stopped runtime started");
        } catch (IllegalStateException expected) { }
        assertEquals(1, only.entered.getCount());
    }

    @Test public void theOverridesFileIsWhereTheShellLooksForIt() throws Exception {
        CoreRuntime core = runtime(new Sample(false), "{}");
        core.settings().set("sample.level", 3);
        assertTrue(net.kckern.daylight.api.PayloadState.settingsOverrides(shell.dir).isFile());
    }

    @Test public void theControlAndLifelinePortsAreReserved() throws Exception {
        CoreRuntime core = new CoreRuntime(shell, "test", "p-test", new java.io.File(shell.dir, "state"));
        assertFalse(core.portReserved(8780));
        core.reservePorts(8780, 8781);
        assertTrue(core.portReserved(8780));
        assertTrue(core.portReserved(8781));
        assertFalse(core.portReserved(8782));
    }

    @Test public void statusSaysWhenTheStoredSettingsCouldNotBeReadAsWritten() throws Exception {
        java.io.File state = new java.io.File(shell.dir, "state");
        assertTrue(state.mkdirs());
        java.nio.file.Files.write(net.kckern.daylight.api.PayloadState.settingsOverridesIn(state).toPath(), "{torn".getBytes("UTF-8"));
        CoreRuntime core = runtime(new Sample(false), "{}");
        JSONObject status = call(core, "GET", "/status", java.util.Collections.emptyMap(), null);
        assertTrue(status.getString("settingsProblem"), status.getString("settingsProblem").contains("unreadable"));
        assertTrue("and the shell log has the line", shell.notes.toString().contains("SETTINGS "));
        core.stop();

        FakeShell clean = new FakeShell(tmp.newFolder());
        CoreRuntime healthy = new CoreRuntime(clean, "test", "p-test", new java.io.File(clean.dir, "state"));
        healthy.start(new JSONObject("{}"));
        assertTrue(call(healthy, "GET", "/status", java.util.Collections.emptyMap(), null).isNull("settingsProblem"));
        healthy.stop();
    }
}
