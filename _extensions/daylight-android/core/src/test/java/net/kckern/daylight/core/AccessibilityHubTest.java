package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.api.AccessibilityDelegate;
import net.kckern.daylight.api.AccessibilityHost;

import net.kckern.daylight.core.testing.FakeShell;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

import java.util.ArrayList;
import java.util.List;

public class AccessibilityHubTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void pianoRequiresFreshAuthorityForEachAccessibilityWrite() {
        FakeShell shell = new FakeShell(tmp.getRoot());
        CoreRuntime piano = new CoreRuntime(shell, "piano", "test", tmp.getRoot());
        assertFalse(AccessibilityHub.accessibilityWriteAllowed(piano));
        AtomicBoolean allowed = new AtomicBoolean(true);
        shell.components.put("native-run-authority", (BooleanSupplier) allowed::get);
        assertTrue(AccessibilityHub.accessibilityWriteAllowed(piano));
        allowed.set(false);
        assertFalse(AccessibilityHub.accessibilityWriteAllowed(piano));
        CoreRuntime portal = new CoreRuntime(shell, "portal", "test", tmp.getRoot());
        assertTrue(AccessibilityHub.accessibilityWriteAllowed(portal));
    }

    private static final class FakeHost implements AccessibilityHost {
        AccessibilityDelegate delegate;
        @Override public void setDelegate(AccessibilityDelegate d) { delegate = d; }
        @Override public boolean clearDelegate(AccessibilityDelegate expected) {
            if (delegate != expected) return false;
            delegate = null;
            return true;
        }
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

    // ── two payloads, one service ───────────────────────────────────────────

    @Test public void anOldPayloadStoppingLateDoesNotDetachTheNewOne() {
        FakeHost host = new FakeHost();
        AccessibilityHub old = new AccessibilityHub(), fresh = new AccessibilityHub();
        old.bind(host);
        fresh.bind(host);                  // the new payload has started
        assertSame(fresh, host.delegate);
        old.bind(null);                    // the old one's stop() arrives after that
        assertSame("the new payload still gets keys and events", fresh, host.delegate);
        assertFalse(old.isBound());
        fresh.bind(null);
        assertNull(host.delegate);
    }

    /** A shell built before clearDelegate existed. */
    private static final class OlderShellHost implements AccessibilityHost {
        AccessibilityDelegate delegate;
        @Override public void setDelegate(AccessibilityDelegate d) { delegate = d; }
        @Override public boolean clearDelegate(AccessibilityDelegate expected) { throw new AbstractMethodError("clearDelegate"); }
    }

    @Test public void onAShellWithoutClearDelegateTheHubStillDetaches() {
        OlderShellHost host = new OlderShellHost();
        AccessibilityHub hub = new AccessibilityHub();
        hub.bind(host);
        hub.bind(null);
        assertNull(host.delegate);
    }

    // ── the key-filter flag ─────────────────────────────────────────────────

    private static final int KEYS = android.accessibilityservice.AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;

    @Test public void theFlagIsSetAndClearedWithoutTouchingOtherFlags() {
        int others = 0x40 | 0x10;
        assertEquals(others | KEYS, AccessibilityHub.keyFilterFlag(others, true));
        assertEquals(others, AccessibilityHub.keyFilterFlag(others | KEYS, false));
        assertEquals(others, AccessibilityHub.keyFilterFlag(others, false));
    }

    /** A service whose info can be read back. android.jar's own accessors return nothing on the JVM. */
    private static final class FakeService extends android.accessibilityservice.AccessibilityService implements AccessibilityHost {
        final android.accessibilityservice.AccessibilityServiceInfo info = new android.accessibilityservice.AccessibilityServiceInfo();
        AccessibilityDelegate delegate;
        @Override public void onAccessibilityEvent(android.view.accessibility.AccessibilityEvent event) { }
        @Override public void onInterrupt() { }
        @Override public void setDelegate(AccessibilityDelegate d) { delegate = d; }
        @Override public boolean clearDelegate(AccessibilityDelegate expected) {
            if (delegate != expected) return false;
            delegate = null;
            return true;
        }
    }

    private static final AccessibilityHub.InfoAccess FAKE_INFO = new AccessibilityHub.InfoAccess() {
        @Override public android.accessibilityservice.AccessibilityServiceInfo get(android.accessibilityservice.AccessibilityService s) {
            return ((FakeService) s).info;
        }
        @Override public void set(android.accessibilityservice.AccessibilityService s, android.accessibilityservice.AccessibilityServiceInfo i) {
            ((FakeService) s).info.flags = i.flags;
        }
    };

    private static AccessibilityHub hubOverFakeInfo() {
        AccessibilityHub hub = new AccessibilityHub();
        hub.useInfoAccessForTest(FAKE_INFO);
        return hub;
    }

    @Test public void inputSuppressionNeedsItsOwnFilterAndABoundServiceRequestingKeys() {
        AccessibilityHub hub = hubOverFakeInfo();
        FakeService service = new FakeService();
        hub.bind(service);
        hub.addKeyFilter(event -> false);
        assertFalse(hub.inputSuppressionReady());
        hub.addKeyFilter((AccessibilityHub.InputLockFilter) event -> true);
        assertTrue(hub.inputSuppressionReady());
        service.info.flags = 0;
        assertFalse(hub.inputSuppressionReady());
        hub.bind(null);
        assertFalse(hub.inputSuppressionReady());
    }

    @Test public void theServiceAsksForKeysOnlyWhileAFilterIsRegistered() {
        FakeService service = new FakeService();
        service.info.flags = 0x40;
        AccessibilityHub hub = hubOverFakeInfo();
        hub.bind(service);
        assertEquals("no filter, no request for keys", 0x40, service.info.flags);

        AccessibilityHub.KeyFilter first = event -> false, second = event -> false;
        hub.addKeyFilter(first);
        hub.addKeyFilter(second);
        assertEquals(0x40 | KEYS, service.info.flags);
        hub.removeKeyFilter(first);
        assertEquals("one filter is left", 0x40 | KEYS, service.info.flags);
        hub.removeKeyFilter(second);
        assertEquals("the last filter is gone, and so is the request", 0x40, service.info.flags);
    }

    @Test public void aPayloadThatStopsTakesItsKeyRequestWithItUnlessAnotherPayloadHasTheService() {
        FakeService service = new FakeService();
        AccessibilityHub old = hubOverFakeInfo();
        old.addKeyFilter(event -> true);
        old.bind(service);
        assertEquals(KEYS, service.info.flags & KEYS);
        old.bind(null);
        assertEquals("stopped with no successor: the request is withdrawn", 0, service.info.flags & KEYS);

        old.bind(service);
        AccessibilityHub fresh = hubOverFakeInfo();
        fresh.addKeyFilter(event -> true);
        fresh.bind(service);
        old.bind(null);                    // late stop of the old payload
        assertEquals("the new payload's request stands", KEYS, service.info.flags & KEYS);
        assertSame(fresh, service.delegate);
    }
}
