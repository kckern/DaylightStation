package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.api.AccessibilityDelegate;
import net.kckern.daylight.api.AccessibilityHost;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class AccessibilityHubTest {
    private static final class FakeHost implements AccessibilityHost {
        AccessibilityDelegate delegate;
        @Override public void setDelegate(AccessibilityDelegate d) { delegate = d; }
    }

    @Test public void bindingAttachesTheHubAndUnbindingDetachesIt() {
        AccessibilityHub hub = new AccessibilityHub();
        FakeHost host = new FakeHost();
        assertFalse(hub.isBound());
        hub.bind(host);
        assertTrue(hub.isBound());
        assertSame(hub, host.delegate);
        hub.bind(null);
        assertFalse(hub.isBound());
        assertNull("a swapped-out payload must not keep receiving keys", host.delegate);
    }

    @Test public void theFirstFilterThatConsumesAKeyWins() {
        AccessibilityHub hub = new AccessibilityHub();
        List<String> seen = new ArrayList<>();
        hub.addKeyFilter(event -> { seen.add("a"); return false; });
        hub.addKeyFilter(event -> { seen.add("b"); return true; });
        hub.addKeyFilter(event -> { seen.add("c"); return true; });
        assertTrue(hub.onKeyEvent(null));
        assertEquals(java.util.Arrays.asList("a", "b"), seen);
    }

    @Test public void aFilterThatThrowsLetsTheKeyThrough() {
        AccessibilityHub hub = new AccessibilityHub();
        hub.addKeyFilter(event -> { throw new IllegalStateException(); });
        assertFalse(hub.onKeyEvent(null));
    }

    @Test public void withNoServiceThereIsNoServiceToHandOut() {
        AccessibilityHub hub = new AccessibilityHub();
        hub.bind(new FakeHost());
        assertNull("a host that is not an AccessibilityService is never returned as one", hub.service());
    }
}
