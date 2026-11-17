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
        assertTrue("the key is spent on a token of this document's own", js.contains("n.open(\"tok-123\")"));
        assertTrue("asked for at the first call, then kept", js.contains("function t(){if(!T){"));
        assertTrue("every call presents the token, never the key", js.contains("n.call(t(),m,"));
        assertEquals("the key appears once: it is never passed with a call", 1, js.split("tok-123", -1).length - 1);
        assertTrue(js.contains("\"p3-kiosk\""));
        assertTrue(js.contains("\"piano\""));
        assertTrue(js.contains("window." + BridgeScript.NATIVE_NAME));
        assertTrue("installing twice must be harmless", js.contains("if(window.daylight)return;"));
    }

    @Test public void theShimOffersThePageNothingBeyondTheContract() {
        String js = BridgeScript.shim("tok-123", "p3-kiosk", "piano");
        for (String absent : new String[] { "eval", "exec", "setting", "screenshot", "logcat", "html:", "unlock" }) {
            assertFalse("the page bridge must not offer " + absent, js.toLowerCase(java.util.Locale.ROOT).contains(absent));
        }
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
