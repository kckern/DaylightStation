package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class BridgeScriptTest {
    @Test public void theShimDefinesEveryContractMemberAndCarriesTheToken() {
        String js = BridgeScript.shim("tok-123", "p3-kiosk", "piano");
        for (String member : new String[] { "version:", "deviceId:", "capabilities:", "launch:", "screen:",
                "restartApp:", "reboot:", "setBackMode:", "volume:" }) {
            assertTrue("missing " + member, js.contains(member));
        }
        assertTrue(js.contains("\"tok-123\""));
        assertTrue(js.contains("\"p3-kiosk\""));
        assertTrue(js.contains("\"piano\""));
        assertTrue(js.contains("window." + BridgeScript.NATIVE_NAME));
        assertTrue("installing twice must be harmless", js.contains("if(window.daylight)return;"));
    }

    @Test public void valuesAreQuotedAsJavaScriptStrings() {
        String js = BridgeScript.shim("t", "v\"1", "d\\x");
        assertTrue(js.contains("\"v\\\"1\""));
        assertTrue(js.contains("\"d\\\\x\""));
    }

    @Test public void anEventIsACustomEventOnWindowWithTheDetail() {
        assertEquals("window.dispatchEvent(new CustomEvent(\"daylight:resume\",{detail:{\"awayMs\":5}}));",
                BridgeScript.event("resume", "{\"awayMs\":5}"));
    }

    @Test public void lineSeparatorsInADetailAreEscaped() {
        assertTrue(BridgeScript.event("key", "{\"code\":\"a b\"}").contains("a\\u2028b"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void eventNamesAreLowerCaseLettersOnly() { BridgeScript.event("x');alert(1);//", "{}"); }
}
