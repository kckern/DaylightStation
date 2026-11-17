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
}
