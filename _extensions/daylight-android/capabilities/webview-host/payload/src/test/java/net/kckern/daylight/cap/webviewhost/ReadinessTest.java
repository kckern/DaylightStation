package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.webviewhost.LoadTracker.State;

import org.junit.Test;

public class ReadinessTest {
    private static final String URL = "https://kiosk.example/piano";

    @Test public void readyMeansAnActivityShowsALoadedPage() {
        assertNull(Readiness.notReadyReason(URL, true, State.LOADED, false, null));
    }

    @Test public void anEmptyStartUrlIsNotConfiguredWhateverElseIsTrue() {
        assertEquals("webview.startUrl is not set", Readiness.notReadyReason("", true, State.LOADED, false, null));
        assertEquals("webview.startUrl is not set", Readiness.notReadyReason("  ", false, State.IDLE, true, null));
    }

    @Test public void theOtherReasonsNameWhatIsMissing() {
        assertEquals("no kiosk activity", Readiness.notReadyReason(URL, false, State.LOADED, false, null));
        assertEquals("loading", Readiness.notReadyReason(URL, true, State.LOADING, false, null));
        assertEquals("no page loaded", Readiness.notReadyReason(URL, true, State.IDLE, false, null));
        assertEquals("load failed: timeout", Readiness.notReadyReason(URL, true, State.FAILED, true, "timeout"));
        assertEquals("load failed", Readiness.notReadyReason(URL, true, State.FAILED, true, null));
        assertEquals("showing the error page", Readiness.notReadyReason(URL, true, State.LOADED, true, null));
    }
}
