package net.kckern.daylight.cap.webviewhost;

import org.junit.Test;
import static org.junit.Assert.*;

public class CallCapturePolicyTest {
    @Test public void onlyOriginalPhoneBarcodeLaunchMayFinishAtHome() {
        String home = "https://home.test";
        String scan = home + "/health?capture=barcode";
        assertTrue(CallCapturePolicy.finishesBarcode("phone", home, scan, home + "/health", home, true, false));
        assertFalse(CallCapturePolicy.finishesBarcode("phone", home, home + "/health", scan, home, true, false));
        assertFalse(CallCapturePolicy.finishesBarcode("phone", home, scan, home + "/media", home, true, false));
        assertFalse(CallCapturePolicy.finishesBarcode("phone", home, scan, scan, home, false, false));
        assertFalse(CallCapturePolicy.finishesBarcode("phone", home, scan, scan, home, true, true));
        assertFalse(CallCapturePolicy.finishesBarcode("phone", home, scan, scan, "https://other.test", true, false));
        assertFalse(CallCapturePolicy.finishesBarcode("tablet", home, scan, scan, home, true, false));
    }

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
