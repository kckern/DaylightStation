package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.spi.NoteListener;
import net.kckern.daylight.core.spi.OutputGate;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

public class CoreRegistriesTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void aServiceIsFoundByItsInterfaceAndAbsentOtherwise() {
        ServiceRegistry services = new ServiceRegistry();
        assertNull(services.find(OutputGate.class));
        OutputGate gate = open -> { };
        services.provide(OutputGate.class, gate);
        assertSame(gate, services.find(OutputGate.class));
        assertEquals(1, services.all(OutputGate.class).size());
        services.withdraw(OutputGate.class, gate);
        assertNull(services.find(OutputGate.class));
    }

    @Test public void aComponentWatcherHearsThePresentInstanceAndLaterChanges() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        Object engine = new Object();
        ((FakeShell) core.shell()).components.put("engine", engine);
        List<Object> heard = new ArrayList<>();
        core.components().watch("engine", heard::add);
        assertSame("a hot-swapped payload must adopt a component that is already bound", engine, heard.get(0));
        core.onShellComponent("engine", null);
        core.onShellComponent("other", new Object());
        assertEquals(2, heard.size());
        assertNull(heard.get(1));
    }

    @Test public void statusContributionsMergeAtTheTopLevel() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.status().add(StatusBoard.Surface.STATUS, "midi-bridge", o -> o.put("ble", "CONNECTED"));
        core.start(new JSONObject("{}"));
        assertEquals("CONNECTED", TestCore.get(core, "/status").getString("ble"));
    }

    @Test public void aFailingContributorIsReportedAndDoesNotHideTheOthers() throws Exception {
        StatusBoard board = new StatusBoard();
        board.add(StatusBoard.Surface.HEARTBEAT, "bad", o -> { throw new IllegalStateException("no radio"); });
        board.add(StatusBoard.Surface.HEARTBEAT, "good", o -> o.put("speaker", true));
        JSONObject o = board.collect(StatusBoard.Surface.HEARTBEAT, new JSONObject());
        assertTrue(o.getBoolean("speaker"));
        assertEquals("no radio", o.getJSONObject("_errors").getString("bad"));
    }

    @Test public void diagnosticsContributionsGetASectionPerOwner() throws Exception {
        StatusBoard board = new StatusBoard();
        board.add(StatusBoard.Surface.DIAGNOSTICS, "audio-guard", o -> o.put("guard", "ok"));
        JSONObject o = board.collect(StatusBoard.Surface.DIAGNOSTICS, new JSONObject());
        assertEquals("ok", o.getJSONObject("audio-guard").getString("guard"));
        assertFalse(board.has(StatusBoard.Surface.FRAME));
    }

    @Test public void notesReachSubscribersInOrderAndOneFailureDoesNotStopTheRest() {
        NoteBus bus = new NoteBus();
        List<String> heard = new ArrayList<>();
        bus.subscribe(new NoteListener() {
            @Override public void noteOn(int note, int velocity, long epochMs) { throw new IllegalStateException(); }
        });
        bus.subscribe(new NoteListener() {
            @Override public void noteOn(int note, int velocity, long epochMs) { heard.add("on " + note + " " + velocity); }
            @Override public void noteOff(int note, long epochMs) { heard.add("off " + note); }
            @Override public void controlChange(int controller, int value) { heard.add("cc " + controller + " " + value); }
        });
        bus.noteOn(60, 100, 1L);
        bus.noteOff(60, 2L);
        bus.controlChange(64, 127);
        assertEquals(java.util.Arrays.asList("on 60 100", "off 60", "cc 64 127"), heard);
    }

    @Test public void prepareRegistersAndAppliesDefaultsWithoutStarting() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        List<String> events = new ArrayList<>();
        core.add(new Capability() {
            @Override public String name() { return "sample"; }
            @Override public void register(CoreContext c) { c.settings().declare("sample.level", SettingsRegistry.Type.INTEGER, 1); events.add("register"); }
            @Override public void start() { events.add("start"); }
            @Override public void stop() { }
        });
        core.prepare(new JSONObject("{\"sample.level\":4}"));
        assertEquals(java.util.Arrays.asList("register"), events);
        assertEquals(4, core.settings().get("sample.level"));
    }

    @Test public void logCrashlogAndDiagnosticsAnswerWithoutAnAndroidContext() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.log().add("hello");
        core.start(new JSONObject("{}"));
        JSONObject log = TestCore.get(core, "/log");
        assertTrue(log.getBoolean("ok"));
        assertTrue(log.getJSONArray("events").getString(0).endsWith(" hello"));
        assertEquals("not_ready", TestCore.get(core, "/diagnostics").getString("error"));
    }

    @Test public void payloadRoutesForwardToTheShell() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.start(new JSONObject("{}"));
        assertEquals("test.jar", TestCore.get(core, "/payload").getString("current"));
        java.util.Map<String, String> q = new java.util.HashMap<>();
        q.put("url", "http://example/p.jar");
        JSONObject noSha = TestCore.call(core, "POST", "/payload", q, null);
        assertEquals("missing sha256", noSha.getString("error"));
        assertEquals("an incomplete request is a 400", 400, noSha.getInt("_status"));
        assertEquals(400, TestCore.post(core, "/payload").getInt("_status"));
        q.put("sha256", "abc");
        assertEquals("queued", TestCore.call(core, "POST", "/payload", q, null).getString("result"));
        assertEquals("queued", TestCore.post(core, "/payload/rollback").getString("result"));
        assertEquals("queued", TestCore.call(core, "POST", "/payload", null,
                "{\"url\":\"http://example/p.jar\",\"sha256\":\"abc\"}").getString("result"));
        assertEquals("missing url", TestCore.post(core, "/update").getString("error"));
        assertEquals("not_ready", TestCore.call(core, "POST", "/update", null, "{\"url\":\"http://example/a.apk\"}").getString("error"));
        JSONObject state = TestCore.get(core, "/update");
        assertEquals("idle", state.getString("state"));
        assertTrue(state.isNull("lastError"));
    }

    @Test public void aSwapOrRollbackTheShellRefusesIsNotReportedAsOk() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        ((FakeShell) core.shell()).swapResult = "refused: sha256 must be 64 hex characters";
        ((FakeShell) core.shell()).rollbackResult = "refused: no previous payload";
        core.start(new JSONObject("{}"));
        JSONObject swap = TestCore.call(core, "POST", "/payload", null, "{\"url\":\"http://example/p.jar\",\"sha256\":\"abc\"}");
        assertEquals(409, swap.getInt("_status"));
        assertFalse(swap.getBoolean("ok"));
        assertEquals("refused: sha256 must be 64 hex characters", swap.getString("result"));
        JSONObject back = TestCore.post(core, "/payload/rollback");
        assertEquals(409, back.getInt("_status"));
        assertEquals("refused: no previous payload", back.getString("error"));
    }
}
