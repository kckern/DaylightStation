package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import net.kckern.daylight.api.KioskController;
import net.kckern.daylight.api.KioskHost;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class LockScreenRuleTest {
    private static class Host implements KioskHost {
        final List<Boolean> asked = new ArrayList<>();
        @Override public Object activity() { return "activity"; }
        @Override public void attach(KioskController controller) { }
        @Override public void detach(KioskController expected) { }
        @Override public boolean resumed() { return false; }
        @Override public void showWhenLocked(boolean on) { asked.add(on); }
    }

    @Test public void theHostIsToldWhatTheSettingSays() {
        Host host = new Host();
        assertTrue(LockScreenRule.apply(host, false));
        assertTrue(LockScreenRule.apply(host, true));
        assertEquals(java.util.Arrays.asList(false, true), host.asked);
    }

    @Test public void aShellInstalledBeforeTheHostCouldBeToldIsLeftAsItIs() {
        // An older installed shell has no such method; calling it is an Error, not an exception.
        KioskHost old = new Host() {
            @Override public void showWhenLocked(boolean on) { throw new AbstractMethodError("showWhenLocked"); }
        };
        assertFalse(LockScreenRule.apply(old, true));
        assertFalse(LockScreenRule.apply(null, true));
    }
}
