package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

public class LiveSwitchTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private final List<String> calls = new ArrayList<>();
    private boolean failAcquire;

    private final LiveSwitch.Part part = new LiveSwitch.Part() {
        @Override public void acquire() {
            calls.add("acquire");
            if (failAcquire) throw new IllegalStateException("busy");
        }
        @Override public void release() { calls.add("release"); }
    };

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject());
    }

    private JSONObject row(String key) throws Exception {
        return TestCore.get(core, "/status").getJSONObject("switches").getJSONObject(key);
    }

    @Test public void isOnUnlessADeviceFileSaysOtherwise() {
        LiveSwitch s = LiveSwitch.declare(core, "hid.enabled", part);
        assertEquals(Boolean.TRUE, core.settings().get("hid.enabled"));
        assertTrue(s.wanted());
        assertFalse("nothing is taken before start", s.held());
        assertTrue(calls.isEmpty());
    }

    @Test public void aSwitchThatIsOffAtStartTakesNothing() throws Exception {
        LiveSwitch s = LiveSwitch.declare(core, "hid.enabled", part);
        core.settings().applyDefaults(new JSONObject().put("hid.enabled", false));   // the kiosk device files
        s.start();
        assertTrue("installed beside the old helper: the hardware is left alone", calls.isEmpty());
        assertFalse(row("hid.enabled").getBoolean("setting"));
        assertFalse(row("hid.enabled").getBoolean("active"));
    }

    @Test public void turningItOnAcquiresAndOffReleasesWithoutARestart() throws Exception {
        LiveSwitch s = LiveSwitch.declare(core, "hid.enabled", part);
        core.settings().applyDefaults(new JSONObject().put("hid.enabled", false));
        s.start();

        core.settings().set("hid.enabled", true);      // the cutover
        assertEquals(java.util.Arrays.asList("acquire"), calls);
        assertTrue(s.held());
        assertTrue(row("hid.enabled").getBoolean("active"));

        core.settings().set("hid.enabled", true);      // again: nothing more is taken
        assertEquals(1, calls.size());

        core.settings().set("hid.enabled", false);     // the rollback
        assertEquals(java.util.Arrays.asList("acquire", "release"), calls);
        assertFalse(s.held());
        assertFalse(row("hid.enabled").getBoolean("active"));
    }

    @Test public void anotherSettingChangingDoesNothing() {
        LiveSwitch s = LiveSwitch.declare(core, "hid.enabled", part);
        LiveSwitch.declare(core, "mic.enabled", new LiveSwitch.Part() {
            @Override public void acquire() { }
            @Override public void release() { }
        });
        s.start();
        calls.clear();
        core.settings().set("mic.enabled", false);
        assertTrue(calls.isEmpty());
    }

    @Test public void stopReleasesOnceAndAChangeAfterStopTakesNothing() {
        LiveSwitch s = LiveSwitch.declare(core, "hid.enabled", part);
        s.start();
        s.stop();
        s.stop();
        assertEquals(java.util.Arrays.asList("acquire", "release"), calls);
        core.settings().set("hid.enabled", false);
        core.settings().set("hid.enabled", true);
        assertEquals("a stopped capability is not started by a setting", 2, calls.size());
        assertFalse(s.held());
    }

    @Test public void aPartThatCannotBeTakenIsReleasedAndReportedWithTheReason() throws Exception {
        failAcquire = true;
        LiveSwitch s = LiveSwitch.declare(core, "hid.enabled", part);
        s.start();
        assertFalse(s.held());
        assertEquals("what was half taken is given back", java.util.Arrays.asList("acquire", "release"), calls);
        assertTrue(row("hid.enabled").getBoolean("setting"));
        assertFalse(row("hid.enabled").getBoolean("active"));
        assertTrue(row("hid.enabled").getString("error").contains("busy"));
        s.stop();
        assertEquals("not held, so stop releases nothing more", 2, calls.size());
    }

    @Test public void attachUsesASettingTheCapabilityAlreadyDeclared() {
        core.settings().declare("midi.enabled", SettingsRegistry.Type.BOOLEAN, true);
        LiveSwitch s = LiveSwitch.attach(core, "midi.enabled", part);
        s.start();
        core.settings().set("midi.enabled", false);
        assertEquals(java.util.Arrays.asList("acquire", "release"), calls);
    }
}
