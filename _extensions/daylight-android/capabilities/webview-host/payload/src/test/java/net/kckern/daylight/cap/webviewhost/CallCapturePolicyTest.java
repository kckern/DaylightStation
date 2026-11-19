package net.kckern.daylight.cap.webviewhost;

import org.junit.Test;
import static org.junit.Assert.*;

public class CallCapturePolicyTest {
    @Test public void onlyInternalHttpsCallPageAndMatchingRequesterMayAsk() {
        String home = "https://home.test";
        assertTrue(CallCapturePolicy.allows(home, home + "/call?room=1", home, false));
        assertFalse(CallCapturePolicy.allows(home, home + "/call", home, true));
        assertFalse(CallCapturePolicy.allows(home, home + "/media", home, false));
        assertFalse(CallCapturePolicy.allows(home, home + "/call", "https://elsewhere.test", false));
        assertFalse(CallCapturePolicy.allows(home, "https://elsewhere.test/call", home, false));
        assertFalse(CallCapturePolicy.allows("http://home.test", "http://home.test/call", "http://home.test", false));
    }
}
