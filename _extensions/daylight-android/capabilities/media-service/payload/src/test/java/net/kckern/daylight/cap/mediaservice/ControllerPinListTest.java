package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Map;

public class ControllerPinListTest {
    private static final String CERT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test public void emptyMeansNoControllerIsPinned() {
        assertNull(ControllerPinList.problem(""));
        assertTrue(ControllerPinList.parse("").isEmpty());
        assertEquals("{}", ControllerPinList.cacheJson(""));
    }

    @Test public void anEntryIsAPackageAndItsCertificateDigest() throws Exception {
        String value = "com.example.app=" + CERT + ", com.example.car = " + CERT.toUpperCase(java.util.Locale.ROOT).replaceAll("(..)", "$1:").replaceAll(":$", "");
        assertNull(ControllerPinList.problem(value));
        Map<String, String> pins = ControllerPinList.parse(value);
        assertEquals(CERT, pins.get("com.example.app"));
        assertEquals("colons and case are how a tool prints it", CERT, pins.get("com.example.car"));
        assertEquals(CERT, new JSONObject(ControllerPinList.cacheJson(value)).getString("com.example.car"));
    }

    @Test public void aMalformedEntryIsRefused() {
        for (String bad : new String[] { "com.example.app", "com.example.app=abc", "=" + CERT, "not a package=" + CERT,
                "com.example.app=" + CERT + "ff", "com.example.app=" + CERT.replace('0', 'g'),
                "com.example.app=" + CERT + ",com.example.app=" + CERT }) {
            assertNotNull("accepted " + bad, ControllerPinList.problem(bad));
        }
    }

    @Test public void theCacheKeyIsTheOneTheInstalledServiceReads() {
        assertEquals("media.controllerPins", MediaServiceCapability.PINS);
        assertEquals("daylight_surfaces", net.kckern.daylight.api.SurfaceKeys.PREFS);
    }
}
