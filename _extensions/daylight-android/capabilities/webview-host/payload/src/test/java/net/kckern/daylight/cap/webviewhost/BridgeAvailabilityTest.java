package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class BridgeAvailabilityTest {
    @Test public void theBridgeIsOfferedOnlyWithDocumentStartInjection() {
        BridgeAvailability ok = BridgeAvailability.decide(true, true, null);
        assertTrue(ok.available);
        assertEquals("available", ok.state());
        assertNull(ok.reason);
    }

    @Test public void aWebViewWithoutTheFeatureGetsNoBridgeAndAReason() {
        // The old fallback evaluated the shim when a load started, in the outgoing document.
        BridgeAvailability none = BridgeAvailability.decide(true, false, null);
        assertFalse(none.available);
        assertEquals("unavailable", none.state());
        assertTrue(none.reason, none.reason.contains("document start"));
    }

    @Test public void aRefusedInjectionOrNoOriginMeansNoBridge() {
        BridgeAvailability refused = BridgeAvailability.decide(true, true, "IllegalArgumentException: bad rule");
        assertFalse(refused.available);
        assertTrue(refused.reason.contains("bad rule"));
        BridgeAvailability noOrigin = BridgeAvailability.decide(false, true, null);
        assertFalse(noOrigin.available);
        assertTrue(noOrigin.reason.contains("webview.startUrl"));
    }
}
