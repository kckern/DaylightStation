package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class KioskContractTest {
    @After public void tearDown() { ShellComponents.publish(KioskHost.COMPONENT, null); }

    /** A host that forwards as the shell's Activity does, without Android. */
    private static final class Host implements KioskHost {
        KioskController controller;
        @Override public Object activity() { return "activity"; }
        @Override public void attach(KioskController next) {
            if (controller != null) controller.onHostDetached();
            controller = next;
            if (next != null) next.onHostAttached(this);
        }
        @Override public boolean resumed() { return false; }
    }

    private static final class Controller implements KioskController {
        final List<String> seen = new ArrayList<>();
        @Override public void onHostAttached(KioskHost host) { seen.add("attached " + host.activity()); }
        @Override public void onHostDetached() { seen.add("detached"); }
        @Override public void onHostVisible(boolean visible) { seen.add("visible " + visible); }
        @Override public void onHostResumed() { seen.add("resumed"); }
        @Override public void onHostPaused() { seen.add("paused"); }
        @Override public void onHostWindowFocus(boolean focused) { seen.add("focus " + focused); }
        @Override public boolean onHostKey(Object keyEvent) { seen.add("key"); return true; }
        @Override public void onHostNewIntent(Object intent) { seen.add("intent"); }
    }

    @Test public void theKioskActivityIsPublishedUnderOneName() {
        assertEquals("kiosk-activity", KioskHost.COMPONENT);
        Host host = new Host();
        ShellComponents.publish(KioskHost.COMPONENT, host);
        assertSame(host, ShellComponents.get("kiosk-activity"));
    }

    @Test public void attachingHandsTheHostToTheControllerAndNullDetaches() {
        Host host = new Host();
        Controller controller = new Controller();
        host.attach(controller);
        host.attach(null);
        assertEquals(java.util.Arrays.asList("attached activity", "detached"), controller.seen);
    }
}
